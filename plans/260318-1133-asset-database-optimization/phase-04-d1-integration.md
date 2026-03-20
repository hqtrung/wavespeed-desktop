---
title: "Phase 04: Cloudflare D1 Integration"
description: "Implement Cloudflare D1 client for cloud database sync"
status: pending
priority: P2
effort: 5h
tags: [cloudflare, d1, database, sync]
created: 2026-03-18
---

# Phase 04: Cloudflare D1 Integration

## Context Links
- Parent: [plan.md](./plan.md)
- Local DB: [phase-02-local-sqlite.md](./phase-02-local-sqlite.md)
- Cloudflare D1 Docs: https://developers.cloudflare.com/d1/

## Overview

Implement Cloudflare D1 client for syncing asset metadata to the cloud. D1 is SQLite-compatible and runs at the edge.

## Authentication

- **Per-device API token** stored securely in `electron-store` (Settings UI)
- Token has `D1:Edit` permission only (minimal scope)
- Token never exposed to renderer process
- Configured once per device, persisted across app restarts

```typescript
// electron-store settings
interface DeviceSyncAuth {
  apiToken: string;       // Cloudflare API token (D1:Edit + R2:Edit)
  accountId: string;      // Cloudflare account ID
  databaseId: string;     // D1 database ID
  deviceId: string;       // Auto-generated unique device identifier
}
```

## Architecture

```
electron/assets/sync/
├── d1-client.ts        # D1 API client (HTTP-based)
├── sync-manager.ts     # Orchestrates sync between local and D1
├── conflict-resolver.ts # Handles merge conflicts
└── index.ts
```

## Cloudflare D1 API

D1 uses HTTP endpoints via Cloudflare API:

```bash
# Query endpoint
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query

# With per-device API token
Authorization: Bearer {api_token}
Content-Type: application/json

{
  "sql": "SELECT * FROM assets WHERE id = ?",
  "params": ["abc123"]
}
```

## Implementation

### d1-client.ts

```typescript
interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

interface D1QueryResult<T = unknown> {
  success: boolean;
  error?: string;
  results?: T[];
  meta?: {
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

export class D1Client {
  private config: D1Config;
  private baseUrl: string;

  constructor(config: D1Config) {
    this.config = config;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}`;
  }

  // Execute single query
  async query<T = unknown>(
    sql: string,
    params: unknown[] = []
  ): Promise<D1QueryResult<T>> {
    try {
      const response = await fetch(`${this.baseUrl}/query`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

      const data = await response.json();

      if (!data.success) {
        return { success: false, error: data.errors?.[0]?.message || "D1 query failed" };
      }

      return {
        success: true,
        results: data.result?.[0]?.results || [],
        meta: {
          duration: data.result?.[0]?.meta?.duration || 0,
          rows_read: data.result?.[0]?.meta?.rows_read || 0,
          rows_written: data.result?.[0]?.meta?.rows_written || 0,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // Execute multiple queries in transaction (batch)
  async batch(queries: Array<{ sql: string; params?: unknown[] }>): Promise<D1QueryResult[]> {
    // D1 doesn't support true batching via REST; sequential queries
    // For production, consider using a Worker with D1 binding for true transactions
    const results: D1QueryResult[] = [];

    for (const query of queries) {
      const result = await this.query(query.sql, query.params || []);
      results.push(result);
      if (!result.success) break;
    }

    return results;
  }

  // Check connection
  async ping(): Promise<boolean> {
    const result = await this.query("SELECT 1 as ping");
    return result.success && (result.results?.[0] as any)?.ping === 1;
  }

  // Get schema version
  async getSchemaVersion(): Promise<number> {
    const result = await this.query<{ version: number }>(
      "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
    );
    return result.results?.[0]?.version || 0;
  }

  // Initialize remote schema
  async initializeSchema(schemaSql: string): Promise<boolean> {
    const statements = schemaSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      const result = await this.query(statement);
      if (!result.success) {
        console.error("[D1] Failed to execute:", statement, result.error);
        return false;
      }
    }

    return true;
  }
}
```

### sync-manager.ts

```typescript
import { D1Client } from "./d1-client";
import { assetsRepo } from "../db/assets.repo";
import { foldersRepo } from "../db/folders.repo";
import { tagsRepo } from "../db/tags.repo";
import { syncRepo } from "../db/sync.repo";
import type { AssetMetadata, AssetFolder, TagCategory } from "@/types/asset";

export interface SyncConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
  deviceId: string; // Unique identifier for this device
}

export interface SyncResult {
  success: boolean;
  uploaded: { assets: number; folders: number; categories: number };
  downloaded: { assets: number; folders: number; categories: number };
  conflicts: number;
  errors: string[];
  duration: number;
}

export class SyncManager {
  private d1: D1Client;
  private deviceId: string;
  private isSyncing = false;

  constructor(config: SyncConfig) {
    this.d1 = new D1Client({
      accountId: config.accountId,
      databaseId: config.databaseId,
      apiToken: config.apiToken,
    });
    this.deviceId = config.deviceId;
  }

  // Full bidirectional sync
  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        uploaded: { assets: 0, folders: 0, categories: 0 },
        downloaded: { assets: 0, folders: 0, categories: 0 },
        conflicts: 0,
        errors: ["Sync already in progress"],
        duration: 0,
      };
    }

    this.isSyncing = true;
    const startTime = Date.now();

    const result: SyncResult = {
      success: false,
      uploaded: { assets: 0, folders: 0, categories: 0 },
      downloaded: { assets: 0, folders: 0, categories: 0 },
      conflicts: 0,
      errors: [],
      duration: 0,
    };

    try {
      // 1. Check connection
      const connected = await this.d1.ping();
      if (!connected) {
        result.errors.push("Failed to connect to D1");
        return result;
      }

      // 2. Upload pending changes
      const uploadResult = await this.uploadPending();
      result.uploaded = uploadResult.uploaded;
      result.errors.push(...uploadResult.errors);

      // 3. Download remote changes
      const downloadResult = await this.downloadChanges();
      result.downloaded = downloadResult.downloaded;
      result.conflicts = downloadResult.conflicts;
      result.errors.push(...downloadResult.errors);

      // 4. Clean up synced deleted items
      await this.cleanupSyncedDeleted();

      // 5. Update sync state
      syncRepo.setState("lastSyncAt", new Date().toISOString());
      syncRepo.setState("deviceId", this.deviceId);

      result.success = result.errors.length === 0;
    } catch (error) {
      result.errors.push(`Sync failed: ${(error as Error).message}`);
    } finally {
      result.duration = Date.now() - startTime;
      this.isSyncing = false;
    }

    return result;
  }

  get syncing(): boolean {
    return this.isSyncing;
  }

  // Upload pending local changes
  private async uploadPending(): Promise<{
    uploaded: { assets: number; folders: number; categories: number };
    errors: string[];
  }> {
    const uploaded = { assets: 0, folders: 0, categories: 0 };
    const errors: string[] = [];

    const pending = syncRepo.getPendingItems();

    // Upload folders
    for (const folderId of pending.folders) {
      const result = await this.uploadFolder(folderId);
      if (result.success) {
        uploaded.folders++;
        syncRepo.markAsSynced("folders", [folderId]);
      } else {
        errors.push(`Folder ${folderId}: ${result.error}`);
      }
    }

    // Upload tag categories (tags as JSON — no junction table)
    for (const categoryId of pending.categories) {
      const result = await this.uploadTagCategory(categoryId);
      if (result.success) {
        uploaded.categories++;
        syncRepo.markAsSynced("tag_categories", [categoryId]);
      } else {
        errors.push(`Tag category ${categoryId}: ${result.error}`);
      }
    }

    // Upload assets (tags as JSON, folder_id direct — no junction tables)
    for (const assetId of pending.assets) {
      const result = await this.uploadAsset(assetId);
      if (result.success) {
        uploaded.assets++;
        syncRepo.markAsSynced("assets", [assetId]);
      } else {
        errors.push(`Asset ${assetId}: ${result.error}`);
      }
    }

    // Upload deleted items
    const deleted = syncRepo.getDeletedItems();
    for (const item of deleted) {
      const result = await this.uploadDeleted(item);
      if (result.success) {
        syncRepo.markDeletedSynced([item.id]);
      }
    }

    return { uploaded, errors };
  }

  // Upload single asset (tags as JSON, folder_id direct)
  private async uploadAsset(assetId: string): Promise<{ success: boolean; error?: string }> {
    const asset = assetsRepo.getById(assetId);
    if (!asset) {
      return { success: false, error: "Asset not found" };
    }

    const result = await this.d1.query(
      `INSERT OR REPLACE INTO assets (
        id, file_path, file_name, type, model_id, created_at, updated_at,
        file_size, favorite, prediction_id, result_index, original_url,
        source, workflow_id, workflow_name, node_id, execution_id,
        folder_id, tags, device_id, sync_status, synced_at, version, cloud_r2_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?)`,
      [
        asset.id,
        asset.filePath,
        asset.fileName,
        asset.type,
        asset.modelId,
        asset.createdAt,
        new Date().toISOString(),
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
        asset.folderId ?? null,           // Direct FK (no junction table)
        JSON.stringify(asset.tags),       // JSON array (no normalized tags table)
        this.deviceId,
        new Date().toISOString(),
        1,    // version
        null, // cloud_r2_key - set in R2 upload
      ]
    );

    return result;
  }

  // Upload folder
  private async uploadFolder(folderId: string): Promise<{ success: boolean; error?: string }> {
    const folders = foldersRepo.getAll();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) {
      return { success: false, error: "Folder not found" };
    }

    const result = await this.d1.query(
      `INSERT OR REPLACE INTO folders (id, name, color, icon, created_at, updated_at, device_id, sync_status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', 1)`,
      [folder.id, folder.name, folder.color, folder.icon ?? null, folder.createdAt, folder.createdAt, this.deviceId]
    );

    return result;
  }

  // Upload tag category (tags as JSON — no junction table)
  private async uploadTagCategory(categoryId: string): Promise<{ success: boolean; error?: string }> {
    const categories = tagsRepo.getAllCategories();
    const category = categories.find((c) => c.id === categoryId);
    if (!category) {
      return { success: false, error: "Tag category not found" };
    }

    const result = await this.d1.query(
      `INSERT OR REPLACE INTO tag_categories (id, name, color, tags, created_at, updated_at, device_id, sync_status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', 1)`,
      [category.id, category.name, category.color, JSON.stringify(category.tags), category.createdAt, category.createdAt, this.deviceId]
    );

    return result;
  }

  // Upload deleted item
  private async uploadDeleted(item: {
    id: string;
    entityType: string;
    originalId: string;
  }): Promise<{ success: boolean; error?: string }> {
    const table = item.entityType === "folder" ? "folders"
      : item.entityType === "tag_category" ? "tag_categories"
      : "assets";
    const result = await this.d1.query(`DELETE FROM ${table} WHERE id = ?`, [item.originalId]);
    return result;
  }

  // Download remote changes
  private async downloadChanges(): Promise<{
    downloaded: { assets: number; folders: number; categories: number };
    conflicts: number;
    errors: string[];
  }> {
    const downloaded = { assets: 0, folders: 0, categories: 0 };
    const errors: string[] = [];
    let conflicts = 0;

    const lastSync = syncRepo.getState("lastSyncAt");
    const lastSyncDate = lastSync ? new Date(lastSync).toISOString() : "1900-01-01T00:00:00.000Z";

    // Download folders updated since last sync
    const foldersResult = await this.d1.query(
      `SELECT * FROM folders WHERE updated_at > ? AND sync_status != 'deleted'`,
      [lastSyncDate]
    );

    if (foldersResult.success && foldersResult.results) {
      for (const row of foldersResult.results) {
        const merged = this.mergeFolder(row as any);
        if (merged === "created") downloaded.folders++;
        if (merged === "conflict") conflicts++;
      }
    }

    // Download tag categories (tags embedded as JSON)
    const categoriesResult = await this.d1.query(
      `SELECT * FROM tag_categories WHERE updated_at > ? AND sync_status != 'deleted'`,
      [lastSyncDate]
    );

    if (categoriesResult.success && categoriesResult.results) {
      for (const row of categoriesResult.results) {
        const merged = this.mergeTagCategory(row as any);
        if (merged === "created") downloaded.categories++;
        if (merged === "conflict") conflicts++;
      }
    }

    // Download assets (paginated, tags + folder_id embedded)
    let offset = 0;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const assetsResult = await this.d1.query(
        `SELECT * FROM assets WHERE updated_at > ? AND sync_status != 'deleted' ORDER BY updated_at ASC LIMIT ? OFFSET ?`,
        [lastSyncDate, pageSize, offset]
      );

      if (assetsResult.success && assetsResult.results) {
        for (const row of assetsResult.results) {
          const merged = this.mergeAsset(row as any);
          if (merged === "created") downloaded.assets++;
          if (merged === "conflict") conflicts++;
        }

        hasMore = assetsResult.results.length === pageSize;
        offset += pageSize;
      } else {
        hasMore = false;
      }
    }

    return { downloaded, conflicts, errors };
  }

  // Merge remote folder (create or update)
  private mergeFolder(remote: any): "created" | "updated" | "conflict" | "skipped" {
    const local = foldersRepo.getAll().find((f) => f.id === remote.id);

    if (!local) {
      foldersRepo.create({ name: remote.name, color: remote.color, icon: remote.icon });
      return "created";
    }

    if (remote.version > (remote as any).localVersion) {
      foldersRepo.update(remote.id, { name: remote.name, color: remote.color, icon: remote.icon });
      return "updated";
    }

    return "skipped";
  }

  // Merge remote tag category (tags as JSON — no junction table query needed)
  private mergeTagCategory(remote: any): "created" | "updated" | "conflict" | "skipped" {
    const local = tagsRepo.getAllCategories().find((c) => c.id === remote.id);

    if (!local) {
      const tags = JSON.parse(remote.tags || "[]");
      tagsRepo.createCategory(remote.name, remote.color, tags);
      return "created";
    }

    if (remote.version > (remote as any).localVersion) {
      const tags = JSON.parse(remote.tags || "[]");
      tagsRepo.updateCategory(remote.id, { name: remote.name, color: remote.color, tags });
      return "updated";
    }

    return "skipped";
  }

  // Merge remote asset (tags as JSON, folder_id direct — no junction queries)
  private mergeAsset(remote: any): "created" | "updated" | "conflict" | "skipped" {
    const local = assetsRepo.getById(remote.id);

    if (!local) {
      const tags = JSON.parse(remote.tags || "[]");
      assetsRepo.insert({
        id: remote.id,
        filePath: remote.file_path,
        fileName: remote.file_name,
        type: remote.type,
        modelId: remote.model_id,
        createdAt: remote.created_at,
        fileSize: remote.file_size,
        favorite: remote.favorite === 1,
        predictionId: remote.prediction_id ?? undefined,
        resultIndex: remote.result_index,
        originalUrl: remote.original_url ?? undefined,
        source: remote.source ?? undefined,
        workflowId: remote.workflow_id ?? undefined,
        workflowName: remote.workflow_name ?? undefined,
        nodeId: remote.node_id ?? undefined,
        executionId: remote.execution_id ?? undefined,
        folderId: remote.folder_id ?? undefined,
        tags,
      });
      return "created";
    }

    // Version-based conflict resolution
    if (remote.version > local.version) {
      const tags = JSON.parse(remote.tags || "[]");
      assetsRepo.update(remote.id, {
        favorite: remote.favorite === 1,
        tags,
        folderId: remote.folder_id ?? undefined,
      });
      return "updated";
    }

    return "skipped";
  }

  // Cleanup synced deleted items
  private async cleanupSyncedDeleted(): Promise<void> {
    // After full sync cycle, mark local tombstones as synced
    const deleted = syncRepo.getDeletedItems();
    if (deleted.length > 0) {
      syncRepo.markDeletedSynced(deleted.map((d) => d.id));
    }
  }
}
```

## Configuration

### Settings Store Extension

```typescript
// src/stores/settingsStore.ts - add sync config

export interface AssetsSyncConfig {
  enabled: boolean;
  accountId?: string;
  databaseId?: string;
  apiToken?: string;     // Per-device API token (stored securely)
  deviceId?: string;     // Auto-generated UUID per device
  autoSync: boolean;
  syncInterval: number;  // minutes (default: 15)
}

interface SettingsState {
  // ... existing
  assetsSyncConfig: AssetsSyncConfig;
  setAssetsSyncConfig: (config: AssetsSyncConfig) => void;
}
```

## Implementation Steps

1. [ ] Create `electron/assets/sync/` directory
2. [ ] Implement `d1-client.ts` with query and batch methods
3. [ ] Implement `sync-manager.ts` with upload/download (simplified schema)
4. [ ] Add sync config to settings store with per-device API token
5. [ ] Add IPC handlers for sync operations in `ipc-handlers.ts`
6. [ ] Add sync status indicator to UI
7. [ ] Test sync with mock D1 data
8. [ ] Test conflict resolution

## Success Criteria

- Can connect to D1 using per-device API token
- Upload/download uses simplified schema (JSON tags, direct folder_id)
- No junction table queries (asset_tags, asset_folders, category_tags)
- Conflict resolution works (version-based)
- Sync state persisted correctly
- Rate limiting respected

## Security Considerations

- Per-device API token stored securely in electron-store (not localStorage)
- Token never exposed to renderer process
- HTTPS only for D1 API
- Token has minimal permissions (D1:Edit only)
- Device ID auto-generated on first sync setup

## Unresolved Questions

1. Should we use Cloudflare Workers with D1 bindings for better performance?
2. Should we implement incremental sync instead of full sync?

## Next Steps

[Phase 05: Cloudflare R2 Integration](./phase-05-r2-integration.md)
