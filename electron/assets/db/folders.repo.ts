/**
 * Folders repository - CRUD operations for asset folders.
 * Uses sql.js for database operations.
 */

import { transaction, getDatabase, persistDatabase } from "./connection";
import type { AssetFolder } from "@/types/asset";

export class FoldersRepository {
  /**
   * Get all folders.
   */
  getAll(): AssetFolder[] {
    const db = getDatabase();
    const result = db.exec(
      "SELECT * FROM folders WHERE sync_status != 'deleted' ORDER BY name"
    );
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
      id: row[0] as string,
      name: row[1] as string,
      color: row[2] as string,
      icon: (row[3] as string | null) ?? undefined,
      createdAt: row[4] as string,
    }));
  }

  /**
   * Get folder by ID.
   */
  getById(id: string): AssetFolder | null {
    const db = getDatabase();
    const result = db.exec(
      "SELECT * FROM folders WHERE id = ? AND sync_status != 'deleted'",
      [id]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;

    const row = result[0].values[0];
    return {
      id: row[0] as string,
      name: row[1] as string,
      color: row[2] as string,
      icon: (row[3] as string | null) ?? undefined,
      createdAt: row[4] as string,
    };
  }

  /**
   * Create folder.
   */
  create(folder: Omit<AssetFolder, "id" | "createdAt">): string {
    return transaction((db) => {
      const id = this.generateId();
      const now = new Date().toISOString();

      db.run(
        `INSERT INTO folders (id, name, color, icon, created_at, updated_at, sync_status, version)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 1)`,
        [id, folder.name, folder.color, folder.icon ?? null, now, now]
      );

      return id;
    });
  }

  /**
   * Update folder.
   */
  update(id: string, updates: Partial<Pick<AssetFolder, "name" | "color" | "icon">>): void {
    transaction((db) => {
      const sets: string[] = ["updated_at = ?", "sync_status = 'pending'", "version = version + 1"];
      const params: unknown[] = [new Date().toISOString()];

      if (updates.name !== undefined) {
        sets.push("name = ?");
        params.push(updates.name);
      }
      if (updates.color !== undefined) {
        sets.push("color = ?");
        params.push(updates.color);
      }
      if (updates.icon !== undefined) {
        sets.push("icon = ?");
        params.push(updates.icon);
      }

      params.push(id);
      db.run(`UPDATE folders SET ${sets.join(", ")} WHERE id = ?`, params);
    });
  }

  /**
   * Delete folder.
   */
  delete(id: string, moveAssetsTo: string | null = null): void {
    transaction((db) => {
      const now = new Date().toISOString();

      // Mark folder as deleted
      db.run("UPDATE folders SET sync_status = 'deleted', updated_at = ? WHERE id = ?", [now, id]);

      // Create tombstone
      const tombstoneId = this.generateId();
      db.run(
        `INSERT INTO deleted_items (id, entity_type, original_id, deleted_at, version, synced)
         VALUES (?, 'folder', ?, ?, 1, 0)`,
        [tombstoneId, id, now]
      );

      // Update assets that were in this folder
      if (moveAssetsTo !== null) {
        // Move to specified folder (or unassign if moveAssetsTo is "__none__")
        const newFolderId = moveAssetsTo === "__none__" ? null : moveAssetsTo;
        db.run(
          "UPDATE assets SET folder_id = ?, updated_at = ?, sync_status = 'pending', version = version + 1 WHERE folder_id = ?",
          [newFolderId, now, id]
        );
      } else {
        // Unassign all assets from this folder
        db.run(
          "UPDATE assets SET folder_id = NULL, updated_at = ?, sync_status = 'pending', version = version + 1 WHERE folder_id = ?",
          [now, id]
        );
      }
    });
  }

  /**
   * Get asset count for folder.
   */
  getAssetCount(folderId: string): number {
    const db = getDatabase();
    const result = db.exec(
      "SELECT COUNT(*) as count FROM assets WHERE folder_id = ? AND sync_status != 'deleted'",
      [folderId]
    );
    return (result[0]?.values?.[0]?.[0] as number) ?? 0;
  }

  /**
   * Get pending items for sync.
   */
  getPending(): unknown[] {
    const db = getDatabase();
    const result = db.exec("SELECT * FROM folders WHERE sync_status = 'pending'");
    if (result.length === 0) return [];
    return result[0].values;
  }

  /**
   * Mark folders as synced.
   */
  markAsSynced(ids: string[]): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    for (const id of ids) {
      db.run("UPDATE folders SET sync_status = 'synced', synced_at = ? WHERE id = ?", [now, id]);
    }
    persistDatabase();
  }

  /**
   * Upsert folder from sync.
   */
  upsertFromSync(folder: {
    id: string;
    name: string;
    color: string;
    icon: string | null;
    created_at: string;
    updated_at: string;
    version: number;
  }): void {
    const db = getDatabase();
    const result = db.exec("SELECT id, version FROM folders WHERE id = ?", [folder.id]);

    if (result.length > 0 && result[0].values.length > 0) {
      const existing = result[0].values[0];
      const existingVersion = existing[1] as number;

      if (folder.version > existingVersion) {
        db.run(
          `UPDATE folders SET
            name = ?, color = ?, icon = ?, updated_at = ?, version = ?, sync_status = 'synced'
           WHERE id = ?`,
          [folder.name, folder.color, folder.icon, folder.updated_at, folder.version, folder.id]
        );
        persistDatabase();
      }
    } else {
      db.run(
        `INSERT INTO folders (id, name, color, icon, created_at, updated_at, version, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')`,
        [folder.id, folder.name, folder.color, folder.icon, folder.created_at, folder.updated_at, folder.version]
      );
      persistDatabase();
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
}

export const foldersRepo = new FoldersRepository();
