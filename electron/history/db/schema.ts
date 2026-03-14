/**
 * SQLite database schema definitions and migrations for history cache.
 */

import type { Database as SqlJsDatabase } from "sql.js";

export function initializeSchema(db: SqlJsDatabase): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'created')),
    outputs JSON,
    inputs JSON,
    input_details JSON,
    reference_images JSON,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    execution_time INTEGER,
    has_nsfw_contents INTEGER DEFAULT 0,
    error TEXT,
    synced_at TEXT
  )`);

  // Indexes for common queries
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_history_created ON predictions(created_at DESC)",
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_history_model ON predictions(model_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_history_status ON predictions(status)");

  db.run("INSERT OR IGNORE INTO schema_version (version) VALUES (1)");
  console.log("[History Cache Schema] Initialized schema version 1");
}

export function runMigrations(db: SqlJsDatabase): void {
  const result = db.exec("SELECT MAX(version) as version FROM schema_version");
  const currentVersion = (result[0]?.values?.[0]?.[0] as number) ?? 0;

  const migrations: Array<{
    version: number;
    apply: (db: SqlJsDatabase) => void;
  }> = [
    {
      version: 2,
      apply: (db) => {
        console.log("[History Cache Migration] Running migration v2: Add input_details and reference_images");
        // Add input_details column for full inputs
        db.run(
          "ALTER TABLE predictions ADD COLUMN input_details JSON",
        );
        // Add reference_images column for downloaded reference images
        db.run(
          "ALTER TABLE predictions ADD COLUMN reference_images JSON",
        );
        db.run("INSERT OR IGNORE INTO schema_version (version) VALUES (2)");
        console.log("[History Cache Migration] Migration v2 completed");
      },
    },
  ];

  for (const m of migrations) {
    if (m.version > currentVersion) {
      m.apply(db);
    }
  }
}
