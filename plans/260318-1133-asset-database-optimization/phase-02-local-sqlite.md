---
title: "Phase 02: Local SQLite Implementation"
description: "Implement local SQLite database using better-sqlite3 for asset management"
status: done
priority: P1
effort: 6h
tags: [database, sqlite, electron, better-sqlite3]
created: 2026-03-18
completed: 2026-03-18
---

# Phase 02: Local SQLite Implementation

## Context Links
- Parent: [plan.md](./plan.md)
- Schema: [phase-01-database-schema.md](./phase-01-database-schema.md)
- Reference: `electron/workflow/db/connection.ts` (sql.js pattern — NOT used here)

## Overview

Implement local SQLite database layer using **better-sqlite3** (native C addon).

> **Note:** Existing workflow/history modules use sql.js (WASM). This new assets module uses better-sqlite3 for better performance with up to 10,000 assets.

### better-sqlite3 vs sql.js

| Aspect | sql.js (existing) | better-sqlite3 (new) |
|--------|-------------------|---------------------|
| Type | WASM | Native C addon |
| Init | `await initSqlJs()` | `new Database(path)` |
| Disk I/O | Manual export/write | Automatic (WAL mode) |
| Query | `db.exec()` → `{columns, values}[]` | `db.prepare().all()` → `object[]` |
| Transaction | Manual BEGIN/COMMIT | `db.transaction(fn)()` |
| Performance | ~10x slower | Native speed |

## Architecture

```
electron/assets/
├── db/
│   ├── schema.ts         # Table definitions, migrations
│   ├── connection.ts     # better-sqlite3 connection management
│   ├── assets.repo.ts    # Assets CRUD operations
│   ├── folders.repo.ts   # Folders CRUD operations
│   ├── tags.repo.ts      # Tags & categories CRUD
│   ├── sync.repo.ts      # Sync state management
│   └── index.ts          # Module exports
├── ipc-handlers.ts       # Dedicated IPC handlers (not in main.ts)
└── index.ts              # Main module initialization
```

> **⚠️ Main Process Only**: `better-sqlite3` is a native C addon and **cannot be imported in the Renderer process**. All DB access must be in the Electron Main process. The Renderer receives only plain serializable data objects via IPC — never DB instances or `Statement` objects.

## File Implementations

### connection.ts

```typescript
import Database from "better-sqlite3";
import { app } from "electron";
import { join } from "path";
import { existsSync, mkdirSync, renameSync } from "fs";
import { dirname } from "path";
import { initializeSchema, runMigrations } from "./schema";

const DB_FILENAME = "assets.db";
const DB_DIR = "assets-data";

let db: Database.Database | null = null;

function getAssetsDataRoot(): string {
  if (app.isPackaged) {
    return join(app.getPath("userData"), DB_DIR);
  }
  return join(app.getAppPath(), DB_DIR);
}

export function getDatabasePath(): string {
  const root = getAssetsDataRoot();
  return join(root, DB_FILENAME);
}

export function openDatabase(): Database.Database {
  if (db) return db;

  const filePath = getDatabasePath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const dbExists = existsSync(filePath);
  let isCorrupt = false;

  if (dbExists) {
    try {
      db = new Database(filePath);
      const result = db.pragma("integrity_check");
      if (result[0]?.integrity_check !== "ok") {
        throw new Error("integrity_check failed");
      }
    } catch (error) {
      console.error("[Assets DB] Database corrupt or unreadable:", error);
      isCorrupt = true;
      if (db) {
        db.close();
        db = null;
      }
      const backupPath = `${filePath}.corrupt.${Date.now()}`;
      renameSync(filePath, backupPath);
      console.warn(`[Assets DB] Corrupt database backed up to: ${backupPath}`);
    }
  }

  if (!db) {
    db = new Database(filePath);
  }

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  if (!dbExists || isCorrupt) {
    initializeSchema(db);
  } else {
    runMigrations(db);
  }

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("[Assets DB] Database not initialized. Call openDatabase() first.");
  }
  return db;
}

// better-sqlite3 transactions are synchronous and auto-commit
export function transaction<T>(fn: (db: Database.Database) => T): T {
  const database = getDatabase();
  const runInTransaction = database.transaction(() => fn(database));
  return runInTransaction();
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.close();
    } catch (error) {
      console.error("[Assets DB] Error closing database:", error);
    } finally {
      db = null;
    }
  }
}
```

### assets.repo.ts

```typescript
import type Database from "better-sqlite3";
import { transaction, getDatabase } from "./connection";
import type { AssetRow } from "./schema";
import type { AssetMetadata } from "@/types/asset";

// Row -> Metadata converter
function rowToMetadata(row: AssetRow): AssetMetadata {
  return {
    id: row.id,
    filePath: row.file_path,
    fileName: row.file_name,
    type: row.type,
    modelId: row.model_id,
    createdAt: row.created_at,
    fileSize: row.file_size,
    tags: JSON.parse(row.tags || "[]"),
    favorite: row.favorite === 1,
    predictionId: row.prediction_id ?? undefined,
    resultIndex: row.result_index,
    originalUrl: row.original_url ?? undefined,
    source: row.source ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    workflowName: row.workflow_name ?? undefined,
    nodeId: row.node_id ?? undefined,
    executionId: row.execution_id ?? undefined,
    folderId: row.folder_id ?? undefined,
  };
}

export interface AssetFilter {
  types?: string[];
  models?: string[];
  sources?: string[];
  dateFrom?: string;
  dateTo?: string;
  favoritesOnly?: boolean;
  folderId?: string | null;
  search?: string;
  limit?: number;
  cursor?: string;  // Base64-encoded cursor for pagination
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  totalCount: number;
}

// Cursor helpers
function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString("base64");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  return JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
}

export class AssetsRepository {
  // Insert new asset
  insert(asset: Omit<AssetMetadata, "tags"> & { tags: string[] }): string {
    return transaction((db) => {
      const id = asset.id || this.generateId();
      const now = new Date().toISOString();

      const stmt = db.prepare(
        `INSERT INTO assets (
          id, file_path, file_name, type, model_id, created_at, updated_at,
          file_size, favorite, prediction_id, result_index, original_url,
          source, workflow_id, workflow_name, node_id, execution_id,
          folder_id, tags, sync_status, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`
      );

      stmt.run(
        id,
        asset.filePath,
        asset.fileName,
        asset.type,
        asset.modelId,
        asset.createdAt || now,
        now,
        asset.fileSize,
        asset.favorite ? 1 : 0,
        asset.predictionId ?? null,
        asset.resultIndex ?? 0,
        asset.originalUrl ?? null,
        asset.source ?? null,
        asset.workflowId ?? null,
        asset.workflowName ?? null,
        asset.nodeId ?? null,
        asset.executionId ?? null,
        asset.folderId ?? null,
        JSON.stringify(asset.tags),
      );

      return id;
    });
  }

  // Update asset
  update(id: string, updates: Partial<Pick<AssetMetadata, "tags" | "favorite" | "folderId">>): void {
    transaction((db) => {
      const sets: string[] = ["updated_at = ?", "sync_status = 'pending'", "version = version + 1"];
      const params: unknown[] = [new Date().toISOString()];

      if (updates.favorite !== undefined) {
        sets.push("favorite = ?");
        params.push(updates.favorite ? 1 : 0);
      }

      if (updates.tags !== undefined) {
        sets.push("tags = ?");
        params.push(JSON.stringify(updates.tags));
      }

      if (updates.folderId !== undefined) {
        sets.push("folder_id = ?");
        params.push(updates.folderId ?? null);
      }

      params.push(id);
      db.prepare(`UPDATE assets SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    });
  }

  // Delete asset (soft delete for sync)
  delete(id: string): void {
    transaction((db) => {
      db.prepare(
        "UPDATE assets SET sync_status = 'deleted', updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), id);

      db.prepare(
        `INSERT OR REPLACE INTO deleted_items (id, entity_type, original_id, deleted_at, version, synced)
         VALUES (?, 'asset', ?, ?, 1, 0)`
      ).run(id, id, new Date().toISOString());
    });
  }

  // Get by ID
  getById(id: string): AssetMetadata | null {
    const db = getDatabase();
    const row = db.prepare(
      "SELECT * FROM assets WHERE id = ? AND sync_status != 'deleted'"
    ).get(id) as AssetRow | undefined;

    if (!row) return null;
    return rowToMetadata(row);
  }

  // Get filtered assets with cursor-based pagination
  getFiltered(filter: AssetFilter): PaginatedResult<AssetMetadata> {
    const db = getDatabase();
    const limit = filter.limit || 50;

    // Build WHERE conditions
    const conditions: string[] = ["sync_status != 'deleted'"];
    const params: unknown[] = [];

    if (filter.types?.length) {
      conditions.push(`type IN (${filter.types.map(() => "?").join(",")})`);
      params.push(...filter.types);
    }
    if (filter.models?.length) {
      conditions.push(`model_id IN (${filter.models.map(() => "?").join(",")})`);
      params.push(...filter.models);
    }
    if (filter.sources?.length) {
      conditions.push(`source IN (${filter.sources.map(() => "?").join(",")})`);
      params.push(...filter.sources);
    }
    if (filter.favoritesOnly) {
      conditions.push("favorite = 1");
    }
    if (filter.folderId === "__none__") {
      conditions.push("folder_id IS NULL");
    } else if (filter.folderId) {
      conditions.push("folder_id = ?");
      params.push(filter.folderId);
    }
    if (filter.search) {
      conditions.push("(file_name LIKE ? OR model_id LIKE ?)");
      const term = `%${filter.search}%`;
      params.push(term, term);
    }

    // Cursor-based pagination
    if (filter.cursor) {
      const { createdAt, id } = decodeCursor(filter.cursor);
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      params.push(createdAt, createdAt, id);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    // Get total count (without cursor/limit)
    const countConditions = conditions.filter(c => !c.includes("created_at < ?"));
    const countParams = params.slice(0, params.length - (filter.cursor ? 3 : 0));
    const countWhere = `WHERE ${countConditions.join(" AND ")}`;
    const totalCount = (db.prepare(
      `SELECT COUNT(*) as count FROM assets ${countWhere}`
    ).get(...countParams) as { count: number }).count;

    // Fetch items (limit + 1 to check if there's a next page)
    params.push(limit + 1);
    const rows = db.prepare(
      `SELECT * FROM assets ${where} ORDER BY created_at DESC, id DESC LIMIT ?`
    ).all(...params) as AssetRow[];

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(rowToMetadata);

    // Build next cursor
    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor(lastItem.createdAt, lastItem.id);
    }

    return { items, nextCursor, totalCount };
  }

  // Get all unique tags across all assets
  getAllTags(): string[] {
    const db = getDatabase();
    const rows = db.prepare(
      "SELECT DISTINCT tags FROM assets WHERE sync_status != 'deleted' AND tags != '[]'"
    ).all() as { tags: string }[];

    const tagSet = new Set<string>();
    for (const row of rows) {
      const tags: string[] = JSON.parse(row.tags);
      for (const tag of tags) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort();
  }

  // Get all models
  getAllModels(): string[] {
    const db = getDatabase();
    const rows = db.prepare(
      "SELECT DISTINCT model_id FROM assets WHERE sync_status != 'deleted' ORDER BY model_id"
    ).all() as { model_id: string }[];
    return rows.map((r) => r.model_id);
  }

  // Get assets matching a tag (using json_each — no FTS5 needed at 10k scale)
  getByTag(tag: string): AssetMetadata[] {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT a.* FROM assets a, json_each(a.tags) je
       WHERE je.value = ? AND a.sync_status != 'deleted'
       ORDER BY a.created_at DESC`
    ).all(tag) as AssetRow[];
    return rows.map(rowToMetadata);
  }

  // Check if asset exists for prediction
  hasAssetForPrediction(predictionId: string): boolean {
    const db = getDatabase();
    const row = db.prepare(
      "SELECT 1 FROM assets WHERE prediction_id = ? AND sync_status != 'deleted' LIMIT 1"
    ).get(predictionId);
    return !!row;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
}

export const assetsRepo = new AssetsRepository();
```

### folders.repo.ts

```typescript
import { transaction, getDatabase } from "./connection";
import type { AssetFolder } from "@/types/asset";

export class FoldersRepository {
  getAll(): AssetFolder[] {
    const db = getDatabase();
    const rows = db.prepare(
      "SELECT * FROM folders WHERE sync_status != 'deleted' ORDER BY name"
    ).all() as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      icon: row.icon ?? undefined,
      createdAt: row.created_at,
    }));
  }

  create(folder: Omit<AssetFolder, "id" | "createdAt">): string {
    return transaction((db) => {
      const id = this.generateId();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO folders (id, name, color, icon, created_at, updated_at, sync_status, version)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 1)`
      ).run(id, folder.name, folder.color, folder.icon ?? null, now, now);

      return id;
    });
  }

  update(id: string, updates: Partial<Pick<AssetFolder, "name" | "color" | "icon">>): void {
    transaction((db) => {
      const sets: string[] = ["updated_at = ?", "sync_status = 'pending'", "version = version + 1"];
      const params: unknown[] = [new Date().toISOString()];

      if (updates.name !== undefined) {
        sets.push("name = ?");
        params.push(updates.name);
      }
      if (updates.color !== undefined) {
        sets.push("color = ?");
        params.push(updates.color);
      }
      if (updates.icon !== undefined) {
        sets.push("icon = ?");
        params.push(updates.icon);
      }

      params.push(id);
      db.prepare(`UPDATE folders SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    });
  }

  delete(id: string): void {
    transaction((db) => {
      db.prepare(
        "UPDATE folders SET sync_status = 'deleted', updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), id);

      // Clear folder_id on assets that referenced this folder
      db.prepare(
        "UPDATE assets SET folder_id = NULL, updated_at = ?, sync_status = 'pending', version = version + 1 WHERE folder_id = ?"
      ).run(new Date().toISOString(), id);

      db.prepare(
        `INSERT OR REPLACE INTO deleted_items (id, entity_type, original_id, deleted_at, version, synced)
         VALUES (?, 'folder', ?, ?, 1, 0)`
      ).run(id, id, new Date().toISOString());
    });
  }

  getAssetCount(folderId: string): number {
    const db = getDatabase();
    const row = db.prepare(
      "SELECT COUNT(*) as count FROM assets WHERE folder_id = ? AND sync_status != 'deleted'"
    ).get(folderId) as { count: number };
    return row.count;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
}

export const foldersRepo = new FoldersRepository();
```

### tags.repo.ts

```typescript
import { transaction, getDatabase } from "./connection";
import type { TagCategory, TagColor } from "@/types/asset";

export class TagsRepository {
  // Get all tag categories
  getAllCategories(): TagCategory[] {
    const db = getDatabase();
    const rows = db.prepare(
      "SELECT * FROM tag_categories WHERE sync_status != 'deleted' ORDER BY name"
    ).all() as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color as TagColor,
      tags: JSON.parse(row.tags || "[]"),
      createdAt: row.created_at,
    }));
  }

  createCategory(name: string, color: TagColor, tags: string[] = []): string {
    return transaction((db) => {
      const id = this.generateId();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO tag_categories (id, name, color, tags, created_at, updated_at, sync_status, version)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 1)`
      ).run(id, name, color, JSON.stringify(tags), now, now);

      return id;
    });
  }

  updateCategory(id: string, updates: Partial<Pick<TagCategory, "name" | "color" | "tags">>): void {
    transaction((db) => {
      const sets: string[] = ["updated_at = ?", "sync_status = 'pending'", "version = version + 1"];
      const params: unknown[] = [new Date().toISOString()];

      if (updates.name !== undefined) {
        sets.push("name = ?");
        params.push(updates.name);
      }
      if (updates.color !== undefined) {
        sets.push("color = ?");
        params.push(updates.color);
      }
      if (updates.tags !== undefined) {
        sets.push("tags = ?");
        params.push(JSON.stringify(updates.tags));
      }

      params.push(id);
      db.prepare(`UPDATE tag_categories SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    });
  }

  deleteCategory(id: string): void {
    transaction((db) => {
      db.prepare(
        "UPDATE tag_categories SET sync_status = 'deleted', updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), id);
    });
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
}

export const tagsRepo = new TagsRepository();
```

### sync.repo.ts

```typescript
import { transaction, getDatabase } from "./connection";

export interface SyncState {
  lastSyncAt: string | null;
  deviceId: string;
  remoteVersion: number | null;
}

export class SyncRepository {
  // Get sync state value
  getState(key: string): string | null {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  // Set sync state value
  setState(key: string, value: string): void {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value, new Date().toISOString());
  }

  // Get pending sync items
  getPendingItems(): { assets: string[]; folders: string[]; categories: string[] } {
    const db = getDatabase();

    const assets = db.prepare("SELECT id FROM assets WHERE sync_status = 'pending'")
      .all() as { id: string }[];
    const folders = db.prepare("SELECT id FROM folders WHERE sync_status = 'pending'")
      .all() as { id: string }[];
    const categories = db.prepare("SELECT id FROM tag_categories WHERE sync_status = 'pending'")
      .all() as { id: string }[];

    return {
      assets: assets.map((r) => r.id),
      folders: folders.map((r) => r.id),
      categories: categories.map((r) => r.id),
    };
  }

  // Mark items as synced
  markAsSynced(type: "assets" | "folders" | "tag_categories", ids: string[]): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    const stmt = db.prepare(`UPDATE ${type} SET sync_status = 'synced', synced_at = ? WHERE id = ?`);

    const markAll = db.transaction(() => {
      for (const id of ids) {
        stmt.run(now, id);
      }
    });
    markAll();
  }

  // Get deleted items that need sync
  getDeletedItems(): Array<{ id: string; entityType: string; originalId: string }> {
    const db = getDatabase();
    const rows = db.prepare("SELECT * FROM deleted_items WHERE synced = 0").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      originalId: row.original_id,
    }));
  }

  // Mark deleted items as synced
  markDeletedSynced(ids: string[]): void {
    const db = getDatabase();
    const stmt = db.prepare("UPDATE deleted_items SET synced = 1 WHERE id = ?");
    const markAll = db.transaction(() => {
      for (const id of ids) {
        stmt.run(id);
      }
    });
    markAll();
  }

  // Log sync event
  logEvent(entry: {
    entityType: string;
    entityId: string;
    operation: "create" | "update" | "delete" | "move";
    deviceId?: string;
    version?: number;
  }): void {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO sync_log (entity_type, entity_id, operation, device_id, version, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      entry.entityType,
      entry.entityId,
      entry.operation,
      entry.deviceId ?? null,
      entry.version ?? null,
      new Date().toISOString(),
    );
  }
}

export const syncRepo = new SyncRepository();
```

### ipc-handlers.ts

```typescript
// electron/assets/ipc-handlers.ts
// Dedicated IPC module following electron/workflow/ipc/ pattern

import { ipcMain } from "electron";
import { assetsRepo, type AssetFilter } from "./db/assets.repo";
import { foldersRepo } from "./db/folders.repo";
import { tagsRepo } from "./db/tags.repo";
import { syncRepo } from "./db/sync.repo";
import type { AssetMetadata, AssetFolder, TagCategory, TagColor } from "@/types/asset";

export function registerAssetsIpcHandlers(): void {
  // === Assets ===
  ipcMain.handle("assets:get-filtered", (_, filter: AssetFilter) => {
    return assetsRepo.getFiltered(filter);
  });

  ipcMain.handle("assets:get-by-id", (_, id: string) => {
    return assetsRepo.getById(id);
  });

  ipcMain.handle("assets:insert", (_, asset: Omit<AssetMetadata, "tags"> & { tags: string[] }) => {
    return assetsRepo.insert(asset);
  });

  ipcMain.handle("assets:update", (_, id: string, updates: Partial<Pick<AssetMetadata, "tags" | "favorite" | "folderId">>) => {
    assetsRepo.update(id, updates);
  });

  ipcMain.handle("assets:delete", (_, id: string) => {
    assetsRepo.delete(id);
  });

  ipcMain.handle("assets:get-all-tags", () => {
    return assetsRepo.getAllTags();
  });

  ipcMain.handle("assets:get-all-models", () => {
    return assetsRepo.getAllModels();
  });

  ipcMain.handle("assets:has-for-prediction", (_, predictionId: string) => {
    return assetsRepo.hasAssetForPrediction(predictionId);
  });

  // === Folders ===
  ipcMain.handle("folders:get-all", () => {
    return foldersRepo.getAll();
  });

  ipcMain.handle("folders:create", (_, folder: Omit<AssetFolder, "id" | "createdAt">) => {
    return foldersRepo.create(folder);
  });

  ipcMain.handle("folders:update", (_, id: string, updates: Partial<Pick<AssetFolder, "name" | "color" | "icon">>) => {
    foldersRepo.update(id, updates);
  });

  ipcMain.handle("folders:delete", (_, id: string) => {
    foldersRepo.delete(id);
  });

  ipcMain.handle("folders:get-asset-count", (_, folderId: string) => {
    return foldersRepo.getAssetCount(folderId);
  });

  // === Tag Categories ===
  ipcMain.handle("tag-categories:get-all", () => {
    return tagsRepo.getAllCategories();
  });

  ipcMain.handle("tag-categories:create", (_, name: string, color: TagColor, tags: string[]) => {
    return tagsRepo.createCategory(name, color, tags);
  });

  ipcMain.handle("tag-categories:update", (_, id: string, updates: Partial<Pick<TagCategory, "name" | "color" | "tags">>) => {
    tagsRepo.updateCategory(id, updates);
  });

  ipcMain.handle("tag-categories:delete", (_, id: string) => {
    tagsRepo.deleteCategory(id);
  });

  // === Sync State ===
  ipcMain.handle("sync:get-pending", () => {
    return syncRepo.getPendingItems();
  });

  ipcMain.handle("sync:get-state", (_, key: string) => {
    return syncRepo.getState(key);
  });
}
```

### index.ts (db module)

```typescript
export { openDatabase, getDatabase, closeDatabase, transaction } from "./connection";
export { initializeSchema, runMigrations, SCHEMA_VERSION } from "./schema";
export { assetsRepo, type AssetFilter, type PaginatedResult } from "./assets.repo";
export { foldersRepo } from "./folders.repo";
export { tagsRepo } from "./tags.repo";
export { syncRepo, type SyncState } from "./sync.repo";
export type { AssetRow, FolderRow, TagCategoryRow } from "./schema";
```

### index.ts (assets module)

```typescript
// electron/assets/index.ts
import { openDatabase, closeDatabase } from "./db";
import { registerAssetsIpcHandlers } from "./ipc-handlers";

export async function initAssetsModule(): Promise<void> {
  openDatabase();
  registerAssetsIpcHandlers();
  console.log("[Assets] Module initialized with better-sqlite3");
}

export function closeAssetsDatabase(): void {
  closeDatabase();
}
```

## Integration with main.ts

```typescript
// electron/main.ts — add to app.whenReady()
import { initAssetsModule, closeAssetsDatabase } from "./assets";

app.whenReady().then(() => {
  // ... existing init ...

  // Initialize assets module (better-sqlite3 DB, IPC handlers)
  initAssetsModule().catch((err) => {
    console.error("[Assets] Failed to initialize:", err);
  });
});

app.on("window-all-closed", () => {
  closeWorkflowDatabase();
  closeHistoryDatabase();
  closeAssetsDatabase();  // <-- Add this
  // ...
});
```

## Implementation Steps

1. [ ] Install `better-sqlite3` and `@types/better-sqlite3`
   ```bash
   npm install better-sqlite3
   npm install --save-dev @types/better-sqlite3 electron-rebuild
   ```
2. [ ] Add `electron-rebuild` post-install script to `package.json`
   ```json
   "scripts": {
     "postinstall": "electron-rebuild -f -w better-sqlite3"
   }
   ```
3. [ ] Rebuild native addon for Electron's Node version:
   ```bash
   npx electron-rebuild -f -w better-sqlite3
   ```
4. [ ] Create `electron/assets/db/` directory
5. [ ] Implement `connection.ts` with better-sqlite3
6. [ ] Implement `schema.ts` with `initializeSchema()` and `runMigrations()`
7. [ ] Implement `assets.repo.ts` with cursor-based pagination
8. [ ] Implement `folders.repo.ts`
9. [ ] Implement `tags.repo.ts`
10. [ ] Implement `sync.repo.ts`
11. [ ] Create `electron/assets/ipc-handlers.ts`
12. [ ] Create `electron/assets/index.ts` module entry
13. [ ] Create `db/index.ts` exports
14. [ ] Add unit tests for repositories

## Success Criteria

- Database opens and initializes correctly with better-sqlite3
- WAL mode enabled for concurrent read performance
- CRUD operations work for all entities using simplified schema
- Tags stored as JSON arrays (no junction tables)
- Folder assignment via direct `folder_id` FK (no junction table)
- Cursor-based pagination returns correct results
- Transactions maintain consistency
- IPC handlers registered in dedicated module (not main.ts)
- Compatible with existing `AssetMetadata` interface

## Next Steps

[Phase 03: Migration from JSON](./phase-03-migration.md)
