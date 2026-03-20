# Asset Database Optimization - Planning Report

**Date:** 2026-03-18
**Type:** Implementation Plan
**Status:** Complete

## Summary

Comprehensive implementation plan for migrating asset management from JSON files to SQLite with Cloudflare D1/R2 cloud sync support.

## Plan Location

`plans/260318-1133-asset-database-optimization/`

## Files Created

| File | Description |
|------|-------------|
| `plan.md` | Overview with phase breakdown and key decisions |
| `phase-01-database-schema.md` | SQLite schema compatible with sql.js and D1 |
| `phase-02-local-sqlite.md` | Local SQLite implementation with repositories |
| `phase-03-migration.md` | JSON to SQLite migration with rollback |
| `phase-04-d1-integration.md` | Cloudflare D1 client and sync manager |
| `phase-05-r2-integration.md` | Cloudflare R2 file storage with multipart upload |
| `phase-06-sync-conflict.md` | Sync orchestration and conflict resolution UI |
| `phase-07-testing.md` | Comprehensive test suite specifications |

## Architecture Summary

### Current State
```
JSON Files:
- assets-metadata.json (all asset metadata)
- assets-folders.json (folders)
- assets-tag-categories.json (tag categories)
- deleted-assets.json (tombstones)

File System:
- ~/Documents/WaveSpeed/{images,videos,audio,text}/
```

### Target State
```
Local (sql.js):
- assets.db with 8 tables (assets, folders, tags, junctions, sync_state, etc.)
- Same file system for actual files

Cloud (optional):
- Cloudflare D1 for metadata sync
- Cloudflare R2 for file storage
```

## Key Technical Decisions

1. **Database Engine**: sql.js (WASM SQLite) - already used in workflow module
2. **Sync Strategy**: Last-write-wins with timestamp comparison
3. **Conflict Resolution**: Manual UI with automatic fallback
4. **Offline-First**: Local DB is source of truth, sync is optional
5. **File Storage**: Local filesystem primary, R2 for cloud backup

## Implementation Effort

| Phase | Effort | Priority |
|-------|--------|----------|
| 01: Schema Design | 3h | P1 |
| 02: Local SQLite | 6h | P1 |
| 03: Migration | 4h | P1 |
| 04: D1 Integration | 5h | P2 |
| 05: R2 Integration | 4h | P2 |
| 06: Sync & Conflict | 3h | P2 |
| 07: Testing | 5h | P1 |
| **Total** | **30h** | |

## Files to Create

### Database Layer (`electron/assets/db/`)
- `schema.ts` - Table definitions and migrations
- `connection.ts` - sql.js connection management
- `assets.repo.ts` - Assets CRUD with filtering
- `folders.repo.ts` - Folders CRUD
- `tags.repo.ts` - Tags & categories CRUD
- `sync.repo.ts` - Sync state management
- `index.ts` - Module exports

### Sync Layer (`electron/assets/sync/`)
- `d1-client.ts` - D1 API client
- `r2-client.ts` - R2 S3-compatible client
- `sync-manager.ts` - Sync orchestration
- `conflict-resolver.ts` - Conflict resolution logic
- `index.ts` - Module exports

### Migration (`electron/assets/migrations/`)
- `migrate-v1-to-v2.ts` - JSON to SQLite migration

### Files to Modify
- `electron/main.ts` - Add IPC handlers
- `src/stores/assetsStore.ts` - Use new DB layer via IPC
- `src/types/asset.ts` - Add sync-related types

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Backup JSON + rollback function |
| Sync conflicts | Last-write-wins + manual resolution UI |
| Cloudflare API limits | Rate limiting, batch operations |
| Large file upload failures | Multipart upload, resumable |
| Offline regression | All operations work without cloud |

## Success Criteria

1. All existing assets migrate successfully
2. Query performance <100ms (vs full JSON load)
3. Cloud sync works bidirectionally
4. Offline-first maintained
5. No data loss during migration
6. Pagination works efficiently

## Unresolved Questions

1. Should we support multi-device simultaneous editing? (complexity vs need)
2. Max asset count target? (affects indexing)
3. Full-text search needed? (SQLite FTS5 available but D1 doesn't support)
4. Should thumbnails be stored in DB or R2?

## Next Steps

If approved, proceed with:
1. Phase 01 (Schema) - foundational, blocks all other phases
2. Phase 02 (Local SQLite) - required before migration
3. Phase 03 (Migration) - enables testing with real data
4. Phases 04-06 are optional cloud sync features

## Notes

- Schema designed for D1 compatibility (no JSON1, limited indexes)
- Reuses sql.js pattern from existing workflow module
- Migration is idempotent and rollback-safe
- Sync is completely optional - app works without cloud
