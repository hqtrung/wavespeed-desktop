# Brainstorm Report: Local History Cache for History Panel

**Date:** 2026-03-13
**Topic:** Add local copy of history in History Panel
**Status:** Complete → Implementation Plan Approved

---

## Problem Statement

History currently:
- Fetches from API every time (slow, requires network)
- Limited to last 24 hours (API default)
- No offline capability
- Pagination only works with server

**Goal:** Cache all history locally for offline access, faster loads, unlimited retention.

---

## Requirements Discovery

### Scope
✅ **Full history page with local caching**
- Not just playground panel
- Complete HistoryPage functionality

### Persistence
✅ **Persistent file storage**
- Survives app restarts
- Works in Electron desktop app

### Capacity
✅ **Large (unlimited)**
- No arbitrary limits
- Scales with user's history

### Sync Mode
✅ **Real-time + periodic**
- Insert to cache immediately when prediction completes
- Sync on app load
- Periodic background sync

### Conflict Resolution
✅ **Server wins (read-through)**
- API is source of truth
- Local cache mirrors server state
- Use `INSERT OR REPLACE` on sync

### Offline Behavior
✅ **Limited functionality**
- Show cached data with "offline" badge
- Allow opening in playground (if inputs cached)
- Disable server actions (delete, refresh)

---

## Solution: SQLite History Cache

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     HistoryPage.tsx                         │
│  - Reads from HistoryCache (SQLite)                         │
│  - Falls back to API on cache miss                          │
│  - Shows sync status indicators                             │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  HistoryCache (NEW)                         │
│  - SQLite CRUD operations                                   │
│  - Query builder with filtering/pagination                  │
│  - Sync orchestration                                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    sql.js (EXISTING)                        │
│  - Shared with workflow module                              │
│  - In-memory database with file persistence                 │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema

```sql
CREATE TABLE predictions (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  outputs JSON,
  inputs JSON,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  execution_time INTEGER,
  has_nsfw_contents INTEGER DEFAULT 0,
  error TEXT,
  synced_at TEXT
);

CREATE INDEX idx_created_at ON predictions(created_at DESC);
CREATE INDEX idx_model_id ON predictions(model_id);
CREATE INDEX idx_status ON predictions(status);
```

### Storage Location

```
{userData}/history-cache.db
- macOS: ~/Library/Application Support/WaveSpeed Desktop/
- Windows: %APPDATA%/WaveSpeed Desktop/
- Linux: ~/.config/WaveSpeed Desktop/
```

---

## Implementation Phases

### Phase 1: Storage Layer (2-3 hours)

**Files:**
- `src/lib/history-cache.ts` (NEW) - HistoryCache class
- `electron/history/` (NEW DIR) - Main process history module

**Tasks:**
1. Create `HistoryCache` class with:
   - `initialize()` - Load/create DB
   - `upsert(prediction)` - Insert or update
   - `getById(id)` - Fetch single prediction
   - `list(filters, pagination)` - Query with filters
   - `delete(id)` - Remove prediction
   - `getLastSyncTime()` - Track sync state
   - `updateSyncTime()` - Mark sync completed

2. Add IPC handlers in `electron/main.ts`:
   - `history:get-cache` - Fetch from local cache
   - `history:upsert` - Insert/update prediction
   - `history:delete` - Delete from cache
   - `history:get-sync-time` - Last sync timestamp

3. Migration support:
   - Version table for schema changes
   - Automatic migration on init

**Success Criteria:**
- DB file created on first run
- Can insert/retrieve predictions
- IPC handlers functional

---

### Phase 2: HistoryPage Integration (2-3 hours)

**Files:**
- `src/pages/HistoryPage.tsx` (MODIFY)
- `src/ipc/history.ts` (NEW) - IPC client (mirrors workflow ipc pattern)

**Tasks:**
1. Create `src/ipc/history.ts` - Typed IPC client
2. Modify `HistoryPage.tsx`:
   - Try cache first on load
   - Fall back to API if cache empty
   - Merge results: prioritize API (server wins)
   - Show sync indicator (✓ synced / ↻ syncing / ⚠ offline)

3. Update fetch logic:
   ```typescript
   const fetchHistory = async () => {
     // 1. Try cache
     let items = await historyCache.list(filters);

     // 2. If online, sync with API
     if (isValidated && !isOffline) {
       const apiItems = await apiClient.getHistory(...);
       // Upsert to cache
       await historyCache.upsertMany(apiItems);
       // Use API results (server wins)
       items = apiItems;
     }
     setItems(items);
   };
   ```

**Success Criteria:**
- Page loads from cache instantly
- API updates visible after sync
- Sync status indicator shows correctly

---

### Phase 3: Real-time Sync (1-2 hours)

**Files:**
- `src/pages/PlaygroundPage.tsx` (MODIFY)
- `src/stores/playgroundStore.ts` (MODIFY)

**Tasks:**
1. After prediction completes:
   ```typescript
   const result = await apiClient.run(...);
   // Insert to cache
   await historyCache.upsert(result);
   ```

2. Update status for processing predictions:
   - Periodic status updates during polling
   - Mark as completed/failed in cache

**Success Criteria:**
- New predictions appear in cache immediately
- Status updates reflect in cache

---

### Phase 4: Periodic Background Sync (1 hour)

**Files:**
- `src/lib/history-sync.ts` (NEW) - Background sync service

**Tasks:**
1. Create `HistorySync` class:
   - `start(interval)` - Begin periodic sync
   - `stop()` - Stop sync
   - `syncOnce()` - Manual sync trigger

2. Integration in `Layout.tsx`:
   - Start sync on app mount
   - Stop on app unmount
   - Pause when page hidden (visibility API)

3. Configurable interval:
   - Default: 5 minutes
   - Setting in settings page

**Success Criteria:**
- Background sync runs periodically
- Pauses when app inactive
- Can be configured

---

### Phase 5: Offline Mode (1-2 hours)

**Files:**
- `src/pages/HistoryPage.tsx` (MODIFY)

**Tasks:**
1. Detect offline state:
   - No API key set
   - Network error on API call
   - Explicit offline mode toggle

2. Update UI for offline:
   - Show "offline" badge in header
   - Disable refresh button
   - Disable delete buttons (require server)
   - Allow "open in playground" (if inputs cached)

3. Handle cache-only scenarios:
   - Show all cached data
   - Display "last synced: X min ago"

**Success Criteria:**
- Works without API key
- Clear offline indicators
- Graceful degradation

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| DB corruption (crash during write) | High | Use transactions, WAL mode |
| Large DB size (many predictions) | Medium | Implement pruning (optional) |
| Sync conflicts (concurrent writes) | Low | `INSERT OR REPLACE` semantics |
| Schema migration issues | Medium | Version table + rollback |
| Performance with 100K+ predictions | Low | Indexes, pagination |

---

## Success Metrics

- ✅ HistoryPage loads in <100ms (from cache)
- ✅ Works offline with cached data
- ✅ New predictions appear instantly in history
- ✅ DB size: ~1KB per prediction (100K = ~100MB)
- ✅ Background sync: no UI freeze

---

## Next Steps

1. ✅ Create detailed implementation plan with `/plan`
2. Assign tasks to implementation agents
3. Begin Phase 1: Storage Layer

---

## Unresolved Questions

- Should we implement pruning for old predictions (e.g., >1 year)?
- Should user be able to export/clear local cache?
- Should we compress large outputs in DB?
