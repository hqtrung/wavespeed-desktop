/**
 * Assets repository - CRUD operations for asset metadata.
 * Uses sql.js for queries with cursor-based pagination.
 */

import type { SqlJsDatabase } from "./connection";
import { transaction, getDatabase, persistDatabase } from "./connection";
import type { AssetRow } from "./schema";
import type { AssetMetadata } from "@/types/asset";

// Row -> Metadata converter
export function rowToMetadata(row: unknown[]): AssetMetadata {
  return {
    id: row[0] as string,
    filePath: row[1] as string,
    fileName: row[2] as string,
    type: row[3] as "image" | "video" | "audio" | "text" | "json",
    modelId: row[4] as string,
    createdAt: row[5] as string,
    fileSize: row[7] as number,
    tags: JSON.parse((row[18] as string) || "[]"),
    favorite: (row[8] as number) === 1,
    predictionId: (row[9] as string | null) ?? undefined,
    resultIndex: row[10] as number,
    originalUrl: (row[11] as string | null) ?? undefined,
    source: (row[12] as string | null) ?? undefined,
    workflowId: (row[13] as string | null) ?? undefined,
    workflowName: (row[14] as string | null) ?? undefined,
    nodeId: (row[15] as string | null) ?? undefined,
    executionId: (row[16] as string | null) ?? undefined,
    folderId: (row[17] as string | null) ?? undefined,
    cloudR2Key: (row[19] as string | null) ?? undefined,
    locallyAvailable: true, // Will be computed by frontend checking file existence
  };
}

export interface AssetFilter {
  types?: string[];
  models?: string[];
  sources?: string[];
  dateFrom?: string;
  dateTo?: string;
  favoritesOnly?: boolean;
  folderId?: string | null;
  search?: string;
  limit?: number;
  cursor?: string; // Base64-encoded cursor for pagination
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  totalCount: number;
}

// Cursor helpers
function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString("base64");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  return JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
}

export class AssetsRepository {
  /**
   * Insert new asset.
   */
  insert(asset: Omit<AssetMetadata, "tags"> & { tags: string[] }): string {
    return transaction((db) => {
      const id = asset.id || this.generateId();
      const now = new Date().toISOString();

      db.run(
        `INSERT INTO assets (
          id, file_path, file_name, type, model_id, created_at, updated_at,
          file_size, favorite, prediction_id, result_index, original_url,
          source, workflow_id, workflow_name, node_id, execution_id,
          folder_id, tags, sync_status, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
        [
          id,
          asset.filePath,
          asset.fileName,
          asset.type,
          asset.modelId,
          asset.createdAt || now,
          now,
          asset.fileSize,
          asset.favorite ? 1 : 0,
          asset.predictionId ?? null,
          asset.resultIndex ?? 0,
          asset.originalUrl ?? null,
          asset.source ?? null,
          asset.workflowId ?? null,
          asset.workflowName ?? null,
          asset.nodeId ?? null,
          asset.executionId ?? null,
          asset.folderId ?? null,
          JSON.stringify(asset.tags),
        ]
      );

      return id;
    });
  }

  /**
   * Update asset (tags, favorite, folderId).
   */
  update(
    id: string,
    updates: Partial<Pick<AssetMetadata, "tags" | "favorite" | "folderId">>
  ): void {
    transaction((db) => {
      const sets: string[] = ["updated_at = ?", "sync_status = 'pending'", "version = version + 1"];
      const params: unknown[] = [new Date().toISOString()];

      if (updates.favorite !== undefined) {
        sets.push("favorite = ?");
        params.push(updates.favorite ? 1 : 0);
      }

      if (updates.tags !== undefined) {
        sets.push("tags = ?");
        params.push(JSON.stringify(updates.tags));
      }

      if (updates.folderId !== undefined) {
        sets.push("folder_id = ?");
        params.push(updates.folderId ?? null);
      }

      params.push(id);
      db.run(`UPDATE assets SET ${sets.join(", ")} WHERE id = ?`, params);
    });
  }

  /**
   * Delete asset (soft delete for sync, plus file deletion).
   * File deletion happens AFTER DB transaction succeeds to prevent data loss.
   */
  delete(id: string): void {
    const now = new Date().toISOString();
    let filePathToDelete: string | null = null;

    // First: Update DB in transaction
    transaction((db) => {
      const asset = this.getById(id);

      if (asset?.filePath) {
        filePathToDelete = asset.filePath;
      }

      db.run("UPDATE assets SET sync_status = 'deleted', updated_at = ? WHERE id = ?", [now, id]);

      // Create tombstone
      const tombstoneId = this.generateId();
      db.run(
        `INSERT INTO deleted_items (id, entity_type, original_id, deleted_at, version, synced)
         VALUES (?, 'asset', ?, ?, 1, 0)`,
        [tombstoneId, id, now]
      );
    });

    // Second: Delete file only after DB transaction succeeded
    if (filePathToDelete) {
      const { unlinkSync, existsSync } = require("fs");
      try {
        if (existsSync(filePathToDelete)) {
          unlinkSync(filePathToDelete);
          console.log("[Assets] Deleted file:", filePathToDelete);
        }
      } catch (err) {
        console.error("[Assets] Failed to delete file:", filePathToDelete, err);
        // Don't throw - asset is already deleted from DB
      }
    }
  }

  /**
   * Delete multiple assets.
   * File deletion happens AFTER DB transaction succeeds to prevent data loss.
   */
  deleteMany(ids: string[]): void {
    const now = new Date().toISOString();
    const tombstoneId = this.generateId();
    const filesToDelete: string[] = [];

    // First: Update DB in transaction and collect file paths
    transaction((db) => {
      for (const id of ids) {
        // Get file path before deleting from DB (using sql.js API)
        const result = db.exec("SELECT file_path FROM assets WHERE id = ?", [id]);
        const filePath = result.length > 0 && result[0].values.length > 0
          ? result[0].values[0][0] as string
          : undefined;

        if (filePath) {
          filesToDelete.push(filePath);
        }

        db.run("UPDATE assets SET sync_status = 'deleted', updated_at = ? WHERE id = ?", [now, id]);
        db.run(
          `INSERT INTO deleted_items (id, entity_type, original_id, deleted_at, version, synced)
           VALUES (?, 'asset', ?, ?, 1, 0)`,
          [`${tombstoneId}-${id}`, id, now]
        );
      }
    });

    // Second: Delete files only after DB transaction succeeded
    const { unlinkSync, existsSync } = require("fs");
    for (const filePath of filesToDelete) {
      try {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          console.log("[Assets] Deleted file:", filePath);
        }
      } catch (err) {
        console.error("[Assets] Failed to delete file:", filePath, err);
        // Don't throw - assets are already deleted from DB
      }
    }
  }

  /**
   * Get asset by ID.
   */
  getById(id: string): AssetMetadata | null {
    const db = getDatabase();
    const result = db.exec(
      "SELECT * FROM assets WHERE id = ? AND sync_status != 'deleted'",
      [id]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    return rowToMetadata(result[0].values[0]);
  }

  /**
   * Check if asset exists by ID (including deleted).
   * Returns sync_status if found, null otherwise.
   */
  getSyncStatus(id: string): string | null {
    const db = getDatabase();
    const result = db.exec(
      "SELECT sync_status FROM assets WHERE id = ?",
      [id]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    return result[0].values[0][0] as string;
  }

  /**
   * Get filtered assets with cursor-based pagination.
   */
  getFiltered(filter: AssetFilter): PaginatedResult<AssetMetadata> {
    const db = getDatabase();
    const limit = filter.limit || 50;

    // Build WHERE conditions
    const conditions: string[] = ["sync_status != 'deleted'"];
    const params: unknown[] = [];

    if (filter.types?.length) {
      conditions.push(`type IN (${filter.types.map(() => "?").join(",")})`);
      params.push(...filter.types);
    }
    if (filter.models?.length) {
      conditions.push(`model_id IN (${filter.models.map(() => "?").join(",")})`);
      params.push(...filter.models);
    }
    if (filter.sources?.length) {
      conditions.push(`source IN (${filter.sources.map(() => "?").join(",")})`);
      params.push(...filter.sources);
    }
    if (filter.favoritesOnly) {
      conditions.push("favorite = 1");
    }
    if (filter.folderId === "__none__") {
      conditions.push("folder_id IS NULL");
    } else if (filter.folderId) {
      conditions.push("folder_id = ?");
      params.push(filter.folderId);
    }
    if (filter.search) {
      conditions.push("(file_name LIKE ? OR model_id LIKE ?)");
      const term = `%${filter.search}%`;
      params.push(term, term);
    }

    // Cursor-based pagination
    if (filter.cursor) {
      const { createdAt, id } = decodeCursor(filter.cursor);
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      params.push(createdAt, createdAt, id);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    // Get total count (without cursor/limit)
    const countConditions = conditions.filter((c) => !c.includes("created_at < ?"));
    const countParams = params.slice(0, params.length - (filter.cursor ? 3 : 0));
    const countWhere = `WHERE ${countConditions.join(" AND ")}`;
    const countResult = db.exec(`SELECT COUNT(*) as count FROM assets ${countWhere}`, countParams);
    const totalCount = (countResult[0]?.values?.[0]?.[0] as number) ?? 0;

    // Fetch items (limit + 1 to check if there's a next page)
    params.push(limit + 1);
    const rowsResult = db.exec(
      `SELECT * FROM assets ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
      params
    );

    const rows = rowsResult[0]?.values ?? [];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => rowToMetadata(row));

    // Build next cursor
    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor(lastItem.createdAt, lastItem.id);
    }

    return { items, nextCursor, totalCount };
  }

  /**
   * Get all unique tags across all assets.
   */
  getAllTags(): string[] {
    const db = getDatabase();
    const result = db.exec(
      "SELECT DISTINCT tags FROM assets WHERE sync_status != 'deleted' AND tags != '[]'"
    );

    const tagSet = new Set<string>();
    for (const row of result) {
      for (const tagsJson of row.values as unknown[][]) {
        const tags: string[] = JSON.parse((tagsJson[0] as string) || "[]");
        for (const tag of tags) {
          tagSet.add(tag);
        }
      }
    }
    return [...tagSet].sort();
  }

  /**
   * Get all unique models.
   */
  getAllModels(): string[] {
    const db = getDatabase();
    const result = db.exec(
      "SELECT DISTINCT model_id FROM assets WHERE sync_status != 'deleted' ORDER BY model_id"
    );
    if (result.length === 0) return [];
    return result[0].values.map((row) => row[0] as string);
  }

  /**
   * Check if asset exists for prediction.
   */
  hasAssetForPrediction(predictionId: string): boolean {
    const db = getDatabase();
    const result = db.exec(
      "SELECT 1 FROM assets WHERE prediction_id = ? AND sync_status != 'deleted' LIMIT 1",
      [predictionId]
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  /**
   * Check if asset exists for execution.
   */
  hasAssetForExecution(executionId: string): boolean {
    const db = getDatabase();
    const result = db.exec(
      "SELECT 1 FROM assets WHERE execution_id = ? AND sync_status != 'deleted' LIMIT 1",
      [executionId]
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  /**
   * Get assets by execution ID.
   */
  getByExecutionId(executionId: string): AssetMetadata[] {
    const db = getDatabase();
    const result = db.exec(
      "SELECT * FROM assets WHERE execution_id = ? AND sync_status != 'deleted'",
      [executionId]
    );
    if (result.length === 0) return [];
    return result[0].values.map((row) => rowToMetadata(row));
  }

  /**
   * Get pending items for sync.
   */
  getPending(): AssetRow[] {
    const db = getDatabase();
    const result = db.exec("SELECT * FROM assets WHERE sync_status = 'pending'");
    if (result.length === 0) return [];
    return result[0].values.map((row) => this.rowToAssetRow(row));
  }

  /**
   * Mark assets as synced.
   */
  markAsSynced(ids: string[]): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    for (const id of ids) {
      db.run("UPDATE assets SET sync_status = 'synced', synced_at = ? WHERE id = ?", [now, id]);
    }
    persistDatabase();
  }

  /**
   * Mark asset as pending (for sync).
   */
  markPending(id: string): void {
    const db = getDatabase();
    db.run("UPDATE assets SET sync_status = 'pending', version = version + 1 WHERE id = ?", [id]);
    persistDatabase();
  }

  /**
   * Update asset from sync (remote data).
   */
  upsertFromSync(asset: AssetRow): void {
    const db = getDatabase();
    const result = db.exec("SELECT id, version FROM assets WHERE id = ?", [asset.id]);

    if (result.length > 0 && result[0].values.length > 0) {
      const existing = result[0].values[0] as unknown[];
      const existingVersion = existing[1] as number;

      // Only update if remote version is newer
      if (asset.version > existingVersion) {
        db.run(
          `UPDATE assets SET
            file_path = ?, file_name = ?, type = ?, model_id = ?, created_at = ?, updated_at = ?,
            file_size = ?, favorite = ?, prediction_id = ?, result_index = ?, original_url = ?,
            source = ?, workflow_id = ?, workflow_name = ?, node_id = ?, execution_id = ?,
            folder_id = ?, tags = ?, cloud_r2_key = ?, thumbnail_r2_key = ?,
            device_id = ?, version = ?, sync_status = 'synced', synced_at = ?
           WHERE id = ?`,
          [
            asset.file_path,
            asset.file_name,
            asset.type,
            asset.model_id,
            asset.created_at,
            asset.updated_at,
            asset.file_size,
            asset.favorite,
            asset.prediction_id,
            asset.result_index,
            asset.original_url,
            asset.source,
            asset.workflow_id,
            asset.workflow_name,
            asset.node_id,
            asset.execution_id,
            asset.folder_id,
            asset.tags,
            asset.cloud_r2_key,
            asset.thumbnail_r2_key,
            asset.device_id,
            asset.version,
            asset.synced_at,
            asset.id,
          ]
        );
        persistDatabase();
      }
    } else {
      // Insert new
      db.run(
        `INSERT INTO assets (
          id, file_path, file_name, type, model_id, created_at, updated_at,
          file_size, favorite, prediction_id, result_index, original_url,
          source, workflow_id, workflow_name, node_id, execution_id,
          folder_id, tags, cloud_r2_key, thumbnail_r2_key,
          device_id, version, sync_status, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)`,
        [
          asset.id,
          asset.file_path,
          asset.file_name,
          asset.type,
          asset.model_id,
          asset.created_at,
          asset.updated_at,
          asset.file_size,
          asset.favorite,
          asset.prediction_id,
          asset.result_index,
          asset.original_url,
          asset.source,
          asset.workflow_id,
          asset.workflow_name,
          asset.node_id,
          asset.execution_id,
          asset.folder_id,
          asset.tags,
          asset.cloud_r2_key,
          asset.thumbnail_r2_key,
          asset.device_id,
          asset.version,
          asset.synced_at,
        ]
      );
      persistDatabase();
    }
  }

  private rowToAssetRow(row: unknown[]): AssetRow {
    return {
      id: row[0] as string,
      file_path: row[1] as string,
      file_name: row[2] as string,
      type: row[3] as AssetRow["type"],
      model_id: row[4] as string,
      created_at: row[5] as string,
      updated_at: row[6] as string,
      file_size: row[7] as number,
      favorite: row[8] as AssetRow["favorite"],
      prediction_id: row[9] as string | null,
      result_index: row[10] as number,
      original_url: row[11] as string | null,
      source: row[12] as AssetRow["source"],
      workflow_id: row[13] as string | null,
      workflow_name: row[14] as string | null,
      node_id: row[15] as string | null,
      execution_id: row[16] as string | null,
      folder_id: row[17] as string | null,
      tags: row[18] as string,
      cloud_r2_key: row[19] as string | null,
      thumbnail_r2_key: row[20] as string | null,
      device_id: row[21] as string | null,
      version: row[22] as number,
      sync_status: row[23] as AssetRow["sync_status"],
      synced_at: row[24] as string | null,
    };
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
}

export const assetsRepo = new AssetsRepository();
