/**
 * SQLite database schema definitions for asset management.
 * Compatible with sql.js (WASM-based) and Cloudflare D1 (remote).
 *
 * Key simplifications for low-concurrency use case:
 * - Direct folder_id FK (no junction table)
 * - Tags as JSON array (not normalized)
 * - Tag categories with tags as JSON array
 * - Version-based conflict resolution
 */

import type { SqlJsDatabase } from "./connection";

export const SCHEMA_VERSION = 1;

// Database row types
export interface AssetRow {
  id: string;
  file_path: string;
  file_name: string;
  type: "image" | "video" | "audio" | "text" | "json";
  model_id: string;
  created_at: string;
  updated_at: string;
  file_size: number;
  favorite: 0 | 1;
  prediction_id: string | null;
  result_index: number;
  original_url: string | null;
  source: "playground" | "workflow" | "free-tool" | "z-image" | null;
  workflow_id: string | null;
  workflow_name: string | null;
  node_id: string | null;
  execution_id: string | null;
  folder_id: string | null;
  tags: string; // JSON array: ["tag1", "tag2"]
  cloud_r2_key: string | null;
  thumbnail_r2_key: string | null;
  device_id: string | null;
  version: number;
  sync_status: "synced" | "pending" | "deleted";
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
  sync_status: "synced" | "pending" | "deleted";
}

export interface TagCategoryRow {
  id: string;
  name: string;
  color: "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink";
  tags: string; // JSON array
  created_at: string;
  updated_at: string;
  device_id: string | null;
  version: number;
  sync_status: "synced" | "pending";
}

/**
 * Initialize database schema.
 * Compatible with sql.js and D1 (no JSON1 extension usage).
 */
export function initializeSchema(db: SqlJsDatabase): void {
  // Schema version tracking
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Assets table
  db.run(`CREATE TABLE IF NOT EXISTS assets (
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
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    tags TEXT DEFAULT '[]',
    cloud_r2_key TEXT,
    thumbnail_r2_key TEXT,
    device_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'deleted')),
    synced_at TEXT
  )`);

  // Folders table
  db.run(`CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    device_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'deleted'))
  )`);

  // Tag categories table (tags stored as JSON)
  db.run(`CREATE TABLE IF NOT EXISTS tag_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL CHECK (color IN ('default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink')),
    tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    device_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    sync_status TEXT NOT NULL DEFAULT 'synced'
  )`);

  // Sync state tracking (key-value pairs)
  db.run(`CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Sync log for debugging
  db.run(`CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'move')),
    device_id TEXT,
    version INTEGER,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Deleted items registry (tombstones for sync)
  db.run(`CREATE TABLE IF NOT EXISTS deleted_items (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('asset', 'folder', 'tag_category')),
    original_id TEXT NOT NULL,
    device_id TEXT,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0
  )`);

  // R2 config table for asset storage
  db.run(`CREATE TABLE IF NOT EXISTS r2_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  // Create indexes
  createIndexes(db);

  // Set initial schema version
  db.run("INSERT OR IGNORE INTO schema_version (version) VALUES (1)");
}

function createIndexes(db: SqlJsDatabase): void {
  // Assets indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type)");
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_model ON assets(model_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_prediction ON assets(prediction_id, result_index)");
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_execution ON assets(execution_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_sync_status ON assets(sync_status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_favorite ON assets(favorite) WHERE favorite = 1");
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_source ON assets(source)");
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_device ON assets(device_id)");

  // Search index (composite for filtering)
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_filter ON assets(type, created_at DESC, favorite)");

  // Pagination cursor index (stable cursor-based pagination)
  db.run("CREATE INDEX IF NOT EXISTS idx_assets_cursor ON assets(created_at DESC, id DESC)");

  // Folders index
  db.run("CREATE INDEX IF NOT EXISTS idx_folders_sync ON folders(sync_status)");

  // Tag categories index
  db.run("CREATE INDEX IF NOT EXISTS idx_tag_categories_sync ON tag_categories(sync_status)");

  // Sync indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_deleted_items_synced ON deleted_items(synced)");
}

/**
 * Run migrations (for schema evolution).
 * Currently at version 1, no migrations yet.
 */
export function runMigrations(db: SqlJsDatabase): void {
  const result = db.exec("SELECT MAX(version) as version FROM schema_version");
  const currentVersion = result[0]?.values?.[0]?.[0] as number ?? 0;

  if (currentVersion >= SCHEMA_VERSION) {
    return; // Already up to date
  }

  // Future migrations will be added here

  db.run("INSERT INTO schema_version (version) VALUES (?)", [SCHEMA_VERSION]);
}

/**
 * Get SQL for initializing remote D1 schema.
 * Returns a single SQL string with all statements.
 */
export function getRemoteSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assets (
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
      folder_id TEXT,
      tags TEXT DEFAULT '[]',
      cloud_r2_key TEXT,
      thumbnail_r2_key TEXT,
      device_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'deleted')),
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS folders (
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

    CREATE TABLE IF NOT EXISTS tag_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL CHECK (color IN ('default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink')),
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      device_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      sync_status TEXT NOT NULL DEFAULT 'synced'
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'move')),
      device_id TEXT,
      version INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deleted_items (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('asset', 'folder', 'tag_category')),
      original_id TEXT NOT NULL,
      device_id TEXT,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
      version INTEGER NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO schema_version (version) VALUES (1);

    -- R2 config table for asset storage
    CREATE TABLE IF NOT EXISTS r2_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `;
}
