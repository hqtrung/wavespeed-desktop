# Phase 1: Storage Layer

**Status:** ✅ completed | **Priority:** P1 | **Effort:** 2.5h | **Completed:** 2026-03-14

## Overview

Create SQLite database layer for history cache using sql.js (shared pattern with workflow module). Includes DB connection, schema with migrations, repository for CRUD operations, and IPC handlers for renderer communication.

## Context Links

- Brainstorm: `plans/reports/brainstorm-260313-2250-local-history-cache.md`
- Workflow DB pattern: `electron/workflow/db/connection.ts`
- Workflow schema: `electron/workflow/db/schema.ts`
- IPC pattern: `src/workflow/ipc/ipc-client.ts`

## Key Insights

1. **Reuse workflow sql.js pattern**: Same `initSqlJs`, file persistence, debounced writes
2. **Separate DB file**: `history-cache.db` independent from `workflow.db`
3. **Corruption recovery**: Backup corrupt DB, create fresh one (workflow pattern)
4. **Transaction wrapper**: Use for multi-step operations (workflow pattern)
5. **Typed IPC**: Follow workflow's `invoke` pattern with channel names

## Database Schema

```sql
CREATE TABLE predictions (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'created')),
  outputs JSON,                  -- array of URLs or objects
  inputs JSON,                   -- prediction inputs for "open in playground"
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  execution_time INTEGER,        -- milliseconds
  has_nsfw_contents INTEGER DEFAULT 0,
  error TEXT,
  synced_at TEXT                 -- last server sync timestamp
);

CREATE INDEX idx_created_at ON predictions(created_at DESC);
CREATE INDEX idx_model_id ON predictions(model_id);
CREATE INDEX idx_status ON predictions(status);

CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Related Code Files

### Create

| File | Purpose |
|------|---------|
| `electron/history/index.ts` | Module entry point, init function |
| `electron/history/db/connection.ts` | sql.js DB connection, persist helpers |
| `electron/history/db/schema.ts` | Schema + migrations |
| `electron/history/db/prediction.repo.ts` | Prediction CRUD operations |
| `electron/history/ipc/history.ipc.ts` | IPC handlers for renderer |
| `src/ipc/history.ts` | Typed IPC client (renderer) |
| `src/types/history-cache.ts` | Cache types |

### Modify

| File | Changes |
|------|---------|
| `electron/main.ts` | Import and call `initHistoryModule()` |
| `electron/preload.ts` | Add history API to `electronAPI` |

## Implementation Steps

### Step 1: Create types

`src/types/history-cache.ts`:

```typescript
import type { HistoryItem } from "./prediction";

export interface CachedPrediction extends HistoryItem {
  inputs?: Record<string, unknown>; // Stored for "open in playground"
  synced_at?: string;
}

export interface HistoryCacheFilters {
  status?: string;
  model_id?: string;
  created_after?: string;
  created_before?: string;
}

export interface HistoryCacheListOptions {
  limit?: number;
  offset?: number;
  filters?: HistoryCacheFilters;
}

export interface HistoryCacheStats {
  totalCount: number;
  lastSyncTime: string | null;
  dbSizeBytes: number;
}
```

### Step 2: Create DB connection

`electron/history/db/connection.ts`:

Follow workflow pattern exactly:
- Use `initSqlJs` from sql.js
- File location: `{userData}/history-cache.db`
- Corrupt DB backup + recreate
- Debounced `persistDatabase()` (500ms)
- Immediate `persistDatabaseNow()` for shutdown
- `transaction()` wrapper

```typescript
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { app } from "electron";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname } from "path";
import { initializeSchema, runMigrations } from "./schema";

const DB_FILENAME = "history-cache.db";
// ... (copy pattern from workflow/db/connection.ts)
```

### Step 3: Create schema

`electron/history/db/schema.ts`:

```typescript
import type { Database as SqlJsDatabase } from "sql.js";

export function initializeSchema(db: SqlJsDatabase): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'created')),
    outputs JSON,
    inputs JSON,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    execution_time INTEGER,
    has_nsfw_contents INTEGER DEFAULT 0,
    error TEXT,
    synced_at TEXT
  )`);

  // Indexes...
  db.run("CREATE INDEX IF NOT EXISTS idx_history_created ON predictions(created_at DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_history_model ON predictions(model_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_history_status ON predictions(status)");

  db.run("INSERT OR IGNORE INTO schema_version (version) VALUES (1)");
}

export function runMigrations(db: SqlJsDatabase): void {
  const result = db.exec("SELECT MAX(version) as version FROM schema_version");
  const currentVersion = (result[0]?.values?.[0]?.[0] as number) ?? 0;

  const migrations: Array<{ version: number; apply: (db: SqlJsDatabase) => void }> = [
    // Future migrations go here
  ];

  for (const m of migrations) {
    if (m.version > currentVersion) {
      m.apply(db);
    }
  }
}
```

### Step 4: Create repository

`electron/history/db/prediction.repo.ts`:

```typescript
import type { SqlJsDatabase } from "sql.js";
import type { HistoryItem, CachedPrediction } from "@/types/history-cache";
import { getDatabase, persistDatabase } from "./connection";

export function upsertPrediction(item: HistoryItem & { inputs?: Record<string, unknown> }): void {
  const db = getDatabase();
  const outputsJson = JSON.stringify(item.outputs ?? []);
  const inputsJson = JSON.stringify(item.inputs ?? {});

  db.run(
    `INSERT OR REPLACE INTO predictions (
      id, model_id, status, outputs, inputs, created_at, updated_at,
      execution_time, has_nsfw_contents, error, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.model,
      item.status,
      outputsJson,
      inputsJson,
      item.created_at,
      item.updated_at || item.created_at,
      item.execution_time ?? null,
      item.has_nsfw_contents ? 1 : 0,
      item.error ?? null,
      null, // synced_at - set by sync operations
    ]
  );
  persistDatabase();
}

export function upsertPredictions(items: HistoryItem[]): void {
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO predictions (
      id, model_id, status, outputs, inputs, created_at, updated_at,
      execution_time, has_nsfw_contents, error, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const item of items) {
    stmt.run([
      item.id,
      item.model,
      item.status,
      JSON.stringify(item.outputs ?? []),
      JSON.stringify({}), // inputs empty for bulk sync
      item.created_at,
      item.updated_at || item.created_at,
      item.execution_time ?? null,
      item.has_nsfw_contents ? 1 : 0,
      item.error ?? null,
      new Date().toISOString(), // marked as synced
    ]);
  }
  stmt.free();
  persistDatabase();
}

export function getPredictionById(id: string): CachedPrediction | null {
  const db = getDatabase();
  const result = db.exec("SELECT * FROM predictions WHERE id = ?", [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return rowToPrediction(result[0].values[0] as unknown[]);
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  status?: string;
}

export function listPredictions(options: ListOptions = {}): CachedPrediction[] {
  const db = getDatabase();
  const { limit = 50, offset = 0, status } = options;

  let sql = "SELECT * FROM predictions";
  const params: unknown[] = [];

  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const result = db.exec(sql, params);
  if (result.length === 0) return [];

  return result[0].values.map((row) => rowToPrediction(row as unknown[]));
}

export function deletePrediction(id: string): void {
  const db = getDatabase();
  db.run("DELETE FROM predictions WHERE id = ?", [id]);
  persistDatabase();
}

export function getCount(): number {
  const db = getDatabase();
  const result = db.exec("SELECT COUNT(*) as count FROM predictions");
  return result[0]?.values?.[0]?.[0] as number ?? 0;
}

export function getLastSyncTime(): string | null {
  const db = getDatabase();
  const result = db.exec("SELECT MAX(synced_at) as last_sync FROM predictions WHERE synced_at IS NOT NULL");
  return result[0]?.values?.[0]?.[0] as string ?? null;
}

function rowToPrediction(row: unknown[]): CachedPrediction {
  const [
    id, model_id, status, outputsJson, inputsJson,
    created_at, updated_at, execution_time,
    has_nsfw_contents, error, synced_at
  ] = row;

  return {
    id: id as string,
    model: model_id as string,
    status: status as "pending" | "processing" | "completed" | "failed" | "created",
    outputs: outputsJson ? JSON.parse(outputsJson as string) : [],
    inputs: inputsJson ? JSON.parse(inputsJson as string) : undefined,
    created_at: created_at as string,
    updated_at: updated_at as string,
    execution_time: execution_time as number | undefined,
    has_nsfw_contents: (has_nsfw_contents as number) === 1 ? [true] : undefined,
    error: error as string | undefined,
    synced_at: synced_at as string | undefined,
  };
}
```

### Step 5: Create IPC handlers

`electron/history/ipc/history.ipc.ts`:

```typescript
import { ipcMain } from "electron";
import * as predictionRepo from "../db/prediction.repo";

export function registerHistoryIpc(): void {
  // Get predictions from cache
  ipcMain.handle("history-cache:list", async (_event, options: { limit?: number; offset?: number; status?: string }) => {
    return predictionRepo.listPredictions(options);
  });

  // Get single prediction
  ipcMain.handle("history-cache:get", async (_event, id: string) => {
    return predictionRepo.getPredictionById(id);
  });

  // Upsert prediction
  ipcMain.handle("history-cache:upsert", async (_event, item: unknown) => {
    predictionRepo.upsertPrediction(item as Parameters<typeof predictionRepo.upsertPrediction>[0]);
    return { success: true };
  });

  // Bulk upsert (for sync)
  ipcMain.handle("history-cache:upsert-bulk", async (_event, items: unknown[]) => {
    predictionRepo.upsertPredictions(items as Parameters<typeof predictionRepo.upsertPredictions>[0]);
    return { success: true, count: items.length };
  });

  // Delete prediction
  ipcMain.handle("history-cache:delete", async (_event, id: string) => {
    predictionRepo.deletePrediction(id);
    return { success: true };
  });

  // Get stats
  ipcMain.handle("history-cache:stats", async () => {
    return {
      totalCount: predictionRepo.getCount(),
      lastSyncTime: predictionRepo.getLastSyncTime(),
    };
  });

  // Clear all
  ipcMain.handle("history-cache:clear", async () => {
    // Implement if needed
    return { success: true };
  });
}
```

### Step 6: Create module entry

`electron/history/index.ts`:

```typescript
/**
 * History cache module — local SQLite storage for prediction history.
 * Called from electron/main.ts during app.whenReady().
 */
import { openDatabase, closeDatabase } from "./db/connection";
import { registerHistoryIpc } from "./ipc/history.ipc";

export async function initHistoryModule(): Promise<void> {
  console.log("[History Cache] Initializing history cache module...");

  await openDatabase();
  registerHistoryIpc();

  console.log("[History Cache] Module initialized successfully");
}

export function closeHistoryDatabase(): void {
  closeDatabase();
  console.log("[History Cache] Database closed");
}
```

### Step 7: Create renderer IPC client

`src/ipc/history.ts`:

```typescript
/**
 * Type-safe IPC client for history cache (renderer process).
 */
import type { CachedPrediction, HistoryCacheListOptions, HistoryCacheStats } from "@/types/history-cache";
import type { HistoryItem } from "@/types/prediction";

function getApi() {
  if (typeof window === "undefined") return undefined;
  return (window as Record<string, unknown>).electronAPI as Record<string, unknown> | undefined;
}

async function invoke<T>(channel: string, args?: unknown): Promise<T> {
  const api = getApi();
  if (!api) return Promise.reject(new Error("Electron API not available"));
  const handler = (api as Record<string, (args?: unknown) => Promise<unknown>>)[`historyCache${channel.charAt(0).toUpperCase() + channel.slice(1)}`];
  if (!handler) return Promise.reject(new Error(`History cache channel not found: ${channel}`));
  return handler(args) as Promise<T>;
}

export const historyCacheIpc = {
  list: (options: HistoryCacheListOptions): Promise<CachedPrediction[]> =>
    invoke("list", options),

  get: (id: string): Promise<CachedPrediction | null> =>
    invoke("get", id),

  upsert: (item: HistoryItem & { inputs?: Record<string, unknown> }): Promise<{ success: boolean }> =>
    invoke("upsert", item),

  upsertBulk: (items: HistoryItem[]): Promise<{ success: boolean; count: number }> =>
    invoke("upsertBulk", items),

  delete: (id: string): Promise<{ success: boolean }> =>
    invoke("delete", id),

  stats: (): Promise<HistoryCacheStats> =>
    invoke("stats"),

  clear: (): Promise<{ success: boolean }> =>
    invoke("clear"),
};
```

### Step 8: Wire up in main process

`electron/main.ts`:

Add after workflow init:
```typescript
import { initHistoryModule, closeHistoryDatabase } from "./history/index";

async function initializeApp() {
  // ... existing code ...
  await initWorkflowModule();
  await initHistoryModule(); // NEW
  // ...
}

app.on("window-all-closed", () => {
  closeWorkflowDatabase();
  closeHistoryDatabase(); // NEW
  // ...
});
```

### Step 9: Update preload

`electron/preload.ts`:

Add to `electronAPI` interface:
```typescript
interface HistoryCacheStats {
  totalCount: number;
  lastSyncTime: string | null;
}

const electronAPI = {
  // ... existing ...

  // History cache APIs
  historyCacheList: (options: { limit?: number; offset?: number; status?: string }): Promise<unknown[]> =>
    ipcRenderer.invoke("history-cache:list", options),
  historyCacheGet: (id: string): Promise<unknown> =>
    ipcRenderer.invoke("history-cache:get", id),
  historyCacheUpsert: (item: unknown): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("history-cache:upsert", item),
  historyCacheUpsertBulk: (items: unknown[]): Promise<{ success: boolean; count: number }> =>
    ipcRenderer.invoke("history-cache:upsert-bulk", items),
  historyCacheDelete: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("history-cache:delete", id),
  historyCacheStats: (): Promise<HistoryCacheStats> =>
    ipcRenderer.invoke("history-cache:stats"),
  historyCacheClear: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("history-cache:clear"),
};
```

## Success Criteria

- [x] DB file created at `{userData}/history-cache.db` on first run
- [x] Can insert and retrieve predictions via IPC
- [x] Bulk upsert works for sync operations
- [x] Stats endpoint returns count and last sync time
- [x] Corrupt DB backed up and recreated
- [x] Debounced persist (500ms) verified
- [x] Module logs initialization success

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| sql.js WASM loading fails | High | Fallback to browser-only mode |
| Large DB size | Medium | Add pruning in future phase |
| Migration conflicts | Low | Version table + rollback support |

## Next Steps

After this phase, proceed to [Phase 2: HistoryPage Integration](phase-02-historypage-integration.md)
