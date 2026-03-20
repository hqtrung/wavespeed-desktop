# Code Review: Assets DB Migration + Pagination

**Date:** 2026-03-18
**Scope:** sql.js migration from better-sqlite3, file deletion, cursor-based pagination
**Files Changed:**
- `electron/assets/db/assets.repo.ts` (524 lines)
- `electron/assets/db/connection.ts` (192 lines)
- `src/stores/assetsStore.ts` (1255 lines)
- `src/pages/WelcomePage.tsx` (338 lines)

---

## Overall Assessment

**Quality:** Good - Functional migration with cursor-based pagination. Build passes.
**Risk Level:** Medium - File deletion without rollback, potential infinite loop edge case.
**Recommendation:** Address critical file deletion ordering before merging.

---

## Critical Issues (Must Fix)

### 1. File Deletion Before Transaction Commit - Data Loss Risk

**Location:** `assets.repo.ts` lines 140-168, 173-206

**Problem:** Files are deleted BEFORE database transaction commits. If DB operations fail after file deletion, files are gone but database still references them.

```typescript
// delete() method - file deleted BEFORE transaction completes
delete(id: string): void {
  transaction((db) => {
    const asset = this.getById(id);
    // File deleted here - but transaction may still fail!
    if (asset && asset.filePath) {
      unlinkSync(asset.filePath); // Risky
    }
    db.run("UPDATE assets SET sync_status = 'deleted'...");
    // If this throws, file is already deleted but DB update didn't happen
  });
}
```

**Impact:**
- Orphaned file references in database
- User sees assets that don't exist on disk
- Broken "open file location" functionality

**Fix:** Move file deletion outside transaction OR use two-phase commit pattern:

```typescript
// Option 1: Delete file AFTER successful transaction
delete(id: string): void {
  const asset = this.getById(id);
  const filePath = asset?.filePath;

  // Update DB first
  transaction((db) => {
    db.run("UPDATE assets SET sync_status = 'deleted' WHERE id = ?", [id]);
    // Create tombstone...
  });

  // Only delete file after DB update succeeds
  if (filePath) {
    try { unlinkSync(filePath); } catch (e) { /* log, already deleted */ }
  }
}

// Option 2: Use soft delete + cleanup job
// Keep files until sync confirms deletion, then cleanup
```

### 2. Z-Image Feature Card Missing `id` Field

**Location:** `WelcomePage.tsx` lines 247-258

**Problem:** The Z-Image feature card in the conditional array is missing the `id` field:

```typescript
...(!isMobile ? [
  {
    // MISSING: id: "z-image",
    icon: <Zap ... />,
    title: t("welcome.features.zImage.title"),
    // ...
  }
] : [])
```

**Impact:** React key warning in console, potential rendering issues.

**Fix:** Add `id: "z-image"` to the Z-Image feature object.

---

## High Priority Issues (Should Fix)

### 1. Pagination Loop Could Infinite Loop on Broken Cursor

**Location:** `assetsStore.ts` lines 358-370

**Problem:** No safeguard against infinite loop if backend returns malformed cursor:

```typescript
do {
  const result = await window.electronAPI.assetsGetFiltered({
    cursor: cursor || undefined,
    limit: 500,
  });
  allAssets.push(...result.items);
  cursor = result.nextCursor;
  if (!cursor) break;
} while (cursor); // What if cursor keeps returning same value?
```

**Edge Cases:**
- Backend bug returning same cursor indefinitely
- Cursor encoding error creating loop
- Database state changing mid-pagination

**Fix:** Add iteration limit and duplicate detection:

```typescript
const MAX_ITERATIONS = 1000; // Safety cap
const seenCursors = new Set<string>();
let iterations = 0;

do {
  if (iterations++ >= MAX_ITERATIONS) {
    console.error("[Assets] Pagination exceeded max iterations");
    break;
  }
  if (cursor && seenCursors.has(cursor)) {
    console.error("[Assets] Detected cursor loop");
    break;
  }
  if (cursor) seenCursors.add(cursor);

  const result = await window.electronAPI.assetsGetFiltered({ ... });
  allAssets.push(...result.items);
  cursor = result.nextCursor;
  if (!cursor || result.items.length === 0) break;
} while (cursor);
```

### 2. Row Index Mapping Prone to Schema Drift

**Location:** `assets.repo.ts` lines 12-33

**Problem:** `rowToMetadata()` uses magic numbers for column indices:

```typescript
function rowToMetadata(row: unknown[]): AssetMetadata {
  return {
    id: row[0] as string,
    filePath: row[1] as string,
    fileName: row[2] as string,
    // ... 19 more indices
    folderId: (row[17] as string | null) ?? undefined, // What if schema changes?
  };
}
```

**Risk:** If schema columns are reordered or added, indices shift silently.

**Mitigation:** Add runtime validation or use column-based query:

```typescript
// Option 1: Validate row length
if (row.length < 25) {
  throw new Error(`Invalid asset row: expected 25 columns, got ${row.length}`);
}

// Option 2: Use AS aliases and object mapping (requires query changes)
// SELECT id as "0", file_path as "1", ... then map by name

// Option 3: Document expected schema with JSDoc and add assertion
/**
 * Expects: id(0), file_path(1), file_name(2), type(3), model_id(4),
 *          created_at(5), updated_at(6), file_size(7), favorite(8), ...
 */
```

---

## Medium Priority Issues

### 1. No Timeout on Pagination Loop

**Location:** `assetsStore.ts` lines 358-370

Loading all assets with cursor pagination could take very long with large datasets. No timeout or progress indication.

**Suggestion:** Add timeout and loading status:

```typescript
const LOAD_TIMEOUT_MS = 30000; // 30 second cap
const startTime = Date.now();

do {
  if (Date.now() - startTime > LOAD_TIMEOUT_MS) {
    console.warn("[Assets] Load timeout, using partial results");
    break;
  }
  // ... fetch and append
} while (cursor);
```

### 2. Transaction Error Handling Missing in `getFiltered()`

**Location:** `assets.repo.ts` lines 224-294

`getFiltered()` doesn't use `transaction()` wrapper but runs multiple queries. If interrupted mid-query, inconsistent state possible.

**Risk:** Low for read-only queries, but could return inconsistent `totalCount` vs `items`.

**Fix:** Either wrap in read-only transaction or document acceptable staleness.

### 3. JSON.parse() in Loop Without Error Handling

**Location:** `assets.repo.ts` line 21, 308

```typescript
tags: JSON.parse((row[18] as string) || "[]"),  // No try-catch
```

If DB has malformed JSON, entire asset load fails.

**Fix:**

```typescript
tags: safeJsonParse(row[18] as string),

// Helper
function safeJsonParse(value: string): string[] {
  try {
    return JSON.parse(value || "[]");
  } catch {
    console.warn("[Assets] Malformed JSON tags:", value);
    return [];
  }
}
```

---

## Minor Suggestions

### 1. Consolidate File Deletion Logic

**DRY Violation:** File deletion code duplicated between `delete()` and `deleteMany()`.

**Suggestion:** Extract to shared function:

```typescript
private deleteAssetFile(filePath: string | undefined): void {
  if (!filePath) return;
  const { unlinkSync, existsSync } = require("fs");
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (err) {
    console.error("[Assets] Failed to delete file:", filePath, err);
  }
}
```

### 2. Use `fs/promises` for Async File Operations

**Suggestion:** `unlinkSync` blocks event loop. For bulk deletions, prefer `unlink` with `Promise.all()`.

### 3. Chunk Size Not Tunable

**Location:** `assetsStore.ts` line 361

```typescript
limit: 500, // Hardcoded
```

**Suggestion:** Make configurable or adapt based on observed performance:

```typescript
const CHUNK_SIZE = navigator.hardwareConcurrency ? 500 : 250;
```

---

## Edge Case Analysis

| Scenario | Current Behavior | Risk | Mitigation |
|----------|------------------|------|------------|
| File deleted externally | `existsSync` returns false, DB marks deleted | OK | Already handled |
| DB write fails after file delete | File gone, DB inconsistent | HIGH | Reorder operations |
| Malformed cursor JSON | `decodeCursor` throws | MED | Wrap in try-catch |
| Empty result set returns cursor | Loop breaks on `!cursor` | OK | Safe |
| Concurrent delete while paginating | Assets may disappear mid-load | LOW | Acceptable for UI |
| Disk full during file delete | Error logged, DB continues | LOW | Consider rollback |
| Very long tags array | JSON.parse may fail | LOW | Add error handling |
| Schema version mismatch | `rowToMetadata` may misalign | MED | Validate row length |

---

## Type Safety Review

1. **Row Casting:** `row[N] as Type` assertions bypass type checks. Schema changes could cause runtime errors.
2. **AssetMetadata vs AssetRow:** Two similar types - ensure conversion handles all fields.
3. **cursor type:** Base64 encoded string - no validation of decoded JSON structure.
4. **IPC Handler Return Types:** Type definitions match implementation - OK.

---

## Security Considerations

1. **Path Traversal:** `unlinkSync(asset.filePath)` - `filePath` from DB. User-controlled assets could theoretically contain malicious paths if validation is weak.
2. **SQL Injection:** Using parameterized queries throughout - GOOD.
3. **DoS via Pagination:** Large asset count could cause memory spike. Mitigation needed (iteration limit).

---

## Positive Observations

1. Well-structured cursor-based pagination with proper `ORDER BY` for stable results
2. Schema version tracking for migrations
3. Soft delete with tombstone pattern for sync
4. Comprehensive indexing strategy
5. Fallback to JSON storage when DB unavailable
6. Good console logging for debugging
7. Clean separation of repository, connection, and IPC layers

---

## Unresolved Questions

1. Should `getFiltered()` use read-only transactions for consistency?
2. Is the 500-item chunk size optimal for all platforms (especially low-end devices)?
3. Why does `deleteMany()` use a loop instead of single SQL statement?
4. Is there a cleanup process for tombstones in `deleted_items` table?
5. Should file deletion happen in a background job to avoid blocking UI?

---

## Recommended Actions (Priority Order)

1. **CRITICAL:** Move file deletion outside transaction or implement two-phase commit
2. **HIGH:** Add pagination loop guard (max iterations + duplicate detection)
3. **HIGH:** Add `id: "z-image"` to Z-Image feature card
4. **MEDIUM:** Add JSON.parse error handling in `rowToMetadata`
5. **MEDIUM:** Add iteration timeout to pagination loop
6. **LOW:** Extract duplicate file deletion logic to helper
7. **LOW:** Add row length validation to `rowToMetadata`
