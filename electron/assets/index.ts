/**
 * Assets module entry point.
 * Initializes the sql.js database and registers IPC handlers.
 */

import { closeDatabase, openDatabase } from "./db";
import { registerAssetsIpcHandlers } from "./ipc-handlers";
import { migrateJsonToSqlite, hasJsonData } from "./migrations/migrate-v1-to-v2";

let initialized = false;
let handlersRegistered = false;

/**
 * Register IPC handlers - this is done separately so handlers are always available
 * even if database initialization fails.
 */
function ensureHandlersRegistered(): void {
  if (handlersRegistered) return;
  try {
    registerAssetsIpcHandlers();
    handlersRegistered = true;
    console.log("[Assets] IPC handlers registered");
  } catch (error) {
    console.error("[Assets] Failed to register IPC handlers:", error);
    throw error;
  }
}

export async function initAssetsModule(): Promise<void> {
  if (initialized) {
    console.log("[Assets] Module already initialized");
    return;
  }

  // Register IPC handlers first - always do this regardless of DB state
  ensureHandlersRegistered();

  try {
    await openDatabase();

    // Check if we need to migrate from JSON to SQLite
    if (hasJsonData()) {
      console.log("[Assets] Migrating from JSON to SQLite...");
      const migrationResult = await migrateJsonToSqlite();
      if (!migrationResult.success) {
        console.error("[Assets] Migration completed with errors:", migrationResult.errors);
      } else {
        console.log(
          `[Assets] Migration complete: ${migrationResult.assetsMigrated} assets, ${migrationResult.foldersMigrated} folders, ${migrationResult.tagCategoriesMigrated} categories`
        );
      }
    }

    // One-time: Import folders from backup if they exist
    await importFoldersFromBackup();

    initialized = true;
    console.log("[Assets] Module initialized with sql.js");
  } catch (error) {
    console.error("[Assets] Failed to initialize database, IPC handlers still available:", error);
    // Don't throw - handlers are registered so app can fall back to JSON
  }
}

async function importFoldersFromBackup(): Promise<void> {
  const { readFileSync, existsSync } = await import("fs");
  const { join } = await import("path");
  const { getDatabase, persistDatabaseNow } = await import("./db/connection");

  // Try multiple possible backup locations
  const backupPaths = [
    join(process.cwd(), "folders-import.json"),
    join(process.cwd(), "assets-data", "assets-folders.json"),
  ];

  for (const backupPath of backupPaths) {
    if (!existsSync(backupPath)) continue;

    try {
      console.log("[Assets] Importing folders from:", backupPath);
      const data = JSON.parse(readFileSync(backupPath, "utf-8"));
      const folders = data.folders || [];

      let imported = 0;
      const db = getDatabase();

      // Begin transaction manually
      db.run("BEGIN TRANSACTION");
      try {
        for (const folder of folders) {
          try {
            db.run(
              `INSERT INTO folders (id, name, color, icon, created_at, updated_at, sync_status, version)
               VALUES (?, ?, ?, ?, ?, ?, 'synced', 1)`,
              [folder.id, folder.name, folder.color, folder.icon || null, folder.createdAt, folder.createdAt]
            );
            imported++;
          } catch (err: unknown) {
            // Skip duplicates
            if ((err as { code?: string }).code !== "SQLITE_CONSTRAINT_PRIMARYKEY") {
              console.error(`Failed to import folder ${folder.id}:`, err);
            }
          }
        }
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }

      if (imported > 0) {
        console.log(`[Assets] Imported ${imported} folders from backup`);
        persistDatabaseNow();
      }
      return;
    } catch (err) {
      console.error("[Assets] Failed to import folders from backup:", err);
    }
  }
}

export function closeAssetsDatabase(): void {
  if (initialized) {
    closeDatabase();
    initialized = false;
    console.log("[Assets] Database closed");
  }
}

export function isAssetsModuleInitialized(): boolean {
  return initialized;
}
