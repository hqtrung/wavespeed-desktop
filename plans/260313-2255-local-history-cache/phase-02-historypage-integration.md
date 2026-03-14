# Phase 2: HistoryPage Integration

**Status:** ✅ completed | **Priority:** P1 | **Effort:** 2h | **Completed:** 2026-03-14

## Overview

Integrate history cache into HistoryPage with cache-first loading strategy. Page reads from local cache instantly, then syncs with API in background. Server wins on conflicts (API data overwrites cache).

## Context Links

- Phase 1: `phase-01-storage-layer.md` (IPC client available)
- Existing: `src/pages/HistoryPage.tsx`
- API client: `src/api/client.ts`
- Types: `src/types/prediction.ts`, `src/types/history-cache.ts`

## Key Insights

1. **Cache-first UX**: Show cached data immediately, sync in background
2. **Server wins**: On API success, upsert all results to cache (fresh data)
3. **Sync status indicator**: Visual feedback (synced/syncing/offline/error)
4. **Offline graceful**: If API fails, still show cached data
5. **Preserve existing filters**: Status filter, pagination work with cache

## Data Flow

```
HistoryPage mount
    │
    ├──> Try cache: historyCacheIpc.list()
    │         │
    │         ├──> Success? Show immediately + set "synced" status
    │         └──> Empty/First run? Show loading spinner
    │
    └──> Background API fetch (if online)
              │
              ├──> Success? Upsert to cache + update UI + set "synced"
              └──> Error? Show "offline" badge, keep cached data
```

## Related Code Files

### Modify

| File | Changes |
|------|---------|
| `src/pages/HistoryPage.tsx` | Add cache-first loading, sync status UI |
| `src/ipc/history.ts` | Already created in Phase 1 |

## Implementation Steps

### Step 1: Add sync state to HistoryPage

Add new state variables:

```typescript
// Sync state
type SyncStatus = "synced" | "syncing" | "offline" | "error";
const [syncStatus, setSyncStatus] = useState<SyncStatus>("syncing");
const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
const [isOnline, setIsOnline] = useState(true);
```

### Step 2: Create cache-first fetch function

Replace `fetchHistory` with cache-first version:

```typescript
const fetchHistory = useCallback(async () => {
  // 1. Try cache first for instant display
  try {
    const cached = await historyCacheIpc.list({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      status: statusFilter !== "all" ? statusFilter : undefined,
    });
    if (cached.length > 0) {
      setItems(cached);
      setSyncStatus("syncing"); // Will try API next
    }
  } catch (err) {
    console.error("[History] Cache fetch failed:", err);
  }

  // 2. If offline or no API key, stop here
  if (!isValidated || !isOnline) {
    setSyncStatus("offline");
    setIsLoading(false);
    return;
  }

  // 3. Sync with API
  try {
    const filters =
      statusFilter !== "all"
        ? { status: statusFilter as "completed" | "failed" | "processing" | "created" }
        : undefined;

    const response = await apiClient.getHistory(page, pageSize, filters);
    const apiItems = response.items || [];

    // 4. Upsert to cache (server wins)
    await historyCacheIpc.upsertBulk(apiItems);

    // 5. Update UI with fresh data
    setItems(apiItems);
    setSyncStatus("synced");
    setLastSyncTime(new Date().toISOString());
    setError(null);
  } catch (err) {
    console.error("[History] API fetch error:", err);

    // If we have cached items, show them with offline badge
    if (items.length > 0) {
      setSyncStatus("offline");
    } else {
      setError(err instanceof Error ? err.message : "Failed to fetch history");
      setSyncStatus("error");
    }
  } finally {
    setIsLoading(false);
  }
}, [isValidated, page, pageSize, statusFilter, isOnline, items.length]);
```

### Step 3: Add sync status indicator to header

Add badge after refresh button:

```typescript
{/* Sync Status Badge */}
{syncStatus === "synced" && (
  <Badge variant="outline" className="h-9 gap-1 text-xs">
    <Check className="h-3 w-3" />
    {t("history.synced")}
  </Badge>
)}
{syncStatus === "syncing" && (
  <Badge variant="outline" className="h-9 gap-1 text-xs">
    <RefreshCw className="h-3 w-3 animate-spin" />
    {t("history.syncing")}
  </Badge>
)}
{syncStatus === "offline" && (
  <Badge variant="secondary" className="h-9 gap-1 text-xs">
    {lastSyncTime
      ? t("history.lastSyncedAt", { time: formatDistanceToNow(new Date(lastSyncTime)) })
      : t("history.offline")}
  </Badge>
)}
{syncStatus === "error" && (
  <Badge variant="destructive" className="h-9 gap-1 text-xs">
    <AlertCircle className="h-3 w-3" />
    {t("history.syncError")}
  </Badge>
)}
```

### Step 4: Add network detection

Detect online/offline state:

```typescript
useEffect(() => {
  const handleOnline = () => setIsOnline(true);
  const handleOffline = () => setIsOnline(false);

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Initial state
  setIsOnline(navigator.onLine);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}, []);

// Re-fetch when coming back online
useEffect(() => {
  if (isOnline && syncStatus === "offline") {
    fetchHistory();
  }
}, [isOnline, syncStatus, fetchHistory]);
```

### Step 5: Update delete to sync cache

After successful API delete, also remove from cache:

```typescript
const handleDelete = useCallback(
  async (item: HistoryItem) => {
    setIsDeleting(true);
    try {
      await apiClient.deletePrediction(item.id);
      // Remove from cache too
      await historyCacheIpc.delete(item.id);
      setItems((prevItems) =>
        prevItems.filter((existing) => existing.id !== item.id),
      );
      if (selectedItem?.id === item.id) {
        setSelectedItem(null);
      }
      toast({ title: t("history.deleted") });
    } catch (err) {
      toast({
        title: t("common.error"),
        description: err instanceof Error ? err.message : t("history.deleteFailed"),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmItem(null);
    }
  },
  [selectedItem?.id, t],
);
```

### Step 6: Update bulk delete similarly

```typescript
const handleBulkDelete = useCallback(async () => {
  if (selectedIds.size === 0) return;
  setIsDeleting(true);
  const idsToDelete = Array.from(selectedIds);
  const idsSet = new Set(idsToDelete);
  try {
    await apiClient.deletePredictions(idsToDelete);
    // Delete from cache
    await Promise.all(idsToDelete.map((id) => historyCacheIpc.delete(id)));
    setItems((prevItems) =>
      prevItems.filter((existing) => !idsSet.has(existing.id)),
    );
    if (selectedItem && idsSet.has(selectedItem.id)) {
      setSelectedItem(null);
    }
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    toast({
      title: t("history.deletedBulk"),
      description: t("history.deletedBulkDesc", { count: idsToDelete.length }),
    });
  } catch (err) {
    toast({
      title: t("common.error"),
      description: err instanceof Error ? err.message : t("history.deleteFailed"),
      variant: "destructive",
    });
  } finally {
    setIsDeleting(false);
    setShowBulkDeleteConfirm(false);
  }
}, [selectedIds, selectedItem, t]);
```

### Step 7: Load initial sync stats

On mount, get cache stats for initial state:

```typescript
useEffect(() => {
  const loadStats = async () => {
    try {
      const stats = await historyCacheIpc.stats();
      if (stats.lastSyncTime) {
        setLastSyncTime(stats.lastSyncTime);
        if (stats.totalCount > 0) {
          setSyncStatus("synced");
        }
      }
    } catch {
      // Ignore stats errors
    }
  };
  loadStats();
}, []);
```

### Step 8: Update refresh button to force sync

Make refresh button always try API (even if offline):

```typescript
<Button
  variant="outline"
  size="sm"
  onClick={() => {
    setSyncStatus("syncing");
    fetchHistory();
  }}
  disabled={isLoading || !isOnline}
  title={!isOnline ? t("history.offlineRefreshDisabled") : undefined}
>
  <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
  {t("common.refresh")}
</Button>
```

### Step 9: Add i18n strings

Add to each locale file (`src/i18n/locales/en.json`):

```json
{
  "history": {
    "synced": "Synced",
    "syncing": "Syncing...",
    "offline": "Offline",
    "syncError": "Sync Error",
    "lastSyncedAt": "Last synced {{time}} ago",
    "offlineRefreshDisabled": "Refresh unavailable offline"
  }
}
```

## Success Criteria

- [x] Page loads instantly from cache (<100ms with cached data)
- [x] Sync status badge shows correct state
- [x] Offline mode shows cached data with "offline" badge
- [x] API success updates cache and UI
- [x] Delete operations sync to cache
- [x] Network changes trigger re-sync when coming online
- [x] Existing filters (status, pagination) work with cache

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cache-API data inconsistency | Medium | Server wins - API data always replaces cache |
| Stale cache after long offline | Low | Show "last synced X time ago" badge |
| Large cache slow to load | Low | Pagination + indexed queries |

## Next Steps

After this phase, proceed to [Phase 3: Real-time Sync](phase-03-realtime-sync.md)
