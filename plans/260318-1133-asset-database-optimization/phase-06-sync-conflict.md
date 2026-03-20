---
title: "Phase 06: Sync & Conflict Resolution"
description: "Implement comprehensive sync orchestration and conflict resolution UI"
status: pending
priority: P2
effort: 3h
tags: [sync, conflict, ui, offline]
created: 2026-03-18
---

# Phase 06: Sync & Conflict Resolution

## Context Links
- Parent: [plan.md](./plan.md)
- D1 Integration: [phase-04-d1-integration.md](./phase-04-d1-integration.md)
- R2 Integration: [phase-05-r2-integration.md](./phase-05-r2-integration.md)

## Overview

Simplified sync for **low concurrency** use case:
- **Operations:** Delete, Move to folder, Tag (rare conflicts)
- **Strategy:** Version-based with higher version wins
- **Tag merge:** Union when same version (rare concurrent edit)

## Sync Trigger Strategy

Sync fires under three conditions:

| Trigger | When | Details |
|---------|------|----------|
| **Manual** | User clicks "Sync Now" button | Always available in UI |
| **App focus** | `BrowserWindow.focus` event | Debounced 5 seconds |
| **Timer** | Every 15 minutes (configurable) | Optional, enabled in Settings |

### Implementation

```typescript
// electron/assets/sync/sync-triggers.ts

import { BrowserWindow } from "electron";
import { SyncManager } from "./sync-manager";

export class SyncTriggerManager {
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private focusDebounce: ReturnType<typeof setTimeout> | null = null;
  private syncManager: SyncManager;

  constructor(syncManager: SyncManager) {
    this.syncManager = syncManager;
  }

  // Setup all triggers
  setupTriggers(window: BrowserWindow, config: { timerEnabled: boolean; intervalMinutes: number }): void {
    // App focus trigger (debounced 5s)
    window.on("focus", () => {
      if (this.focusDebounce) clearTimeout(this.focusDebounce);
      this.focusDebounce = setTimeout(() => {
        this.syncManager.sync().catch(console.error);
      }, 5000);
    });

    // Optional timer trigger
    if (config.timerEnabled) {
      this.startTimer(config.intervalMinutes);
    }
  }

  // Start/restart timer
  startTimer(intervalMinutes: number = 15): void {
    this.stopTimer();
    this.syncTimer = setInterval(() => {
      this.syncManager.sync().catch(console.error);
    }, intervalMinutes * 60 * 1000);
  }

  stopTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // Manual trigger (called from IPC)
  async triggerManual(): Promise<void> {
    await this.syncManager.sync();
  }

  cleanup(): void {
    this.stopTimer();
    if (this.focusDebounce) clearTimeout(this.focusDebounce);
  }
}
```

## Authentication

Uses **per-device API token** configured in Settings (see Phase 04).

## Conflict Resolution Strategy

### Version-Based Resolution

```typescript
// Compare versions, higher wins
if (remote.version > local.version) {
  applyRemote();  // Remote changes win
} else if (local.version > remote.version) {
  keepLocal();    // Local wins (will upload later)
} else {
  // Same version = concurrent edit (rare!)
  mergeIfPossible();  // For tags: union, others: local wins
}
```

### Operation Handling

| Operation | Sync Behavior |
|-----------|--------------|
| **Delete** | Set `sync_status='deleted'`, version++ → All devices see deleted |
| **Move** | Update `folder_id`, version++ → Latest folder wins |
| **Tag** | Update `tags` JSON, version++ → Higher wins, same version = union |
| **Favorite** | Update `favorite`, version++ → Higher wins |

### Delete Wins (Tombstone Pattern)

```typescript
// If remote has deletion with higher version
if (remote.sync_status === 'deleted' && remote.version > local.version) {
  // Remote deletion wins - mark local as deleted too
  applyRemoteDeletion();
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ AssetsPage   │  │ SyncIndicator│  │ SyncSettings     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                  │                   │             │
│         └──────────────────┴───────────────────┘             │
│                            │                                 │
│                    ┌───────▼────────┐                       │
│                    │ assetsStore.ts │                       │
│                    └───────┬────────┘                       │
└────────────────────────────┼─────────────────────────────────┘
                             │ IPC
┌────────────────────────────┼─────────────────────────────────┐
│                    Main Process │                             │
│                    ┌───────▼────────┐                       │
│                    │ sync-manager.ts │                       │
│                    └───────┬────────┘                       │
│           ┌────────────────┼────────────────┐               │
│           ▼                ▼                ▼               │
│    ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│    │  Local DB  │  │ D1 Client  │  │ R2 Client  │          │
│    └────────────┘  └────────────┘  └────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

## Implementation

### conflict-resolver.ts (Simplified)

```typescript
// electron/assets/sync/conflict-resolver.ts

export interface Conflict {
  id: string;
  entityType: "asset" | "folder" | "tag_category";
  localVersion: {
    id: string;
    version: number;
    data: any;
  };
  remoteVersion: {
    id: string;
    version: number;
    data: any;
  };
}

export interface ConflictResolution {
  conflictId: string;
  action: "keep_local" | "keep_remote" | "merged";
  mergedData?: any;
}

export class ConflictResolver {
  // Device ID for this instance
  constructor(private deviceId: string) {}

  // Resolve single conflict (auto, no UI needed for simple cases)
  resolve(conflict: Conflict): ConflictResolution {
    const local = conflict.localVersion;
    const remote = conflict.remoteVersion;

    // Case 1: Remote deletion wins (higher version)
    if (remote.data.sync_status === 'deleted' && remote.version > local.version) {
      return { conflictId: conflict.id, action: "keep_remote" };
    }

    // Case 2: Local deletion wins (higher version)
    if (local.data.sync_status === 'deleted' && local.version > remote.version) {
      return { conflictId: conflict.id, action: "keep_local" };
    }

    // Case 3: Version comparison
    if (remote.version > local.version) {
      return { conflictId: conflict.id, action: "keep_remote" };
    } else if (local.version > remote.version) {
      return { conflictId: conflict.id, action: "keep_local" };
    }

    // Case 4: Same version (concurrent edit - rare!)
    // For assets: merge tags, for others: keep local (device that initiated)
    if (conflict.entityType === "asset") {
      const localTags = JSON.parse(local.data.tags || "[]");
      const remoteTags = JSON.parse(remote.data.tags || "[]");
      const mergedTags = [...new Set([...localTags, ...remoteTags])];

      return {
        conflictId: conflict.id,
        action: "merged",
        mergedData: {
          ...local.data,
          tags: JSON.stringify(mergedTags),
          version: local.version + 1,
        }
      };
    }

    // Default: local wins (current device's operation)
    return { conflictId: conflict.id, action: "keep_local" };
  }

  // Batch resolve conflicts
  resolveBatch(conflicts: Conflict[]): Map<string, ConflictResolution> {
    const resolutions = new Map<string, ConflictResolution>();
    for (const conflict of conflicts) {
      resolutions.set(conflict.id, this.resolve(conflict));
    }
    return resolutions;
  }
}
```

### sync-manager.ts (Simplified)

```typescript
// electron/assets/sync/sync-manager.ts

export interface SyncConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  userId: string;
  deviceId: string;  // Unique device identifier
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  errors: string[];
}

export class SyncManager {
  private isSyncing = false;
  private d1: D1Client;
  private r2: R2Client;
  private resolver: ConflictResolver;

  constructor(
    private config: SyncConfig,
    private db: SQL.Database
  ) {
    this.d1 = new D1Client(config);
    this.r2 = new R2Client(config);
    this.resolver = new ConflictResolver(config.deviceId);
  }

  // Main sync orchestration
  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;
    const result: SyncResult = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, errors: [] };

    try {
      // 1. Download remote changes
      const remoteChanges = await this.d1.fetchChanges(this.getLastSyncTimestamp());
      result.downloaded = await this.applyRemoteChanges(remoteChanges);

      // 2. Upload local changes
      const localChanges = this.getLocalChanges();
      result.uploaded = await this.uploadLocalChanges(localChanges);

      // 3. Sync deletions (tombstones)
      result.deleted = await this.syncDeletions();

      // 4. Update last sync timestamp
      this.setLastSyncTimestamp(new Date().toISOString());

    } catch (error) {
      result.errors.push((error as Error).message);
    } finally {
      this.isSyncing = false;
    }

    return result;
  }

  // Apply remote changes to local DB
  private async applyRemoteChanges(changes: any[]): Promise<number> {
    let applied = 0;

    for (const change of changes) {
      const local = this.getLocalEntity(change.entity_type, change.id);

      if (!local) {
        // New entity - insert
        this.insertEntity(change.entity_type, change.data);
        applied++;
        continue;
      }

      // Check version conflict
      if (change.version > local.version) {
        // Remote wins - apply
        this.updateEntity(change.entity_type, change.data);
        applied++;
      } else if (change.version < local.version) {
        // Local wins - will upload on next cycle
        this.markForUpload(change.entity_type, change.id);
      } else {
        // Same version - potential concurrent edit
        // For tags: merge, for others: skip (no change)
        if (change.entity_type === "asset" && this.tagsDiffer(local, change.data)) {
          const localTags = JSON.parse(local.tags || "[]");
          const remoteTags = JSON.parse(change.data.tags || "[]");
          const merged = [...new Set([...localTags, ...remoteTags])];
          this.updateEntity("asset", { ...local, tags: JSON.stringify(merged), version: local.version + 1 });
          this.markForUpload("asset", change.id);  // Upload merged version
        }
      }
    }

    return applied;
  }

  // Upload local pending changes
  private async uploadLocalChanges(changes: any[]): Promise<number> {
    let uploaded = 0;

    for (const change of changes) {
      try {
        await this.d1.uploadChange(change);
        this.markSynced(change.entity_type, change.id);
        uploaded++;
      } catch (error) {
        console.error(`Failed to upload ${change.entity_type}/${change.id}:`, error);
      }
    }

    return uploaded;
  }

  // Helper methods
  private getLocalEntity(type: string, id: string): any | null {
    const table = type === "asset" ? "assets" : type === "folder" ? "folders" : "tag_categories";
    const row = this.db.exec(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    return row.length > 0 ? row[0] : null;
  }

  private insertEntity(type: string, data: any): void {
    const table = type === "asset" ? "assets" : type === "folder" ? "folders" : "tag_categories";
    // Build INSERT statement from data
    // ...
  }

  private updateEntity(type: string, data: any): void {
    const table = type === "asset" ? "assets" : type === "folder" ? "folders" : "tag_categories";
    // Build UPDATE statement from data
    // ...
  }

  private getLocalChanges(): any[] {
    // Fetch all with sync_status = 'pending'
    // ...
    return [];
  }

  private markForUpload(type: string, id: string): void {
    const table = type === "asset" ? "assets" : type === "folder" ? "folders" : "tag_categories";
    this.db.exec(`UPDATE ${table} SET sync_status = 'pending' WHERE id = ?`, [id]);
  }

  private markSynced(type: string, id: string): void {
    const table = type === "asset" ? "assets" : type === "folder" ? "folders" : "tag_categories";
    this.db.exec(`UPDATE ${table} SET sync_status = 'synced', synced_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
  }

  private tagsDiffer(a: any, b: any): boolean {
    return a.tags !== b.tags;
  }

  private getLastSyncTimestamp(): string {
    const row = this.db.exec("SELECT value FROM sync_state WHERE key = 'lastSyncAt'");
    return row.length > 0 ? row[0].value : "";
  }

  private setLastSyncTimestamp(timestamp: string): void {
    this.db.exec("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('lastSyncAt', ?, datetime('now'))", [timestamp]);
  }

  private getSyncStatus(): { enabled: boolean; lastSync: string | null; pending: number; isSyncing: boolean } {
    const pending = this.db.exec("SELECT COUNT(*) as count FROM assets WHERE sync_status = 'pending'")[0].count;
    const lastSync = this.getLastSyncTimestamp();

    return {
      enabled: true,
      lastSync,
      pending,
      isSyncing: this.isSyncing,
    };
  }
}
```

## IPC Handlers

```typescript
// electron/main.ts - add sync IPC handlers

let syncManagerInstance: SyncManager | null = null;

ipcMain.handle("get-sync-status", () => {
  if (!syncManagerInstance) {
    return { enabled: false, lastSync: null, pending: 0, isSyncing: false };
  }
  return syncManagerInstance.getSyncStatus();
});

ipcMain.handle("start-sync", async () => {
  if (!syncManagerInstance) {
    throw new Error("Sync not configured");
  }
  return await syncManagerInstance.sync();
});

ipcMain.handle("configure-sync", async (_, config: SyncConfig) => {
  const db = getAssetsDatabase(); // Get the assets DB instance
  syncManagerInstance = new SyncManager(config, db);
  return { success: true };
});
```

## UI Components (Minimal)

### Sync Indicator

```typescript
// src/components/sync/SyncIndicator.tsx

import { Cloud, CloudOff, RefreshCw } from "lucide-react";

export function SyncIndicator() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (window.electronAPI?.getSyncStatus) {
      window.electronAPI.getSyncStatus().then(setStatus);
    }
  }, []);

  if (!status?.enabled) return null;

  if (status.isSyncing) {
    return (
      <div className="flex items-center gap-2 text-sm text-blue-500">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span>Syncing...</span>
      </div>
    );
  }

  if (status.pending > 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-orange-500">
        <RefreshCw className="h-4 w-4" />
        <span>{status.pending} pending</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 text-sm text-green-500">
      <Cloud className="h-4 w-4" />
      <span>Synced</span>
    </div>
  );
}
```

## Implementation Steps

1. [ ] Implement `conflict-resolver.ts` with version-based logic
2. [ ] Implement `sync-manager.ts` with simplified sync
3. [ ] Implement `sync-triggers.ts` with manual + focus + timer triggers
4. [ ] Add sync IPC handlers in `ipc-handlers.ts`
5. [ ] Add `SyncIndicator` component
6. [ ] Add sync trigger settings to Settings UI
7. [ ] Test delete sync (tombstone)
8. [ ] Test move/folder sync
9. [ ] Test tag sync with merge
10. [ ] Test sync triggers (focus, timer)

## Success Criteria

- Delete syncs correctly across devices
- Move/folder syncs correctly
- Tag merge works on same-version conflict
- No data loss on conflicts
- Offline-first maintained
