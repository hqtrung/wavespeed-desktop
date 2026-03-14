# Phase 3: Real-time Sync

**Status:** ✅ completed | **Priority:** P1 | **Effort:** 1.5h | **Completed:** 2026-03-14

## Overview

Hook into playground prediction completion to immediately insert results into cache. New predictions appear instantly in history without waiting for periodic sync.

## Context Links

- Phase 1: `phase-01-storage-layer.md` (IPC upsert available)
- Phase 2: `phase-02-historypage-integration.md` (HistoryPage reads cache)
- Playground store: `src/stores/playgroundStore.ts`
- Prediction types: `src/types/prediction.ts`

## Key Insights

1. **Store completed prediction**: Capture final result with inputs for "open in playground"
2. **Upsert immediately**: After API polling completes, write to cache
3. **Include inputs**: Store form values so offline "open in playground" works
4. **Status updates**: Update prediction status during polling (created → processing → completed/failed)
5. **Minimal overhead**: Async fire-and-forwrite cache write

## Data Flow

```
Playground runPrediction()
    │
    ├──> API POST /predictions
    │         │
    │         ├──> Prediction created (status: "created")
    │         │       └──> Upsert to cache (minimal data)
    │         │
    │         └──> Poll loop
    │                 │
    │                 ├──> status: "processing" ──> Update cache
    │                 ├──> status: "completed" ──> Upsert full result + inputs
    │                 └──> status: "failed" ──> Upsert error
    │
    └──> HistoryPage sees new item instantly
```

## Related Code Files

### Modify

| File | Changes |
|------|---------|
| `src/stores/playgroundStore.ts` | Add cache upsert after prediction completion |
| `src/api/client.ts` | May need to expose prediction result details |

## Implementation Steps

### Step 1: Add helper to convert PredictionResult to HistoryItem

`src/lib/history-utils.ts` (NEW):

```typescript
import type { PredictionResult, HistoryItem } from "@/types/prediction";

export function predictionResultToHistoryItem(
  result: PredictionResult,
  formValues?: Record<string, unknown>
): HistoryItem & { inputs?: Record<string, unknown> } {
  return {
    id: result.id,
    model: result.model,
    status: result.status,
    outputs: result.outputs,
    created_at: result.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    execution_time: result.timings?.inference,
    has_nsfw_contents: result.has_nsfw_contents,
    error: result.error,
    inputs: formValues,
  };
}

export function isPredictionComplete(result: PredictionResult): boolean {
  return result.status === "completed" || result.status === "failed";
}
```

### Step 2: Create cache upsert hook

`src/hooks/useHistoryCache.ts` (NEW):

```typescript
import { useCallback } from "react";
import { historyCacheIpc } from "@/ipc/history";
import type { HistoryItem } from "@/types/prediction";

export function useHistoryCache() {
  const upsertToCache = useCallback(async (item: HistoryItem & { inputs?: Record<string, unknown> }) => {
    try {
      await historyCacheIpc.upsert(item);
    } catch (err) {
      console.error("[History Cache] Failed to upsert:", err);
      // Don't throw - cache failures shouldn't break playground
    }
  }, []);

  return { upsertToCache };
}
```

### Step 3: Modify playgroundStore runPrediction

Locate the runPrediction function and add cache upsert hooks. Key points:

1. **On prediction created**: Upsert with status="created"
2. **During polling**: Update status to "processing"
3. **On complete**: Upsert full result with inputs

Pseudocode for modification:

```typescript
// In runPrediction function, after API returns prediction:
const initialHistoryItem = predictionResultToHistoryItem(prediction, tab.formValues);
await historyCacheIpc.upsert(initialHistoryItem);

// In polling loop, when status changes:
if (latestResult.status !== previousStatus) {
  const updatedItem = predictionResultToHistoryItem(latestResult, tab.formValues);
  await historyCacheIpc.upsert(updatedItem);
}

// On completion (success or failure):
const finalItem = predictionResultToHistoryItem(finalResult, tab.formValues);
await historyCacheIpc.upsert(finalItem);
```

### Step 4: Find exact hook point in playgroundStore

The playgroundStore has a `runPrediction` action. Look for:

1. Where `apiClient.run()` is called
2. Where polling happens (status updates)
3. Where final result is stored in `currentPrediction`

Add cache writes at these points:

```typescript
// After prediction is created from API
runPrediction: async (tabId: string) => {
  const state = get();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab?.selectedModel) return;

  // ... existing setup code ...

  try {
    // API call
    const result = await apiClient.run(/* ... */);

    // NEW: Cache initial prediction
    const historyItem = predictionResultToHistoryItem(result, tab.formValues);
    historyCacheIpc.upsert(historyItem).catch(console.error);

    // ... existing result handling ...

    // Polling loop
    while (shouldContinue) {
      const pollResult = await apiClient.getPrediction(result.id);

      // NEW: Update cache on status change
      if (pollResult.status !== result.status) {
        const updatedItem = predictionResultToHistoryItem(pollResult, tab.formValues);
        historyCacheIpc.upsert(updatedItem).catch(console.error);
      }

      // ... existing polling logic ...
    }

    // Final result
    // NEW: Cache final result
    const finalItem = predictionResultToHistoryItem(finalResult, tab.formValues);
    historyCacheIpc.upsert(finalItem).catch(console.error);

  } catch (error) {
    // ... existing error handling ...
  }
}
```

### Step 5: Import historyCacheIpc in store

Add import at top of `src/stores/playgroundStore.ts`:

```typescript
import { historyCacheIpc } from "@/ipc/history";
import { predictionResultToHistoryItem } from "@/lib/history-utils";
```

### Step 6: Handle batch predictions

For batch mode, each batch item should be cached separately:

```typescript
// In batch execution loop
for (let i = 0; i < batchConfig.repeatCount; i++) {
  const result = await apiClient.run(/* ... */);

  // Cache each batch prediction
  const historyItem = predictionResultToHistoryItem(result, formValues);
  await historyCacheIpc.upsert(historyItem);

  // ... rest of batch logic ...
}
```

### Step 7: Handle prediction inputs store

Ensure inputs are saved to `predictionInputsStore` for "open in playground". This should already exist, but verify the cache includes these inputs:

```typescript
// After prediction completes, inputs should be in predictionInputsStore
const { save: saveInputs } = usePredictionInputsStore.getState();
saveInputs(result.id, tab.formValues);
```

The cache should read from this store if inputs not already stored in DB.

### Step 8: Add status update during polling

For long-running predictions, show intermediate status updates:

```typescript
// During polling, if status changes to "processing"
if (pollResult.status === "processing" && previousStatus !== "processing") {
  const processingItem = predictionResultToHistoryItem(pollResult, tab.formValues);
  historyCacheIpc.upsert(processingItem).catch(console.error);
}
```

## Success Criteria

- [x] New prediction appears in HistoryPage immediately after completion
- [x] Prediction shows correct status (created → processing → completed)
- [x] Failed predictions are cached with error message
- [x] Batch predictions are all cached individually
- [x] Inputs are stored for "open in playground" functionality
- [x] Cache write failures don't break playground execution
- [x] HistoryPage refresh shows new items without API call

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cache write blocks execution | Low | Async fire-and-forget with error handling |
| Duplicate cache entries | Low | `INSERT OR REPLACE` handles duplicates |
| Missing inputs for "open in playground" | Medium | Verify predictionInputsStore integration |
| Cache grows too large | Low | Pruning in future phase if needed |

## Next Steps

After this phase, proceed to [Phase 4: Periodic Background Sync](phase-04-periodic-sync.md)
