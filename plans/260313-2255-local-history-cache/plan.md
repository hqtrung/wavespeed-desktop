---
title: "Local SQLite History Cache for History Panel"
description: "Add persistent SQLite-based history caching with real-time sync, periodic background sync, and offline mode support"
status: completed
priority: P2
effort: 9h
branch: main
tags: [history, cache, sqlite, offline, sync]
created: 2026-03-13
completed: 2026-03-14
---

# Local SQLite History Cache Implementation Plan

## Overview

Add local SQLite-based history cache to enable instant page loads, offline access, and unlimited history retention. The cache uses sql.js (shared with workflow module) and syncs with WaveSpeed API.

## Architecture

```
HistoryPage.tsx
    │
    ├──> HistoryCache IPC (new)
    │         │
    │         ▼
    │    electron/history/
    │    ├── db/connection.ts (sql.js)
    │    ├── db/schema.ts
    │    ├── db/prediction.repo.ts
    │    └── ipc/history.ipc.ts
    │
    └──> apiClient.getHistory() (fallback)

Background Sync Service
    ├── Periodic sync every 5min (configurable)
    ├── Pause on page hidden (visibility API)
    └── Show sync status in UI
```

## Phases

| Phase | Description | Effort | Status |
|-------|-------------|--------|--------|
| [Phase 1: Storage Layer](phase-01-storage-layer.md) | SQLite DB + IPC handlers | 2.5h | ✅ completed |
| [Phase 2: HistoryPage Integration](phase-02-historypage-integration.md) | Cache-first with API fallback | 2h | ✅ completed |
| [Phase 3: Real-time Sync](phase-03-realtime-sync.md) | Insert on prediction complete | 1.5h | ✅ completed |
| [Phase 4: Periodic Background Sync](phase-04-periodic-sync.md) | Background sync service | 1h | ✅ completed |
| [Phase 5: Offline Mode](phase-05-offline-mode.md) | Graceful offline behavior | 1.5h | ✅ completed |

## Database Schema

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
CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
```

## Storage Location

```
{userData}/history-cache.db
- macOS: ~/Library/Application Support/WaveSpeed Desktop/
- Windows: %APPDATA%/WaveSpeed Desktop/
- Linux: ~/.config/WaveSpeed Desktop/
```

## Key Design Decisions

1. **Separate DB from workflow**: History gets its own `history-cache.db` for independent management
2. **Server wins on conflict**: Use `INSERT OR REPLACE` on sync, API is source of truth
3. **Debounced persist**: 500ms delay (same pattern as workflow module)
4. **Unlimited capacity**: No pruning initially, add later if needed
5. **Offline badge**: Clear visual indicator when cache is stale

## Success Criteria

- HistoryPage loads in <100ms from cache
- Works offline with cached data
- New predictions appear instantly
- Background sync runs without UI freeze
- Proper TypeScript types throughout

## Related Files

### Create
- `electron/history/index.ts` - Module entry point
- `electron/history/db/connection.ts` - SQLite connection (sql.js)
- `electron/history/db/schema.ts` - Schema + migrations
- `electron/history/db/prediction.repo.ts` - CRUD operations
- `electron/history/ipc/history.ipc.ts` - IPC handlers
- `src/ipc/history.ts` - Renderer IPC client (typed)
- `src/lib/history-sync.ts` - Background sync service
- `src/types/history-cache.ts` - Cache-specific types

### Modify
- `electron/main.ts` - Initialize history module
- `electron/preload.ts` - Add history IPC bindings
- `src/pages/HistoryPage.tsx` - Cache-first loading
- `src/stores/playgroundStore.ts` - Hook prediction complete
- `src/components/layout/Layout.tsx` - Start/stop background sync

## Next Steps

Begin with [Phase 1: Storage Layer](phase-01-storage-layer.md)
