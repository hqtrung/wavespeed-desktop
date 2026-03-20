---
title: "Phase 01: Database Schema Design"
description: "Define SQLite schema compatible with both local better-sqlite3 and Cloudflare D1"
status: done
priority: P1
effort: 3h
tags: [database, schema, sqlite]
created: 2026-03-18
completed: 2026-03-18
---

# Phase 01: Database Schema Design

## Context Links
- Parent: [plan.md](./plan.md)
- Current assets: `src/stores/assetsStore.ts`
- Current types: `src/types/asset.ts`
- Reference DB: `electron/workflow/db/schema.ts`

## Overview

Design a SQLite schema that works with both:
1. **better-sqlite3** (native C addon, used in Electron main process for assets)
2. **Cloudflare D1** (edge SQLite, limited feature set)

## Key Constraints

### Cloudflare D1 Limitations
- No `JSON1` extension (use TEXT with JSON.stringify/parse)
- No `FTS5` full-text search (use LIKE or external search) — FTS5 deferred to future phase
- No WAL mode in auto-commit
- Max 25MB per database
- No recursive triggers

### better-sqlite3 Considerations
- Native C addon — faster than sql.js (~10x)
- File-based by default (auto-persists, no manual export needed)
- Full SQLite feature set available (WAL mode, FTS5, JSON1)
- Main process only (not renderer)

### Scale Target
- **Max 10,000 assets** — current indexing strategy is sufficient
- No partitioning or sharding needed at this scale

## Schema Design (Simplified for Low Concurrency)

**Key Simplification:** Direct foreign keys + JSON tags (since concurrent edits are rare)

```sql
-- Assets table (main records)
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('image', 'video', 'audio', 'text', 'json')),
  model_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  file_size INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  prediction_id TEXT,
  result_index INTEGER NOT NULL DEFAULT 0,
  original_url TEXT,
  source TEXT CHECK (source IN ('playground', 'workflow', 'free-tool', 'z-image')),
  workflow_id TEXT,
  workflow_name TEXT,
  node_id TEXT,
  execution_id TEXT,

  -- Folder assignment (direct, not junction table)
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,

  -- Tags stored as JSON array (simple, works for low concurrency)
  tags TEXT DEFAULT '[]',

  -- Cloud sync fields
  cloud_r2_key TEXT,
  thumbnail_r2_key TEXT,  -- Thumbnail stored in R2, reference only
  device_id TEXT,  -- Which device last modified
  version INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'deleted')),
  synced_at TEXT
);

-- Folders table (collections)
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  device_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'deleted'))
);

-- Tag categories (for UI organization)
-- Tags stored as JSON array directly (simplified, no junction table)
CREATE TABLE tag_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink')),
  tags TEXT DEFAULT '[]',  -- JSON array of tag strings
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  device_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'synced'
);

-- Sync state tracking (key-value pairs)
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sync log for debugging
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,  -- 'asset', 'folder', 'tag_category'
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'move')),
  device_id TEXT,
  version INTEGER,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Deleted items registry (tombstones for sync)
CREATE TABLE deleted_items (
  id TEXT PRIMARY KEY,  -- Unique tombstone ID
  entity_type TEXT NOT NULL CHECK (entity_type IN ('asset', 'folder', 'tag_category')),
  original_id TEXT NOT NULL,  -- Original entity ID
  device_id TEXT,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0  -- 0 = needs sync, 1 = synced
);

-- Schema version
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Indexes

```sql
-- Assets indexes
CREATE INDEX idx_assets_type ON assets(type);
CREATE INDEX idx_assets_model ON assets(model_id);
CREATE INDEX idx_assets_created ON assets(created_at DESC);
CREATE INDEX idx_assets_prediction ON assets(prediction_id, result_index);
CREATE INDEX idx_assets_execution ON assets(execution_id);
CREATE INDEX idx_assets_sync_status ON assets(sync_status);
CREATE INDEX idx_assets_favorite ON assets(favorite) WHERE favorite = 1;
CREATE INDEX idx_assets_source ON assets(source);
CREATE INDEX idx_assets_folder ON assets(folder_id);  -- For folder queries
CREATE INDEX idx_assets_device ON assets(device_id);   -- For sync

-- Search index (composite for filtering)
CREATE INDEX idx_assets_filter ON assets(type, created_at DESC, favorite);

-- Pagination cursor index (stable cursor-based pagination)
CREATE INDEX idx_assets_cursor ON assets(created_at DESC, id DESC);

-- Folders index
CREATE INDEX idx_folders_sync ON folders(sync_status);

-- Tag categories index
CREATE INDEX idx_tag_categories_sync ON tag_categories(sync_status);

-- Sync indexes
CREATE INDEX idx_sync_log_entity ON sync_log(entity_type, entity_id);
CREATE INDEX idx_deleted_items_synced ON deleted_items(synced);
```

## Pagination Design (Cursor-Based)

Cursor-based pagination using `(created_at, id)` for stable results during inserts/deletes.

### Cursor Format

```typescript
// Cursor is base64-encoded JSON: { createdAt: string, id: string }
type PaginationCursor = string;

interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;  // null = no more pages
  totalCount: number;         // Total matching items (cached, approximate)
}
```

### Query Pattern

```sql
-- First page (no cursor)
SELECT * FROM assets
WHERE sync_status != 'deleted'
ORDER BY created_at DESC, id DESC
LIMIT ?;

-- Subsequent pages (with cursor)
SELECT * FROM assets
WHERE sync_status != 'deleted'
  AND (created_at < ? OR (created_at = ? AND id < ?))
ORDER BY created_at DESC, id DESC
LIMIT ?;
```

## TypeScript Types

```typescript
// electron/assets/db/schema.ts

export interface AssetRow {
  id: string;
  file_path: string;
  file_name: string;
  type: 'image' | 'video' | 'audio' | 'text' | 'json';
  model_id: string;
  created_at: string;
  updated_at: string;
  file_size: number;
  favorite: 0 | 1;
  prediction_id: string | null;
  result_index: number;
  original_url: string | null;
  source: 'playground' | 'workflow' | 'free-tool' | 'z-image' | null;
  workflow_id: string | null;
  workflow_name: string | null;
  node_id: string | null;
  execution_id: string | null;
  folder_id: string | null;  // Direct foreign key (simplified)
  tags: string;  // JSON array: ["tag1", "tag2"]
  cloud_r2_key: string | null;
  thumbnail_r2_key: string | null;  // Thumbnail in R2, reference only
  device_id: string | null;
  version: number;
  sync_status: 'synced' | 'pending' | 'deleted';
  synced_at: string | null;
}

export interface FolderRow {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  created_at: string;
  updated_at: string;
  device_id: string | null;
  version: number;
  sync_status: 'synced' | 'pending' | 'deleted';
}

export interface TagCategoryRow {
  id: string;
  name: string;
  color: 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink';
  tags: string;  // JSON array
  created_at: string;
  updated_at: string;
  device_id: string | null;
  version: number;
  sync_status: 'synced' | 'pending';
}

export const SCHEMA_VERSION = 1;
```

## Implementation Steps

1. [ ] Create `electron/assets/db/schema.ts` with table definitions
2. [ ] Create `initializeSchema()` function matching workflow pattern
3. [ ] Create `runMigrations()` function for schema evolution
4. [ ] Add type exports for row interfaces
5. [ ] Document D1 compatibility notes

## Success Criteria

- Schema compiles without errors
- All foreign keys properly defined
- Indexes cover common query patterns (including cursor pagination)
- Compatible with both better-sqlite3 and D1
- `thumbnail_r2_key` column present for R2 thumbnail references

## Next Steps

[Phase 02: Local SQLite Implementation](./phase-02-local-sqlite.md)
