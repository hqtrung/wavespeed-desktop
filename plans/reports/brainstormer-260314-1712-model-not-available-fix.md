# Fix: "Model No Longer Available" on Customize

## Problem
When clicking **Customize** in Assets view (or History), all assets show error: "Model is no longer available"

## Root Cause
- `AssetsPage.tsx` and `HistoryPage.tsx` use `getModelById()` from modelsStore
- **Neither page calls `fetchModels()`** - only PlaygroundPage does
- When opening AssetsPage directly, models list is empty/stale
- Result: All model lookups fail

## Affected Files
| File | Issue |
|------|-------|
| `src/pages/AssetsPage.tsx` | Missing `fetchModels()` call |
| `src/pages/HistoryPage.tsx` | Missing `fetchModels()` call |

## Solution: Fetch Models on Page Mount

### AssetsPage.tsx
**Around line 428**, add `fetchModels` to destructuring:
```typescript
const { fetchModels, getModelById } = useModelsStore();
```

**Add useEffect after existing useEffects** (around line 643):
```typescript
useEffect(() => {
  fetchModels();
}, [fetchModels]);
```

### HistoryPage.tsx
**Same pattern** - add `fetchModels` and useEffect.

## Alternative (Not Chosen)
- **Global app-level fetch**: Fetch once in App.tsx - more elegant but requires finding the right hook pattern
- **Graceful fallback**: Allow customize without model info - more complex, less useful

## Success Criteria
- Opening AssetsPage directly loads models
- Customize button works for all assets
- HistoryPage "Open in Playground" also works

## Implementation
~5 min - 2 files, 4 lines of code each.
