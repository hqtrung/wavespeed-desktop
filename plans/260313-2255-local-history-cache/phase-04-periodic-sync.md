# Phase 4: Periodic Background Sync

**Status:** ✅ completed | **Priority:** P2 | **Effort:** 1h | **Completed:** 2026-03-14

## Overview

Create background service that periodically syncs history with the API. Sync runs every 5 minutes (configurable), pauses when app is hidden, and stops when user navigates away from History page.

## Context Links

- Phase 2: `phase-02-historypage-integration.md` (HistoryPage sync status)
- HistoryPage: `src/pages/HistoryPage.tsx`
- API client: `src/api/client.ts`
- IPC client: `src/ipc/history.ts`

## Key Insights

1. **Use setInterval**: Simple timer-based periodic sync
2. **Pause on visibility hidden**: Don't waste resources when app not visible
3. **Configurable interval**: Default 5 min, could become setting later
4. **Server wins**: Bulk upsert API results to cache
5. **Status updates**: Show syncing state during fetch

## Data Flow

```
HistorySyncService
    │
    ├──> start() called from Layout or HistoryPage
    │         │
    │         └──> setInterval(syncOnce, 5min)
    │                   │
    │                   └──> syncOnce()
    │                             │
    │                             ├──> apiClient.getHistory()
    │                             ├──> historyCacheIpc.upsertBulk()
    │                             └──> Emit status update
    │
    └──> stop() called on unmount/cleanup
              └──> clearInterval()
```

## Related Code Files

### Create

| File | Purpose |
|------|---------|
| `src/lib/history-sync.ts` | Background sync service class |

### Modify

| File | Changes |
|------|---------|
| `src/pages/HistoryPage.tsx` | Start/stop sync service |
| `src/components/layout/Layout.tsx` | Alternative: app-wide sync |

## Implementation Steps

### Step 1: Create sync service

`src/lib/history-sync.ts`:

```typescript
import { apiClient } from "@/api/client";
import { historyCacheIpc } from "@/ipc/history";
import type { HistoryItem } from "@/types/prediction";

export type SyncStatus = "idle" | "syncing" | "success" | "error";
export type SyncListener = (status: SyncStatus, error?: Error) => void;

interface HistorySyncOptions {
  interval?: number; // milliseconds, default 5 minutes
  enabled?: boolean; // allow disabling
}

export class HistorySyncService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<SyncListener> = new Set();
  private status: SyncStatus = "idle";
  private currentError: Error | null = null;
  private intervalMs: number;
  private enabled: boolean;

  constructor(options: HistorySyncOptions = {}) {
    this.intervalMs = options.interval ?? 5 * 60 * 1000; // 5 minutes
    this.enabled = options.enabled ?? true;
  }

  // Subscribe to status changes
  onStatusChange(callback: SyncListener): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(status: SyncStatus, error?: Error): void {
    this.status = status;
    this.currentError = error ?? null;
    this.listeners.forEach((cb) => cb(status, error));
  }

  getStatus(): { status: SyncStatus; error: Error | null } {
    return { status: this.status, error: this.currentError };
  }

  // Single sync operation
  async syncOnce(): Promise<{ success: boolean; count?: number; error?: Error }> {
    if (!this.enabled) {
      return { success: false };
    }

    this.emit("syncing");

    try {
      // Fetch recent history from API (last 24h default)
      const response = await apiClient.getHistory(1, 100);

      const items = response.items || [];

      // Bulk upsert to cache
      await historyCacheIpc.upsertBulk(items);

      this.emit("success");
      return { success: true, count: items.length };
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Sync failed");
      this.emit("error", error);
      return { success: false, error };
    }
  }

  // Start periodic sync
  start(): void {
    if (this.intervalId || !this.enabled) return;

    // Initial sync
    this.syncOnce().catch(console.error);

    // Periodic sync
    this.intervalId = setInterval(() => {
      this.syncOnce().catch(console.error);
    }, this.intervalMs);
  }

  // Stop periodic sync
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Pause sync (e.g., when page hidden)
  pause(): void {
    this.stop();
  }

  // Resume sync
  resume(): void {
    this.start();
  }

  // Update configuration
  setOptions(options: Partial<HistorySyncOptions>): void {
    if (options.interval !== undefined) {
      this.intervalMs = options.interval;
      // Restart if interval changed
      if (this.intervalId) {
        this.stop();
        this.start();
      }
    }
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
      if (!this.enabled) {
        this.stop();
      }
    }
  }

  // Cleanup
  destroy(): void {
    this.stop();
    this.listeners.clear();
  }
}

// Singleton instance
let syncService: HistorySyncService | null = null;

export function getHistorySyncService(): HistorySyncService {
  if (!syncService) {
    syncService = new HistorySyncService();
  }
  return syncService;
}
```

### Step 2: Integrate into HistoryPage

`src/pages/HistoryPage.tsx`:

Add sync service initialization:

```typescript
import { getHistorySyncService, type SyncStatus } from "@/lib/history-sync";

export function HistoryPage() {
  // ... existing state ...

  // Sync service state
  const [syncServiceStatus, setSyncServiceStatus] = useState<SyncStatus>("idle");

  useEffect(() => {
    const syncService = getHistorySyncService();

    // Subscribe to status changes
    const unsubscribe = syncService.onStatusChange((status, error) => {
      setSyncServiceStatus(status);
      if (status === "error") {
        console.error("[History Sync] Error:", error);
      }
    });

    // Start sync service when on history page
    syncService.start();

    // Handle visibility change
    const handleVisibilityChange = () => {
      if (document.hidden) {
        syncService.pause();
      } else {
        syncService.resume();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unsubscribe();
      syncService.stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // ... rest of component ...
}
```

### Step 3: Update sync status badge to show service status

Modify the sync badge from Phase 2 to also reflect background sync:

```typescript
// Combine cache sync status + background sync status
const displaySyncStatus = syncServiceStatus === "syncing"
  ? "syncing"
  : syncServiceStatus === "error"
    ? "error"
    : syncStatus; // Fall back to cache status
```

### Step 4: Add manual sync button

Add to header actions:

```typescript
<Button
  variant="outline"
  size="sm"
  onClick={() => {
    const syncService = getHistorySyncService();
    syncService.syncOnce();
  }}
  disabled={syncServiceStatus === "syncing"}
>
  {syncServiceStatus === "syncing" ? (
    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
  ) : (
    <CloudDownload className="mr-2 h-4 w-4" />
  )}
  {t("history.syncNow")}
</Button>
```

### Step 5: Alternative: App-wide sync in Layout

If we want sync to run even when not on History page:

`src/components/layout/Layout.tsx`:

```typescript
import { useEffect } from "react";
import { getHistorySyncService } from "@/lib/history-sync";

export function Layout() {
  // ... existing code ...

  useEffect(() => {
    // Only start if user has valid API key
    if (isValidated) {
      const syncService = getHistorySyncService();

      // Pause when app hidden (entire window)
      const handleVisibilityChange = () => {
        if (document.hidden) {
          syncService.pause();
        } else {
          syncService.resume();
        }
      };

      syncService.start();
      document.addEventListener("visibilitychange", handleVisibilityChange);

      return () => {
        syncService.destroy();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    }
  }, [isValidated]);

  // ... rest of component ...
}
```

**Decision**: Start with HistoryPage-only sync (simpler). Move to Layout later if needed.

### Step 6: Add configuration option (future)

Add to settings page for configurable interval:

```typescript
// In settingsStore
interface Settings {
  historySyncInterval?: number; // minutes, default 5
  historySyncEnabled?: boolean; // default true
}
```

This can be added in a future phase. For now, use 5-minute hardcoded.

## Success Criteria

- [x] Sync service starts when HistoryPage mounts
- [x] Sync runs every 5 minutes while on page
- [x] Sync pauses when browser tab hidden
- [x] Sync status updates visible in UI
- [x] Manual sync button works
- [x] Service cleanup on unmount
- [x] No memory leaks (listeners cleared)

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Duplicate sync requests | Low | Check if already syncing before new request |
| API rate limiting | Low | 5-minute interval is conservative |
| Battery drain on mobile | Low | Pause when tab hidden |
| Memory leak from listeners | Low | Proper cleanup in useEffect |

## Next Steps

After this phase, proceed to [Phase 5: Offline Mode](phase-05-offline-mode.md)
