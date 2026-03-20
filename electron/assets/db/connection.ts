/**
 * SQLite database connection management using sql.js (WASM-based).
 * Follows the same pattern as history cache module for consistency.
 */

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { app } from "electron";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "fs";
import { dirname } from "path";
import { initializeSchema, runMigrations } from "./schema";

const DB_FILENAME = "assets.db";
const DB_DIR = "assets-data";

let db: SqlJsDatabase | null = null;
let dbPath: string = "";

function getAssetsDataRoot(): string {
  if (app.isPackaged) {
    return join(app.getPath("userData"), DB_DIR);
  }
  return join(app.getAppPath(), DB_DIR);
}

export type { SqlJsDatabase };

export function getDatabasePath(): string {
  if (!dbPath) {
    try {
      dbPath = join(getAssetsDataRoot(), DB_FILENAME);
    } catch {
      dbPath = join(process.cwd(), DB_DIR, DB_FILENAME);
    }
  }
  return dbPath;
}

function saveToDisk(): void {
  if (!db) return;
  const filePath = getDatabasePath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(filePath, buffer);
  console.log("[Assets DB] Database saved to:", filePath);
}

export async function openDatabase(): Promise<SqlJsDatabase> {
  if (db) return db;

  const SQL = await initSqlJs();
  const filePath = getDatabasePath();
  console.log("[Assets DB] Database path:", filePath);
  const dbExists = existsSync(filePath);
  console.log("[Assets DB] Database exists:", dbExists);
  let isCorrupt = false;

  if (dbExists) {
    try {
      const fileBuffer = readFileSync(filePath);
      db = new SQL.Database(fileBuffer);
      const result = db.exec("PRAGMA integrity_check");
      const ok = result[0]?.values?.[0]?.[0];
      if (ok !== "ok") throw new Error("integrity_check failed");
    } catch (error) {
      console.error("[Assets DB] Database corrupt or unreadable:", error);
      isCorrupt = true;
      if (db) {
        db.close();
        db = null;
      }
      const backupPath = `${filePath}.corrupt.${Date.now()}`;
      renameSync(filePath, backupPath);
      console.warn(`[Assets DB] Corrupt database backed up to: ${backupPath}`);
    }
  }

  if (!db) {
    console.log("[Assets DB] Creating new in-memory database");
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys = ON");

  if (!dbExists || isCorrupt) {
    console.log("[Assets DB] Initializing schema...");
    initializeSchema(db);
    console.log("[Assets DB] Saving to disk...");
    saveToDisk();
  } else {
    console.log("[Assets DB] Running migrations...");
    runMigrations(db);
    saveToDisk();
  }

  console.log("[Assets DB] Database opened successfully");
  return db;
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error("[Assets DB] Database not initialized. Call openDatabase() first.");
  }
  return db;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist — batches rapid writes into a single disk flush (max 500ms delay) */
export function persistDatabase(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveToDisk();
  }, 500);
}

/** Immediate persist — for critical moments like close/shutdown */
export function persistDatabaseNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  saveToDisk();
}

export function closeDatabase(): void {
  if (db) {
    try {
      persistDatabaseNow();
      db.close();
    } catch (error) {
      console.error("[Assets DB] Error closing database:", error);
    } finally {
      db = null;
    }
  }
}

export function transaction<T>(fn: (db: SqlJsDatabase) => T): T {
  const database = getDatabase();
  database.run("BEGIN TRANSACTION");
  try {
    const result = fn(database);
    database.run("COMMIT");
    saveToDisk();
    return result;
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
}

/**
 * Vacuum the database to reclaim space.
 * Call this periodically or after large deletions.
 */
export function vacuumDatabase(): void {
  const database = getDatabase();
  database.run("VACUUM");
  saveToDisk();
}

/**
 * Get database statistics for monitoring.
 */
export function getDatabaseStats(): {
  pageCount: number;
  pageSize: number;
  databaseSize: number;
} {
  const database = getDatabase();
  const result = database.exec("PRAGMA page_count");
  const pageCount = result[0]?.values?.[0]?.[0] as number ?? 0;
  const sizeResult = database.exec("PRAGMA page_size");
  const pageSize = sizeResult[0]?.values?.[0]?.[0] as number ?? 0;

  return {
    pageCount,
    pageSize,
    databaseSize: pageCount * pageSize,
  };
}
