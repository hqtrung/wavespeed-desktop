# Code Review: Local SQLite History Cache

**Date:** 2026-03-13
**Reviewer:** code-reviewer agent
**Plan:** 260313-2255-local-history-cache

---

## Executive Summary

**Overall Assessment: 7.5/10**

The local SQLite history cache implementation is well-architected and follows project patterns (workflow module sql.js usage). However, there are **7 TypeScript compilation errors** that must be fixed before merge. The code shows good security practices (parameterized queries) and proper error handling, but has some type safety issues and missing exports.

---

## Scope

- **Files Created:** 10 new files across Electron main and renderer processes
- **Files Modified:** 3 existing files (HistoryPage.tsx, playgroundStore.ts, BatchControls.tsx)
- **Lines of Code:** ~1,500 LOC
- **Focus:** SQLite-based history caching with real-time sync and periodic background sync

---

## Critical Issues (Must Fix)

### 1. TypeScript Compilation Errors ❌

**Impact:** Code will not compile, blocking deployment

#### Error 1: Type Import in prediction-repo.ts (Line 5)
```typescript
// ❌ WRONG
import type { SqlJsDatabase } from "sql.js";

// ✅ CORRECT
import type { Database } from "sql.js";
```

**Fix:** Change `SqlJsDatabase` to `Database` throughout `prediction-repo.ts`.

#### Error 2: Missing Export in history-cache.ts
```typescript
// src/types/history-cache.ts - line 1
import type { HistoryItem } from "./prediction";

// ❌ HistoryItem is not exported from prediction.ts
```

**Fix:** Export `HistoryItem` from `src/types/prediction.ts` or use a different type.

#### Error 3: Property `prepare` Does Not Exist (Line 40)
```typescript
// electron/history/db/prediction-repo.ts:40
const stmt = db.prepare(...);
```

**Issue:** sql.js `Database` type doesn't have a `prepare()` method in the current version.

**Fix:** Use `db.run()` in a loop for bulk operations, or check sql.js documentation for prepared statement API.

#### Error 4: Property `updated_at` Does Not Exist (Line 143)
```typescript
// electron/history/db/prediction-repo.ts:143
return {
  ...
  updated_at: updated_at as string,  // ❌ Not in CachedPrediction type
};
```

**Issue:** `CachedPrediction` interface doesn't include `updated_at`.

**Fix:** Add `updated_at?: string` to `CachedPrediction` interface.

#### Error 5: Variable Used Before Declaration (playgroundStore.ts:504)
```typescript
// Line 504
const historyItem = predictionResultToHistoryItem(result, snapshotValues);
// ...
const snapshotValues = { ...formValues };  // ❌ Declared after use
```

**Fix:** Move `const snapshotValues = { ...formValues };` to before line 504.

#### Error 6: Type Conversion Error in IPC Client (history.ts:13)
```typescript
return (window as Record<string, unknown>)
  .electronAPI as Record<string, unknown> | undefined;
```

**Fix:** Cast to `unknown` first:
```typescript
return (window as unknown as Record<string, unknown>)
  .electronAPI as Record<string, unknown> | undefined;
```

#### Error 7: Unused Type Import (HistoryPage.tsx:8)
```typescript
import type { SyncStatus } from "@/lib/history-sync";
// ❌ Imported but never used (local type defined instead)
```

**Fix:** Remove the import or use the imported type.

---

## High Priority Issues

### 2. SQL Injection Risk Assessment ✅ (SAFE)

**Status:** Parameterized queries used correctly

All SQL queries use proper parameterization:
- `db.run("SELECT * FROM predictions WHERE id = ?", [id])` ✅
- `db.run("DELETE FROM predictions WHERE id = ?", [id])` ✅
- `db.exec(sql, params)` with arrays ✅

**Recommendation:** Continue this pattern for any future queries.

### 3. Memory Management Concerns ⚠️

**Issue:** Prepared statements not freed in error paths

```typescript
// electron/history/db/prediction-repo.ts:38-64
export function upsertPredictions(items: HistoryItem[]): void {
  const db = getDatabase();
  const stmt = db.prepare(...);  // ❌ Not freed if error occurs

  for (const item of items) {
    stmt.run([...]);
  }
  stmt.free();  // ✅ Freed on success path
}
```

**Fix:** Use try-finally:
```typescript
try {
  for (const item of items) {
    stmt.run([...]);
  }
} finally {
  stmt.free();
}
```

### 4. Race Condition in History Cache Sync ⚠️

**Issue:** `fetchHistory` in HistoryPage.tsx has race conditions

```typescript
// Lines 500-540 (simplified)
const fetchHistory = async () => {
  // 1. Cache fetch
  const cached = await historyCacheIpc.list(...);
  if (cached.length > 0) setItems(cached);

  // 2. API fetch
  const response = await apiClient.getHistory(...);
  setItems(apiItems);  // ❌ May overwrite if component unmounted
};
```

**Fix:** Use mounted flag pattern (already used elsewhere in the file):
```typescript
let mounted = true;
try {
  const response = await apiClient.getHistory(...);
  if (mounted) setItems(apiItems);
} finally {
  mounted = false;
}
```

### 5. Missing Error Boundaries ⚠️

**Issue:** HistoryCacheIpc calls lack error handling in some paths

```typescript
// HistoryPage.tsx:508-512
const cached = await historyCacheIpc.get(item.id);
if (cached?.inputs && Object.keys(cached.inputs).length > 0) {
  // ❌ No try-catch, but errors possible
}
```

**Fix:** Already wrapped in try-catch in openInPlayground, but verify all paths are covered.

---

## Medium Priority Issues

### 6. Type Safety: `updated_at` Field Inconsistency

**Problem:** `HistoryItem` type doesn't have `updated_at`, but:
1. `predictionResultToHistoryItem` adds it
2. Database schema includes it
3. `CachedPrediction` doesn't include it

**Recommendation:** Standardize types:
```typescript
// src/types/prediction.ts
export interface HistoryItem {
  id: string;
  model: string;
  status: PredictionStatus;
  outputs: unknown[];
  created_at: string;
  updated_at?: string;  // ✅ Add this
  // ...
}
```

### 7. Debounced Persist Delay Too Long? ⚠️

**Current:** 500ms debounce in `connection.ts:111-116`

```typescript
persistTimer = setTimeout(() => {
  persistTimer = null;
  saveToDisk();
}, 500);  // 500ms delay
```

**Consideration:** For critical prediction data, 500ms might be too long if app crashes.

**Recommendation:** Add immediate persist option for critical writes, or reduce to 250ms.

### 8. Background Sync Service Lifecycle ⚠️

**Issue:** Singleton `syncService` never destroyed

```typescript
// src/lib/history-sync.ts:132-139
let syncService: HistorySyncService | null = null;

export function getHistorySyncService(): HistorySyncService {
  if (!syncService) {
    syncService = new HistorySyncService();
  }
  return syncService;
}
```

**Problem:** No cleanup on app quit, interval may continue.

**Fix:** Call `destroy()` in Layout component unmount or app quit handler.

### 9. Database Corruption Handling ✅ (GOOD)

**Status:** Proper corruption detection and backup

```typescript
// electron/history/db/connection.ts:60-79
try {
  const fileBuffer = readFileSync(filePath);
  db = new SQL.Database(fileBuffer);
  const result = db.exec("PRAGMA integrity_check");
  if (ok !== "ok") throw new Error("integrity_check failed");
} catch (error) {
  // ✅ Backup corrupt DB
  const backupPath = `${filePath}.corrupt.${Date.now()}`;
  renameSync(filePath, backupPath);
}
```

**Excellent:** This is production-ready corruption handling.

---

## Low Priority Issues

### 10. Code Duplication: Output Type Detection

**Issue:** `getOutputType` duplicated in HistoryPage.tsx and should use shared utility

```typescript
// src/pages/HistoryPage.tsx:154-167
function getOutputType(output: unknown) {
  // ❌ Duplicated logic
}
```

**Recommendation:** Extract to `src/lib/mediaUtils.ts` if not already there.

### 11. Inconsistent Status Types

**Problem:** Multiple `SyncStatus` type definitions:
- `src/lib/history-sync.ts:8` - "idle" | "syncing" | "success" | "error"
- `src/pages/HistoryPage.tsx:376` - "synced" | "syncing" | "offline" | "error"

**Fix:** Use shared type from history-sync.ts or create enum.

### 12. Missing Database Size Tracking

**Type definition includes:**
```typescript
// src/types/history-cache.ts:24
dbSizeBytes: number;
```

**But implementation doesn't track it:**
```typescript
// electron/history/ipc/history-ipc.ts:51-56
ipcMain.handle("history-cache:stats", async () => {
  return {
    totalCount: predictionRepo.getCount(),
    lastSyncTime: predictionRepo.getLastSyncTime(),
    // ❌ Missing dbSizeBytes
  };
});
```

**Fix:** Add file size check in stats:
```typescript
const dbSizeBytes = existsSync(getDatabasePath())
  ? statSync(getDatabasePath()).size
  : 0;
```

---

## Security Review ✅

### SQL Injection
- **Status:** SAFE - All queries parameterized
- **Recommendation:** Maintain this pattern

### XSS Prevention
- **Status:** SAFE - No direct HTML rendering
- Outputs displayed via React components

### Data Validation
- **Status:** NEEDS IMPROVEMENT
- IPC handlers don't validate input types/shapes before database insert

**Recommendation:** Add Zod or io-ts validation in IPC handlers:
```typescript
ipcMain.handle("history-cache:upsert", async (_event, item: unknown) => {
  const validated = HistoryItemSchema.parse(item);  // ✅ Validate
  predictionRepo.upsertPrediction(validated);
});
```

---

## Performance Review

### Database Queries ✅
- **Status:** GOOD
- Indexed columns: `created_at`, `model_id`, `status`
- Uses `INSERT OR REPLACE` for upserts (efficient)

### Memory Usage ⚠️
- **Concern:** sql.js loads entire DB into memory
- **Mitigation:** Debounced persist (500ms) reduces disk I/O
- **Monitoring:** Add memory usage tracking if DB grows large

### Background Sync ⚠️
- **Interval:** 5 minutes (configurable)
- **Fetch size:** 100 items per sync
- **Risk:** May fetch redundant data if user hasn't generated new items

**Recommendation:** Add `created_after` filter to sync:
```typescript
const lastSync = await getLastSyncTime();
const response = await apiClient.getHistory(1, 100, {
  created_after: lastSync,
});
```

---

## Architecture Review ✅

### Pattern Consistency
- **Status:** EXCELLENT
- Follows workflow module pattern (sql.js + IPC)
- Separate database file (history-cache.db)
- Proper separation of concerns (repo, IPC, client)

### Type Safety ⚠️
- **Status:** NEEDS IMPROVEMENT
- 7 TypeScript errors to fix
- Missing exports in type definitions

### Error Handling
- **Status:** GOOD
- Try-catch blocks in critical paths
- Graceful fallbacks (cache → API)
- Corruption recovery in DB layer

---

## Edge Cases Analysis

### 1. Empty Database ✅
- **Handled:** Returns empty array from `listPredictions`
- **Tested:** Schema initializes correctly

### 2. Corrupt Database ✅
- **Handled:** Backup created, new DB initialized
- **Verified:** Integrity check on open

### 3. Concurrent Writes ⚠️
- **Risk:** sql.js is single-threaded, but IPC calls are async
- **Mitigation:** Database operations are serialized by Electron main process
- **Recommendation:** Add transaction wrapper for bulk operations

### 4. App Crash During Persist ⚠️
- **Risk:** 500ms debounce may lose data
- **Mitigation:** `persistDatabaseNow()` called on close
- **Recommendation:** Add beforeunload handler to force persist

### 5. Offline Mode ✅
- **Handled:** Falls back to cache when API unavailable
- **UI:** Shows offline badge

### 6. Large History (10,000+ items) ⚠️
- **Risk:** sql.js memory usage grows with DB size
- **Recommendation:** Add pagination to `listPredictions` (already implemented)
- **Future:** Consider pruning old items or archiving

---

## Positive Observations 🎉

1. **Excellent Pattern Following:** Mirrors workflow module architecture perfectly
2. **Robust Corruption Handling:** PRAGMA integrity check with backup
3. **Graceful Degradation:** Cache → API fallback chain
4. **Proper Indexing:** created_at, model_id, status indexed
5. **Debounced Persist:** Reduces disk I/O with 500ms delay
6. **Typed IPC Client:** Type-safe communication between processes
7. **Background Sync Service:** Clean singleton pattern with listeners
8. **Offline Support:** Visual indicators and graceful fallbacks

---

## Recommended Actions

### Must Fix Before Merge (Critical)
1. ✅ Fix TypeScript type import: `SqlJsDatabase` → `Database`
2. ✅ Export `HistoryItem` from `src/types/prediction.ts`
3. ✅ Fix `prepare()` method call (use `run()` loop or check API)
4. ✅ Add `updated_at` to `CachedPrediction` interface
5. ✅ Fix variable declaration order in playgroundStore.ts (line 504)
6. ✅ Fix type cast in IPC client (add `unknown` intermediate)
7. ✅ Remove unused `SyncStatus` import from HistoryPage.tsx

### Should Fix (High Priority)
8. ✅ Add try-finally for prepared statement cleanup
9. ✅ Add mounted flag to fetchHistory race condition
10. ✅ Standardize `updated_at` field across types
11. ✅ Add input validation to IPC handlers (Zod/io-ts)

### Nice to Have (Medium Priority)
12. ✅ Add database size tracking to stats endpoint
13. ✅ Extract `getOutputType` to shared utility
14. ✅ Unify `SyncStatus` type definitions
15. ✅ Add `created_after` filter to background sync

### Future Improvements (Low Priority)
16. ✅ Reduce persist debounce to 250ms for critical data
17. ✅ Add memory usage monitoring for large DBs
18. ✅ Implement data pruning/archival policy

---

## Unresolved Questions

1. **Prepared Statements:** Does sql.js support `prepare()` method? Check documentation.
2. **HistoryItem Export:** Should `HistoryItem` be exported, or create a separate `CacheablePrediction` type?
3. **Sync Interval:** Is 5 minutes appropriate? Consider making user-configurable.
4. **Database Size:** What's the max expected history count? When should we prune?
5. **API Rate Limits:** Will 100-item sync every 5min hit API rate limits?

---

## Approval Decision

**🔴 CONDITIONAL APPROVAL**

**Required:**
- Fix all 7 TypeScript compilation errors
- Add prepared statement cleanup (try-finally)
- Fix race condition in fetchHistory

**Recommended:**
- Add input validation to IPC handlers
- Standardize type definitions
- Add database size tracking

**Summary:**
The implementation is well-architected and follows project patterns correctly. Security posture is good (parameterized queries, no XSS risks). The main blockers are TypeScript type errors that prevent compilation. Once these are fixed, this feature is ready for merge.

**Estimated Time to Fix:** 30-45 minutes

---

**Reviewer Notes:**
- Code quality is generally high
- Good error handling and edge case coverage
- Type system needs attention (fix compilation errors)
- Consider adding integration tests for history cache flows
- Monitor memory usage as history grows
