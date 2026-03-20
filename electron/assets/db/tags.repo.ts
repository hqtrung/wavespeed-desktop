/**
 * Tags repository - CRUD operations for tag categories.
 * Tags are stored as JSON arrays within categories (simplified schema).
 * Uses sql.js for database operations.
 */

import { transaction, getDatabase, persistDatabase } from "./connection";
import type { TagCategory, TagColor } from "@/types/asset";

export class TagsRepository {
  /**
   * Get all tag categories.
   */
  getAllCategories(): TagCategory[] {
    const db = getDatabase();
    const result = db.exec(
      "SELECT * FROM tag_categories WHERE sync_status != 'deleted' ORDER BY name"
    );
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
      id: row[0] as string,
      name: row[1] as string,
      color: row[2] as TagColor,
      tags: JSON.parse((row[3] as string) || "[]"),
      createdAt: row[4] as string,
    }));
  }

  /**
   * Get category by ID.
   */
  getCategoryById(id: string): TagCategory | null {
    const db = getDatabase();
    const result = db.exec(
      "SELECT * FROM tag_categories WHERE id = ? AND sync_status != 'deleted'",
      [id]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;

    const row = result[0].values[0];
    return {
      id: row[0] as string,
      name: row[1] as string,
      color: row[2] as TagColor,
      tags: JSON.parse((row[3] as string) || "[]"),
      createdAt: row[4] as string,
    };
  }

  /**
   * Create tag category.
   */
  createCategory(name: string, color: TagColor, tags: string[] = []): string {
    return transaction((db) => {
      const id = this.generateId();
      const now = new Date().toISOString();

      db.run(
        `INSERT INTO tag_categories (id, name, color, tags, created_at, updated_at, sync_status, version)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 1)`,
        [id, name, color, JSON.stringify(tags), now, now]
      );

      return id;
    });
  }

  /**
   * Update tag category.
   */
  updateCategory(
    id: string,
    updates: Partial<Pick<TagCategory, "name" | "color" | "tags">>
  ): void {
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
      if (updates.tags !== undefined) {
        sets.push("tags = ?");
        params.push(JSON.stringify(updates.tags));
      }

      params.push(id);
      db.run(`UPDATE tag_categories SET ${sets.join(", ")} WHERE id = ?`, params);
    });
  }

  /**
   * Delete tag category.
   */
  deleteCategory(id: string): void {
    transaction((db) => {
      const now = new Date().toISOString();

      db.run("UPDATE tag_categories SET sync_status = 'deleted', updated_at = ? WHERE id = ?", [now, id]);

      // Create tombstone
      const tombstoneId = this.generateId();
      db.run(
        `INSERT INTO deleted_items (id, entity_type, original_id, deleted_at, version, synced)
         VALUES (?, 'tag_category', ?, ?, 1, 0)`,
        [tombstoneId, id, now]
      );
    });
  }

  /**
   * Get pending items for sync.
   */
  getPending(): unknown[] {
    const db = getDatabase();
    const result = db.exec("SELECT * FROM tag_categories WHERE sync_status = 'pending'");
    if (result.length === 0) return [];
    return result[0].values;
  }

  /**
   * Mark categories as synced.
   */
  markAsSynced(ids: string[]): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    for (const id of ids) {
      db.run("UPDATE tag_categories SET sync_status = 'synced', synced_at = ? WHERE id = ?", [now, id]);
    }
    persistDatabase();
  }

  /**
   * Upsert category from sync.
   */
  upsertFromSync(category: {
    id: string;
    name: string;
    color: TagColor;
    tags: string;
    created_at: string;
    updated_at: string;
    version: number;
  }): void {
    const db = getDatabase();
    const result = db.exec("SELECT id, version FROM tag_categories WHERE id = ?", [category.id]);

    if (result.length > 0 && result[0].values.length > 0) {
      const existing = result[0].values[0];
      const existingVersion = existing[1] as number;

      if (category.version > existingVersion) {
        db.run(
          `UPDATE tag_categories SET
            name = ?, color = ?, tags = ?, updated_at = ?, version = ?, sync_status = 'synced'
           WHERE id = ?`,
          [category.name, category.color, category.tags, category.updated_at, category.version, category.id]
        );
        persistDatabase();
      }
    } else {
      db.run(
        `INSERT INTO tag_categories (id, name, color, tags, created_at, updated_at, version, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')`,
        [category.id, category.name, category.color, category.tags, category.created_at, category.updated_at, category.version]
      );
      persistDatabase();
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
}

export const tagsRepo = new TagsRepository();
