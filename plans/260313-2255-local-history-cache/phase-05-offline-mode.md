# Phase 5: Offline Mode

**Status:** ✅ completed | **Priority:** P2 | **Effort:** 1.5h | **Completed:** 2026-03-14

## Overview

Implement graceful offline behavior - show cached data with visual indicators, disable server-dependent actions, allow "open in playground" when inputs are available.

## Context Links

- Phase 2: `phase-02-historypage-integration.md` (Network detection, offline badge)
- HistoryPage: `src/pages/HistoryPage.tsx`
- IPC client: `src/ipc/history.ts`

## Key Insights

1. **Detect offline**: No API key OR network error OR explicit offline state
2. **Disable server actions**: Delete, refresh require API - disable these buttons
3. **Allow local actions**: "Open in playground" works if inputs cached
4. **Clear visual feedback**: Offline badge, last synced time
5. **Auto-recovery**: When back online, trigger sync automatically

## Offline Detection

```
Offline when:
  1. !isValidated (no API key configured)
  2. !navigator.onLine (browser/network offline)
  3. API fetch failed (network error, timeout)

Online when:
  1. isValidated && navigator.onLine && (recent API success OR no prior error)
```

## Related Code Files

### Modify

| File | Changes |
|------|---------|
| `src/pages/HistoryPage.tsx` | Offline UI, disabled states, error recovery |

## Implementation Steps

### Step 1: Enhance offline state detection

```typescript
// Add more granular offline state
type OfflineReason = "no-api-key" | "network-offline" | "api-error" | null;

const [offlineReason, setOfflineReason] = useState<OfflineReason>(null);
const [isOnline, setIsOnline] = useState(true);

// Determine offline state
const isOffline = offlineReason !== null || !isValidated || !isOnline;

useEffect(() => {
  // Check API key
  if (!isValidated) {
    setOfflineReason("no-api-key");
    return;
  }

  // Check network
  if (!navigator.onLine) {
    setOfflineReason("network-offline");
    return;
  }

  // If we had an API error but now online, clear it
  if (offlineReason === "api-error" && navigator.onLine) {
    setOfflineReason(null);
  }
}, [isValidated, offlineReason]);
```

### Step 2: Update offline badge with reason

```typescript
{isOffline && (
  <Badge variant="secondary" className="h-9 gap-1.5 text-xs">
    <WifiOff className="h-3 w-3" />
    {offlineReason === "no-api-key" && t("history.offlineNoApiKey")}
    {offlineReason === "network-offline" && t("history.offlineNetwork")}
    {offlineReason === "api-error" && t("history.offlineApiError")}
    {!offlineReason && lastSyncTime
      ? t("history.lastSyncedAt", { time: formatDistanceToNow(new Date(lastSyncTime)) })
      : t("history.offline")}
  </Badge>
)}
```

### Step 3: Disable server-dependent buttons

```typescript
<Button
  variant="outline"
  size="sm"
  onClick={fetchHistory}
  disabled={isLoading || isOffline}
  title={isOffline ? t("history.offlineRefreshDisabled") : undefined}
>
  <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
  {t("common.refresh")}
</Button>

// Delete buttons (single and bulk)
<Button
  variant="destructive"
  size="sm"
  onClick={() => setDeleteConfirmItem(item)}
  disabled={isDeleting || isOffline}
  title={isOffline ? t("history.offlineDeleteDisabled") : undefined}
>
  <Trash2 className="h-4 w-4 mr-2" />
  {t("common.delete")}
</Button>
```

### Step 4: Allow "open in playground" with cached inputs

Update `handleOpenInPlayground` to prefer cache:

```typescript
const handleOpenInPlayground = useCallback(
  async (item: HistoryItem) => {
    const model = getModelById(item.model);
    if (!model) {
      toast({
        title: t("common.error"),
        description: t("history.modelNotAvailable"),
        variant: "destructive",
      });
      return;
    }

    // Priority 1: Check cache (includes inputs)
    try {
      const cached = await historyCacheIpc.get(item.id);
      if (cached?.inputs && Object.keys(cached.inputs).length > 0) {
        createTab(model, cached.inputs);
        setSelectedItem(null);
        navigate(`/playground/${encodeURIComponent(item.model)}`);
        return;
      }
    } catch {
      // Cache miss, continue to fallbacks
    }

    // Priority 2: Check predictionInputsStore (existing)
    const localEntry = getLocalInputs(item.id);
    if (localEntry?.inputs && Object.keys(localEntry.inputs).length > 0) {
      createTab(model, localEntry.inputs);
      setSelectedItem(null);
      navigate(`/playground/${encodeURIComponent(item.model)}`);
      return;
    }

    // Priority 3: Try API if online
    if (!isOffline) {
      setIsOpeningPlayground(true);
      try {
        const details = await apiClient.getPredictionDetails(item.id);
        const apiInput =
          (details as any).input || (details as any).inputs || {};
        createTab(
          model,
          Object.keys(apiInput).length > 0 ? apiInput : undefined,
        );
        setSelectedItem(null);
        navigate(`/playground/${encodeURIComponent(item.model)}`);
        return;
      } catch {
        // API failed, fall through to empty tab
      } finally {
        setIsOpeningPlayground(false);
      }
    }

    // Priority 4: Open empty tab with model
    if (isOffline) {
      toast({
        title: t("history.offlineTitle"),
        description: t("history.offlineNoInputs"),
        variant: "destructive",
      });
    }
    createTab(model);
    setSelectedItem(null);
    navigate(`/playground/${encodeURIComponent(item.model)}`);
  },
  [getModelById, getLocalInputs, createTab, navigate, t, isOffline],
);
```

### Step 5: Add offline info banner

Show helpful message when offline:

```typescript
{isOffline && items.length > 0 && (
  <div className="mx-4 mt-4 p-3 bg-muted/50 rounded-lg border border-border/50 flex items-start gap-3">
    <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
    <div className="flex-1 text-sm">
      <p className="font-medium">{t("history.offlineBannerTitle")}</p>
      <p className="text-muted-foreground mt-1">
        {t("history.offlineBannerDesc")}
      </p>
      {lastSyncTime && (
        <p className="text-xs text-muted-foreground mt-1">
          {t("history.lastSyncedAt", { time: formatDistanceToNow(new Date(lastSyncTime)) })}
        </p>
      )}
    </div>
  </div>
)}
```

### Step 6: Handle empty cache offline

When offline with no cached data:

```typescript
{isOffline && items.length === 0 && !isLoading && (
  <div className="text-center py-16">
    <WifiOff className="mx-auto h-12 w-12 text-muted-foreground/40 mb-4" />
    <p className="text-muted-foreground text-sm">
      {offlineReason === "no-api-key"
        ? t("history.offlineNoApiKeyEmpty")
        : t("history.offlineEmpty")}
    </p>
    {offlineReason === "no-api-key" && (
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => navigate("/settings")}
      >
        {t("history.configureApiKey")}
      </Button>
    )}
  </div>
)}
```

### Step 7: Auto-recovery on reconnect

When coming back online, trigger sync:

```typescript
useEffect(() => {
  const handleOnline = () => {
    setIsOnline(true);
    setOfflineReason(null);
    // Trigger sync if we have cached data
    if (items.length > 0) {
      fetchHistory();
    }
  };

  const handleOffline = () => {
    setIsOnline(true);
    setOfflineReason("network-offline");
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}, [items.length, fetchHistory]);
```

### Step 8: Add i18n strings

```json
{
  "history": {
    "offlineNoApiKey": "No API key",
    "offlineNetwork": "Network offline",
    "offlineApiError": "Connection error",
    "offlineRefreshDisabled": "Refresh unavailable offline",
    "offlineDeleteDisabled": "Delete requires internet connection",
    "offlineTitle": "Offline Mode",
    "offlineNoInputs": "Inputs not available offline",
    "offlineBannerTitle": "You're viewing cached history",
    "offlineBannerDesc": "Some features are disabled while offline. Connect to the internet to sync and manage your history.",
    "offlineEmpty": "No cached history available. Connect to the internet to load your history.",
    "offlineNoApiKeyEmpty": "Configure your API key to view your history.",
    "configureApiKey": "Configure API Key"
  }
}
```

## Success Criteria

- [x] Offline badge shows with specific reason
- [x] Delete buttons disabled when offline
- [x] Refresh button disabled when offline
- [x] "Open in playground" works with cached inputs
- [x] Helpful error toast when opening without cached inputs
- [x] Offline banner explains limited functionality
- [x] Empty state shows appropriate message
- [x] Auto-sync when coming back online
- [x] API key state affects offline detection

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Stale cache shown as current | Medium | Show "last synced X time ago" |
| User tries to delete while offline | Low | Button disabled with tooltip |
| "Open in playground" opens empty tab | Low | Show warning toast, still allow |

## Unresolved Questions

- Should we allow bulk delete to queue for later when online?
- Should we show a "pending operations" count when offline?

## Completion

This is the final phase. After completion, the history cache feature will be fully functional with:
1. Persistent SQLite storage
2. Cache-first loading with API fallback
3. Real-time sync on prediction completion
4. Periodic background sync
5. Graceful offline mode

## Success Metrics

- HistoryPage loads in <100ms with cached data
- Works completely offline with cached history
- New predictions appear instantly
- Background sync keeps cache fresh
- Clear visual indicators for sync/offline state
