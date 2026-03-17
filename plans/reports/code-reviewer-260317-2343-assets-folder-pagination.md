# Code Review: Asset Management Enhancement

**Date**: 2026-03-17
**Base SHA**: 614094e5
**Head SHA**: 1b0ab08
**Scope**: Asset folder organization, pagination, bulk operations, deleted registry

---

## Executive Summary

Overall implementation is **functional** but contains **critical bugs** and **missing pieces**. The deleted assets registry exists only on the renderer side (localStorage) - no Electron IPC handlers are implemented. This means deleted assets will NOT persist across app restarts in desktop mode.

**Risk Level**: MEDIUM-HIGH

---

## Critical Issues

### 1. Missing Electron IPC for Deleted Assets Registry (CRITICAL)

**Location**: `electron/main.ts`, `electron/preload.ts`, `src/stores/assetsStore.ts:919-936`

**Problem**: The renderer calls `window.electronAPI.getDeletedAssets()` and `window.electronAPI.saveDeletedAssets()`, but these methods **do not exist** in the preload or main process.

```typescript
// assetsStore.ts:919 - Code expects this to exist:
deleted = await window.electronAPI.getDeletedAssets();

// electron/preload.ts - NOT DEFINED
// electron/main.ts - NOT DEFINED
```

**Impact**: In desktop mode, the deleted assets registry will not persist across app restarts. Assets users delete will reappear after relaunch.

**Fix Required**:
1. Add to `electron/preload.ts`:
   ```typescript
   getDeletedAssets: (): Promise<string[]> => ipcRenderer.invoke("get-deleted-assets"),
   saveDeletedAssets: (deleted: string[]): Promise<boolean> => ipcRenderer.invoke("save-deleted-assets", deleted),
   ```
2. Add to `electron/main.ts`:
   ```typescript
   const deletedAssetsPath = join(userDataPath, "deleted-assets.json");

   ipcMain.handle("get-deleted-assets", () => {
     try {
       if (existsSync(deletedAssetsPath)) {
         return JSON.parse(readFileSync(deletedAssetsPath, "utf-8"));
       }
     } catch {}
     return [];
   });

   ipcMain.handle("save-deleted-assets", (_, deleted: string[]) => {
     try {
       if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true });
       writeFileSync(deletedAssetsPath, JSON.stringify(deleted, null, 2));
       return true;
     } catch { return false; }
   });
   ```

### 2. Race Condition in Deleted Assets Registry

**Location**: `src/stores/assetsStore.ts:595-632`

**Problem**: `deleteAssets()` modifies `deletedAssets` Set then awaits `saveDeletedAssets()`. Concurrent deletions could cause state inconsistencies.

```typescript
// Line 605-614
let newDeletedAssets = deletedAssets;
for (const asset of toDelete) {
  if (asset.predictionId !== undefined) {
    if (!newDeletedAssets) newDeletedAssets = new Set(deletedAssets);
    newDeletedAssets.add(deletedKey);
  }
}
if (newDeletedAssets !== deletedAssets) {
  await get().saveDeletedAssets(newDeletedAssets);  // Await after loop
}
```

**Impact**: Low - user-triggered, unlikely to race in practice.

**Fix**: Consider debouncing or using a mutex if bulk operations become frequent.

### 3. Missing Folder ID Type Guard

**Location**: `src/pages/AssetsPage.tsx:639-648`

**Problem**: `NO_FOLDER_ID` is string `"__none__"` but function signature expects `string | null`. Type assertion used unsafely:

```typescript
const noFolderCount = getAssetCount(NO_FOLDER_ID as string | null);  // Line 36
```

**Impact**: Type system doesn't catch misuse of the sentinel value.

---

## High Priority Issues

### 4. Potential Memory Leak - Keyboard Event Listeners

**Location**: `src/pages/AssetsPage.tsx:231-257`

**Problem**: Two separate `useEffect` hooks add `keydown` listeners. Both check `isActive` but dependencies differ:

```typescript
// Cmd+M selection toggle - deps: []
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => { ... };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);  // Empty deps - runs once, never re-evaluated

// Pagination keyboard - via hook, has proper deps
usePaginationKeyboard({ enabled: isActive });  // Properly handles enabled
```

**Issue**: The Cmd+M handler runs regardless of `isActive`. On navigation away from `/assets`, the handler remains attached.

**Impact**: Minor - Cmd+M will trigger on any page after visiting Assets once.

**Fix**:
```typescript
useEffect(() => {
  if (!isActive) return;
  const handleKeyDown = (e: KeyboardEvent) => { ... };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [isActive]);
```

### 5. Missing Cleanup in FolderItem Drag Counter

**Location**: `src/components/assets/folder-sidebar/FolderItem.tsx:39-68`

**Problem**: `dragCounter` ref tracks drag enter/leave events but if component unmounts during drag, counter might not reset.

```typescript
const handleDragLeave = (e: React.DragEvent) => {
  e.preventDefault();
  dragCounter.current--;
  if (dragCounter.current === 0) {
    setIsDraggingOver(false);
  }
};
```

**Impact**: Low - visual state issue only, clears on remount.

### 6. Folder Asset Count Computed on Every Render

**Location**: `src/components/assets/folder-sidebar/FolderSidebar.tsx:37-39`

**Problem**: Asset counts recalculated on every render instead of memoized:

```typescript
const folderCounts = new Map(
  folders.map((f) => [f.id, getAssetCount(f.id)]),  // Runs on every render
);
```

**Impact**: O(n) per folder on every render. With many assets/folders, causes jank.

**Fix**: Use `useMemo`:
```typescript
const folderCounts = useMemo(() => new Map(
  folders.map((f) => [f.id, getAssetCount(f.id)])
), [folders, assets]);
```

### 7. Pagination State Inconsistency

**Location**: `src/pages/AssetsPage.tsx:207-221`

**Problem**: `filteredAssets` depends on `assets` but `useMemo` deps don't include it:

```typescript
const filteredAssets = useMemo(() => {
  let filtered = getFilteredAssets(filter);
  // ...
}, [getFilteredAssets, filter, assets, predictionIdFilter]);
```

**Issue**: `getFilteredAssets` is a Zustand function that already reads `assets`. Including `assets` in deps causes double-computation when assets change (Zustand updates, then useMemo detects dependency change).

**Impact**: Minor - redundant computation, not incorrect.

---

## Medium Priority Issues

### 8. Duplicate Code Pattern in Deleted Registry Removal

**Location**: `src/stores/assetsStore.ts:444-453, 490-499`

**Problem**: Same 9-line pattern appears twice (desktop and browser code paths):

```typescript
let newDeletedAssets = get().deletedAssets;
if (options.predictionId !== undefined) {
  const deletedKey = getDeletedAssetKey(options.predictionId, resultIndex);
  if (newDeletedAssets.has(deletedKey)) {
    newDeletedAssets = new Set(newDeletedAssets);
    newDeletedAssets.delete(deletedKey);
    await get().saveDeletedAssets(newDeletedAssets);
  }
}
```

**Fix**: Extract to helper function.

### 9. Inconsistent Error Handling in Asset Operations

**Location**: `src/stores/assetsStore.ts`

**Pattern**: Some operations catch errors and return defaults, others throw:

```typescript
// loadDeletedAssets - catches and returns empty Set
catch { set({ deletedAssets: new Set() }); }

// saveAsset - throws error
throw new Error(`Failed to save output: ${reason}`);

// deleteAsset - logs error but returns true
console.error("Failed to delete asset file:", result.error);
// No throw, continues
```

**Impact**: Inconsistent - callers can't rely on try/catch.

### 10. Folder Storage Lacks Migration Path

**Location**: `electron/main.ts:896-940`

**Problem**: Folders stored in simple JSON file at `userDataPath`. No schema version, no migration path for future changes.

**Impact**: Future schema changes will require manual data deletion.

---

## Low Priority / Style Issues

### 11. Prettier Formatting Issues

**Location**: `src/stores/assetsStore.ts`

```bash
[warn] Code style issues found in the above file.
```

Run `npx prettier --write src/stores/assetsStore.ts`.

### 12. Magic String for Folder ID

**Location**: `src/types/asset.ts:105`

```typescript
export const NO_FOLDER_ID = "__none__" as const;
```

**Issue**: Using string constant as type sentinel is fragile. Could use symbol or explicit `type UnassignedFolder = { __brand: "unassigned" }`.

**Not actionable** - existing pattern matches codebase conventions.

### 13. Excessive Line Length in AssetsPage

**Location**: Multiple lines in `src/pages/AssetsPage.tsx`

**Example**: Line 801 exceeds typical 100-char limit.

**Not actionable** - no strict limit enforced in project.

---

## Positive Observations

1. **Well-structured pagination**: `PageNumbers` component correctly handles ellipsis logic
2. **Keyboard navigation**: `usePaginationKeyboard` properly ignores input elements
3. **Drag-drop**: `FolderItem` correctly uses counter pattern for drag enter/leave
4. **Type safety**: Good use of TypeScript throughout new code
5. **Internationalization**: All new strings have i18n keys
6. **Code organization**: New components properly scoped in `folder-sidebar/` and `pagination/` directories
7. **Async scanning**: `scanAssetsDirectory` uses parallel `Promise.all` for performance

---

## Architecture Notes

### Deleted Registry Design

The current approach uses `predictionId_resultIndex` as the key. This works for WaveSpeed predictions but:

1. **Free tools** without `predictionId` won't be tracked
2. **Workflow executions** use `executionId` - not covered
3. **Manual uploads** have no prediction reference - not covered

**Recommendation**: Consider using `filePath` hash or adding registry by file path for non-prediction assets.

### Folder Storage

Folders are stored separately from assets (asset metadata has `folderId`, folders are in separate JSON). This is good design but:

- **No referential integrity**: Deleting a folder leaves `asset.folderId` pointing to orphan ID
- **Current code handles this**: `deleteFolder` clears or reassigns folderId properly (line 857-862)

---

## Testing Gaps

No tests found for:
- `loadDeletedAssets` / `saveDeletedAssets` edge cases
- Folder operations with concurrent modifications
- Pagination boundary conditions
- Keyboard shortcut conflicts

---

## Recommended Actions (Priority Order)

1. **[CRITICAL]** Add Electron IPC handlers for `get-deleted-assets` and `save-deleted-assets`
2. **[HIGH]** Fix Cmd+M keyboard listener to respect `isActive` state
3. **[HIGH]** Memoize `folderCounts` in `FolderSidebar`
4. **[MEDIUM]** Extract duplicate deleted-registry removal code to helper
5. **[MEDIUM]** Add schema version to folder storage
6. **[LOW]** Run Prettier on `assetsStore.ts`

---

## Unresolved Questions

1. Why was `prediction-repo.ts` and `sync-service.ts` mentioned in the PR description but not in the actual diff?
2. Should deleted registry use file path instead of predictionId for non-prediction assets?
3. Is there a plan to clean up orphaned deleted registry entries (assets no longer exist)?
4. Should folder operations be transactional (currently: folders update, then assets update separately)?
