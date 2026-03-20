/**
 * Sync state repository - Manages sync status and pending items.
 * Uses sql.js for database operations.
 */

import { transaction, getDatabase, persistDatabase } from "./connection";

export interface SyncState {
  lastSyncAt: string | null;
  deviceId: string | null;
  remoteVersion: number | null;
  syncEnabled: boolean;
}

export class SyncRepository {
  /**
   * Get sync state value by key.
   */
  getState(key: string): string | null {
    const db = getDatabase();
    const result = db.exec("SELECT value FROM sync_state WHERE key = ?", [key]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return result[0].values[0][0] as string;
  }

  /**
   * Set sync state value.
   */
  setState(key: string, value: string): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, now]
    );
    persistDatabase();
  }

  /**
   * Get full sync state.
   */
  getFullState(): SyncState {
    return {
      lastSyncAt: this.getState("lastSyncAt"),
      deviceId: this.getState("deviceId"),
      remoteVersion: this.getState("remoteVersion")
        ? parseInt(this.getState("remoteVersion")!, 10)
        : null,
      syncEnabled: this.getState("syncEnabled") === "true",
    };
  }

  /**
   * Set device ID.
   */
  setDeviceId(deviceId: string): void {
    this.setState("deviceId", deviceId);
  }

  /**
   * Get device ID.
   */
  getDeviceId(): string | null {
    return this.getState("deviceId");
  }

  /**
   * Update last sync timestamp.
   */
  updateLastSync(): void {
    this.setState("lastSyncAt", new Date().toISOString());
  }

  /**
   * Get pending sync items.
   */
  getPendingItems(): {
    assets: string[];
    folders: string[];
    categories: string[];
  } {
    const db = getDatabase();

    const assetsResult = db.exec("SELECT id FROM assets WHERE sync_status = 'pending'");
    const foldersResult = db.exec("SELECT id FROM folders WHERE sync_status = 'pending'");
    const categoriesResult = db.exec("SELECT id FROM tag_categories WHERE sync_status = 'pending'");

    const assets = assetsResult.length > 0 ? assetsResult[0].values.map((r) => r[0] as string) : [];
    const folders = foldersResult.length > 0 ? foldersResult[0].values.map((r) => r[0] as string) : [];
    const categories = categoriesResult.length > 0 ? categoriesResult[0].values.map((r) => r[0] as string) : [];

    return { assets, folders, categories };
  }

  /**
   * Get deleted items that need sync.
   */
  getDeletedItems(): Array<{
    id: string;
    entityType: string;
    originalId: string;
  }> {
    const db = getDatabase();
    const result = db.exec("SELECT * FROM deleted_items WHERE synced = 0");
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
      id: row[0] as string,
      entityType: row[1] as string,
      originalId: row[2] as string,
    }));
  }

  /**
   * Mark deleted items as synced.
   */
  markDeletedSynced(ids: string[]): void {
    const db = getDatabase();
    for (const id of ids) {
      db.run("UPDATE deleted_items SET synced = 1 WHERE id = ?", [id]);
    }
    persistDatabase();
  }

  /**
   * Mark items as synced (remove from pending).
   */
  markAsSynced(table: "assets" | "folders" | "tag_categories", ids: string[]): void {
    const db = getDatabase();
    for (const id of ids) {
      db.run(`UPDATE ${table} SET sync_status = 'synced' WHERE id = ?`, [id]);
    }
    persistDatabase();
  }

  /**
   * Mark items as pending for sync.
   */
  markAsPending(table: "assets" | "folders" | "tag_categories", ids: string[]): void {
    const db = getDatabase();
    for (const id of ids) {
      db.run(`UPDATE ${table} SET sync_status = 'pending' WHERE id = ?`, [id]);
    }
    persistDatabase();
  }

  /**
   * Log sync event.
   */
  logEvent(entry: {
    entityType: string;
    entityId: string;
    operation: "create" | "update" | "delete" | "move";
    deviceId?: string;
    version?: number;
  }): void {
    const db = getDatabase();
    db.run(
      `INSERT INTO sync_log (entity_type, entity_id, operation, device_id, version, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.entityType,
        entry.entityId,
        entry.operation,
        entry.deviceId ?? null,
        entry.version ?? null,
        new Date().toISOString(),
      ]
    );
    persistDatabase();
  }

  /**
   * Get recent sync log entries.
   */
  getRecentLog(limit: number = 100): unknown[] {
    const db = getDatabase();
    const result = db.exec("SELECT * FROM sync_log ORDER BY timestamp DESC LIMIT ?", [limit]);
    if (result.length === 0) return [];
    return result[0].values;
  }

  /**
   * Clean up old sync log entries (keep last N entries).
   */
  cleanupLog(keepLast: number = 1000): void {
    const db = getDatabase();
    const result = db.exec("SELECT COUNT(*) as count FROM sync_log");
    const count = (result[0]?.values?.[0]?.[0] as number) ?? 0;

    if (count > keepLast) {
      const toDelete = count - keepLast;
      db.run(
        `DELETE FROM sync_log WHERE id IN (
          SELECT id FROM sync_log ORDER BY timestamp ASC LIMIT ?
        )`,
        [toDelete]
      );
      persistDatabase();
    }
  }

  /**
   * Enable/disable sync.
   */
  setSyncEnabled(enabled: boolean): void {
    this.setState("syncEnabled", enabled.toString());
  }

  /**
   * Check if sync is enabled.
   */
  isSyncEnabled(): boolean {
    return this.getState("syncEnabled") === "true";
  }

  /**
   * Get R2 configuration from database.
   */
  getR2Config(): {
    accountId: string | null;
    bucket: string | null;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    publicUrl: string | null;
  } {
    const db = getDatabase();
    const result = db.exec("SELECT key, value FROM r2_config");

    const config: Record<string, string> = {};
    if (result.length > 0) {
      for (const row of result[0].values) {
        config[row[0] as string] = row[1] as string;
      }
    }

    return {
      accountId: config["accountId"] ?? null,
      bucket: config["bucket"] ?? null,
      accessKeyId: config["accessKeyId"] ?? null,
      secretAccessKey: config["secretAccessKey"] ?? null,
      publicUrl: config["publicUrl"] ?? null,
    };
  }

  /**
   * Set R2 configuration in database.
   */
  setR2Config(config: {
    accountId?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicUrl?: string;
  }): void {
    const db = getDatabase();

    const entries = Object.entries(config).filter(([_, value]) => value !== undefined);

    for (const [key, value] of entries) {
      db.run(
        `INSERT INTO r2_config (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [key, value as string]
      );
    }

    persistDatabase();
  }

  /**
   * Clear R2 configuration from database.
   */
  clearR2Config(): void {
    const db = getDatabase();
    db.run("DELETE FROM r2_config");
    persistDatabase();
  }
}

export const syncRepo = new SyncRepository();
