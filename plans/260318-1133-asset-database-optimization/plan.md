---
title: "Asset Database Optimization"
description: "Migrate from JSON to SQLite with Cloudflare D1/R2 support for asset management"
status: in-progress
priority: P1
effort: 24h
branch: develop
tags: [database, assets, cloudflare, migration]
created: 2026-03-18
---

# Asset Database Optimization Plan

## Overview

Migrate asset management from JSON file storage to a proper SQLite database with support for:
- Local SQLite (better-sqlite3) in Electron
- Cloudflare D1 (edge SQLite) for cloud sync
- Cloudflare R2 for object storage (files + thumbnails)
- Offline-first architecture with conflict resolution

## Phase Status

| Phase | Status | Owner |
|-------|--------|-------|
| [Phase 01: Database Schema Design](./phase-01-database-schema.md) | done | - |
| [Phase 02: Local SQLite Implementation](./phase-02-local-sqlite.md) | done | - |
| [Phase 03: Migration from JSON](./phase-03-migration.md) | done | - |
| [Phase 04: Cloudflare D1 Integration](./phase-04-d1-integration.md) | done | - |
| [Phase 05: Cloudflare R2 Integration](./phase-05-r2-integration.md) | done | - |
| [Phase 06: Sync & Conflict Resolution](./phase-06-sync-conflict.md) | done | - |
| [Phase 07: Testing & Validation](./phase-07-testing.md) | pending | - |
| [Phase 08: UI & Cloud Onboarding](./phase-08-ui-onboarding.md) | pending | - |

## Key Decisions

### Database Engine
- **Local**: `better-sqlite3` (native C addon, ~10x faster than sql.js)
- **Cloud**: Cloudflare D1 (SQLite-compatible edge database)
- **Note**: Existing workflow/history modules stay on sql.js — only assets uses better-sqlite3

### Authentication (Electron ↔ Cloud)
- **Per-device API token** stored in `electron-store` settings
- Token configured in Settings UI, used for both D1 and R2 requests
- No backend proxy needed — direct client ↔ Cloudflare

### Sync Strategy (Simplified for Low Concurrency)
- **Use Case**: Delete, Move, Tag operations (rare concurrent edits)
- **Triggers**: Manual button + app focus (debounced 5s) + optional 15-min timer
- **Version-Based**: Higher version wins for conflicts
- **Tag Merge**: Union when same version (concurrent edit)
- **Delete Wins**: Tombstone pattern with version comparison
- **Offline-First**: Local DB is source of truth

### File Storage
- **Desktop**: Local filesystem (existing pattern)
- **Cloud**: Cloudflare R2 (S3-compatible)
- **Thumbnails**: Stored in R2, metadata reference only (`thumbnail_r2_key` column)

### Scale Target
- **Max assets**: 10,000 (current indexing strategy sufficient, no partitioning needed)
- **Full-text search**: Not in Phase 1, can add later with FTS5 virtual table

### Pagination
- **Cursor-based** using `(created_at, id)` composite for stable pagination

## Current Architecture

```
assets-metadata.json (localStorage + file)
├── AssetMetadata[] (all assets)
├── folders[] (separate JSON)
└── tagCategories[] (separate JSON)
```

### File Structure (Desktop)
```
~/Documents/WaveSpeed/
├── images/
├── videos/
├── audio/
└── text/
```

## Target Architecture (Simplified)

```
Local (Electron):                 Cloud (Cloudflare):
├── assets.db (better-sqlite3)   ├── D1 Database (synced)
│   ├── assets                   └── R2 Bucket (files + thumbnails)
│   │   ├── id, file_path, ...
│   │   ├── folder_id (direct FK)
│   │   ├── tags (JSON array)
│   │   ├── thumbnail_r2_key
│   │   ├── version
│   │   └── device_id
│   ├── folders
│   ├── tag_categories
│   ├── sync_state
│   ├── sync_log
│   └── deleted_items (tombstones)
└── local files (unchanged)
```

**Key Simplifications:**
- Direct `folder_id` FK (no junction table)
- Tags as JSON array (not normalized)
- `tag_categories.tags` as JSON array (not normalized)
- Simple version-based conflict resolution
- Tag merge on same-version conflicts

## Files to Create

### Database Layer
- `electron/assets/db/schema.ts` - Schema definitions
- `electron/assets/db/connection.ts` - better-sqlite3 connection management
- `electron/assets/db/assets.repo.ts` - Assets CRUD
- `electron/assets/db/folders.repo.ts` - Folders CRUD
- `electron/assets/db/tags.repo.ts` - Tags CRUD
- `electron/assets/db/sync.repo.ts` - Sync state management
- `electron/assets/db/index.ts` - Module exports

### IPC Layer
- `electron/assets/ipc-handlers.ts` - Dedicated IPC module (follows `electron/workflow/ipc/` pattern)

### Sync Layer
- `electron/assets/sync/sync-manager.ts` - Main sync orchestrator
- `electron/assets/sync/d1-client.ts` - D1 API client
- `electron/assets/sync/r2-client.ts` - R2 upload/download
- `electron/assets/sync/conflict-resolver.ts` - Conflict resolution
- `electron/assets/sync/sync-triggers.ts` - Auto-sync triggers
- `electron/assets/sync/index.ts` - Module exports

### UI Components (Phase 08)
- `src/components/sync/SyncSettings.tsx` - Sync configuration panel
- `src/components/sync/SyncIndicator.tsx` - Status indicator component
- `src/components/sync/SyncProgressDialog.tsx` - Sync progress dialog
- `src/components/sync/CloudOnboardingModal.tsx` - First-run onboarding modal

### Migrations
- `electron/assets/migrations/migrate-v1-to-v2.ts` - JSON to SQLite migration

## Files to Modify

### Electron Main Process
- `electron/main.ts` - Import assets IPC module (handlers live in `ipc-handlers.ts`)
- `electron/preload.ts` - Add sync API methods to contextBridge (Phase 08)

### Renderer Store & Types
- `src/stores/assetsStore.ts` - Update to use new IPC layer
- `src/types/asset.ts` - Add sync-related types
- `src/types/electron.d.ts` - Add sync API types (Phase 08)

### UI Integration (Phase 08)
- `src/pages/AssetsPage.tsx` - Integrate SyncIndicator component
- `src/pages/Settings.tsx` - Integrate SyncSettings component

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during migration | High | Backup JSON before migration, dry-run mode, rollback plan |
| Sync conflicts | Medium | Last-write-wins with manual resolution UI |
| Cloudflare API limits | Medium | Rate limiting, batch operations |
| D1 REST API latency (~50-200ms/query) | Medium | Batch sync operations, minimize round trips |
| Large file upload failures | Medium | Resumable uploads, progress reporting |
| Offline functionality regression | High | All operations work without cloud |

## Success Criteria

1. All existing assets migrate successfully
2. Performance improvements: <100ms for queries (vs full JSON load)
3. Cloud sync works bidirectionally
4. Offline-first maintained
5. No data loss during migration
6. Cursor-based pagination works efficiently

## Resolved Questions

1. ~~Should we support multi-device simultaneous editing?~~ **Answered**: Version-based sync, tag merge on same version
2. ~~What's the max asset count we need to support?~~ **Answered**: 10,000 — current indexing is sufficient
3. ~~Do we need full-text search?~~ **Answered**: Not in Phase 1, can add FTS5 later
4. ~~Should thumbnails be stored in DB or R2?~~ **Answered**: R2 with metadata reference only
