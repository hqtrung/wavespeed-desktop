/**
 * Migration from JSON file storage to SQLite database.
 * Migrates assets, folders, and tag categories with backup and rollback support.
 * Uses sql.js for database operations.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { app } from "electron";
import { getDatabase, transaction } from "../db/connection";
import type { AssetMetadata, AssetFolder, TagCategory } from "@/types/asset";

interface MigrationResult {
  success: boolean;
  dryRun: boolean;
  assetsMigrated: number;
  foldersMigrated: number;
  tagCategoriesMigrated: number;
  errors: string[];
  warnings: string[];
}

interface MigrationOptions {
  dryRun?: boolean;
}

export async function migrateJsonToSqlite(
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const { dryRun = false } = options;

  const result: MigrationResult = {
    success: false,
    dryRun,
    assetsMigrated: 0,
    foldersMigrated: 0,
    tagCategoriesMigrated: 0,
    errors: [],
    warnings: [],
  };

  try {
    const userDataPath = app.getPath("userData");
    const backupPath = join(userDataPath, "assets-backup");
    const assetsJsonPath = join(userDataPath, "assets-metadata.json");
    const foldersJsonPath = join(userDataPath, "assets-folders.json");
    const tagCategoriesJsonPath = join(userDataPath, "assets-tag-categories.json");
    const deletedJsonPath = join(userDataPath, "deleted-assets.json");

    // Check if migration needed
    if (!dryRun && !needsMigration()) {
      console.log("[Migration] Already migrated, skipping");
      result.success = true;
      return result;
    }

    // Load JSON data
    let assets: AssetMetadata[] = [];
    let folders: AssetFolder[] = [];
    let tagCategories: TagCategory[] = [];
    let deletedAssets: string[] = [];

    try {
      if (existsSync(assetsJsonPath)) {
        const content = readFileSync(assetsJsonPath, "utf-8").trim();
        if (content) {
          assets = JSON.parse(content);
        }
      }
    } catch (e) {
      result.errors.push(`Failed to parse assets-metadata.json: ${e}`);
    }

    try {
      if (existsSync(foldersJsonPath)) {
        const content = readFileSync(foldersJsonPath, "utf-8").trim();
        if (content) {
          folders = JSON.parse(content);
        }
      }
    } catch (e) {
      result.errors.push(`Failed to parse assets-folders.json: ${e}`);
    }

    try {
      if (existsSync(tagCategoriesJsonPath)) {
        const content = readFileSync(tagCategoriesJsonPath, "utf-8").trim();
        if (content) {
          tagCategories = JSON.parse(content);
        }
      }
    } catch (e) {
      result.errors.push(`Failed to parse assets-tag-categories.json: ${e}`);
    }

    try {
      if (existsSync(deletedJsonPath)) {
        const content = readFileSync(deletedJsonPath, "utf-8").trim();
        if (content) {
          deletedAssets = JSON.parse(content);
        }
      }
    } catch (e) {
      result.errors.push(`Failed to parse deleted-assets.json: ${e}`);
    }

    // Ensure arrays are iterable
    if (!Array.isArray(assets)) assets = [];
    if (!Array.isArray(folders)) folders = [];
    if (!Array.isArray(tagCategories)) tagCategories = [];
    if (!Array.isArray(deletedAssets)) deletedAssets = [];

    if (result.errors.length > 0) {
      return result;
    }

    // Dry-run: validate data only
    if (dryRun) {
      result.foldersMigrated = folders.length;
      result.tagCategoriesMigrated = tagCategories.length;

      const folderIds = new Set(folders.map((f) => f.id));
      for (const asset of assets) {
        const isDeleted = deletedAssets.some(
          (key) => key === `${asset.predictionId}_${asset.resultIndex ?? 0}`
        );
        if (isDeleted) continue;

        if (!asset.id) {
          result.errors.push(`Asset missing ID: ${asset.fileName}`);
          continue;
        }
        if (!asset.filePath) {
          result.warnings.push(`Asset ${asset.id} has no filePath`);
        }
        if (asset.folderId && !folderIds.has(asset.folderId)) {
          result.warnings.push(`Asset ${asset.id} references non-existent folder ${asset.folderId}`);
        }
        result.assetsMigrated++;
      }

      result.success = result.errors.length === 0;
      console.log(
        `[Migration] Dry-run complete: ${result.assetsMigrated} assets, ${result.foldersMigrated} folders, ${result.tagCategoriesMigrated} categories`
      );
      if (result.warnings.length > 0) {
        console.warn("[Migration] Warnings:", result.warnings);
      }
      return result;
    }

    // Create backup directory
    if (!existsSync(backupPath)) {
      mkdirSync(backupPath, { recursive: true });
    }

    // Backup JSON files
    const timestamp = Date.now();
    if (existsSync(assetsJsonPath)) {
      copyFile(assetsJsonPath, join(backupPath, `assets-metadata.${timestamp}.json`));
    }
    if (existsSync(foldersJsonPath)) {
      copyFile(foldersJsonPath, join(backupPath, `assets-folders.${timestamp}.json`));
    }
    if (existsSync(tagCategoriesJsonPath)) {
      copyFile(tagCategoriesJsonPath, join(backupPath, `assets-tag-categories.${timestamp}.json`));
    }
    if (existsSync(deletedJsonPath)) {
      copyFile(deletedJsonPath, join(backupPath, `deleted-assets.${timestamp}.json`));
    }

    // Migrate in atomic transaction
    transaction(() => {
      const db = getDatabase();

      // Migrate folders
      for (const folder of folders) {
        try {
          db.run(
            `INSERT INTO folders (id, name, color, icon, created_at, updated_at, sync_status, version)
             VALUES (?, ?, ?, ?, ?, ?, 'synced', 1)`,
            [
              folder.id,
              folder.name,
              folder.color,
              folder.icon ?? null,
              folder.createdAt,
              folder.createdAt,
            ]
          );
          result.foldersMigrated++;
        } catch (e) {
          result.errors.push(`Failed to migrate folder ${folder.id}: ${e}`);
        }
      }

      // Migrate tag categories
      for (const category of tagCategories) {
        try {
          db.run(
            `INSERT INTO tag_categories (id, name, color, tags, created_at, updated_at, sync_status, version)
             VALUES (?, ?, ?, ?, ?, ?, 'synced', 1)`,
            [
              category.id,
              category.name,
              category.color,
              JSON.stringify(category.tags),
              category.createdAt,
              category.createdAt,
            ]
          );
          result.tagCategoriesMigrated++;
        } catch (e) {
          result.errors.push(`Failed to migrate tag category ${category.id}: ${e}`);
        }
      }

      // Migrate assets
      for (const asset of assets) {
        try {
          const isDeleted = deletedAssets.some(
            (key) => key === `${asset.predictionId}_${asset.resultIndex ?? 0}`
          );
          if (isDeleted) {
            // Create tombstone for deleted assets
            db.run(
              `INSERT INTO deleted_items (id, entity_type, original_id, deleted_at, version, synced)
               VALUES (?, 'asset', ?, ?, 1, 0)`,
              [asset.id, asset.id, new Date().toISOString()]
            );
            continue;
          }

          db.run(
            `INSERT INTO assets (
              id, file_path, file_name, type, model_id, created_at, updated_at,
              file_size, favorite, prediction_id, result_index, original_url,
              source, workflow_id, workflow_name, node_id, execution_id,
              folder_id, tags, sync_status, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', 1)`,
            [
              asset.id,
              asset.filePath,
              asset.fileName,
              asset.type,
              asset.modelId,
              asset.createdAt,
              asset.createdAt,
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

          result.assetsMigrated++;
        } catch (e) {
          result.errors.push(`Failed to migrate asset ${asset.id}: ${e}`);
        }
      }
    });

    // Validate counts
    const expectedAssets = assets.filter((a) => {
      return !deletedAssets.some(
        (key) => key === `${a.predictionId}_${a.resultIndex ?? 0}`
      );
    }).length;

    if (result.assetsMigrated !== expectedAssets && expectedAssets > 0) {
      result.errors.push(
        `Asset count mismatch: expected ${expectedAssets}, migrated ${result.assetsMigrated}`
      );
    }

    result.success = result.errors.length === 0;

    if (result.success) {
      console.log("[Migration] Success:", result);
    } else {
      console.error("[Migration] Completed with errors:", result.errors);
    }

    return result;
  } catch (error) {
    result.errors.push(`Migration failed: ${error}`);
    console.error("[Migration] Fatal error:", error);
    return result;
  }
}

function needsMigration(): boolean {
  try {
    const db = getDatabase();
    const result = db.exec("SELECT COUNT(*) as count FROM assets");
    const count = (result[0]?.values?.[0]?.[0] as number) ?? 0;
    return count === 0;
  } catch {
    return true;
  }
}

function copyFile(source: string, dest: string): void {
  const data = readFileSync(source);
  writeFileSync(dest, data);
}

export function rollbackMigration(): boolean {
  try {
    const userDataPath = app.getPath("userData");
    const backupPath = join(userDataPath, "assets-backup");

    if (!existsSync(backupPath)) {
      console.error("[Migration] No backup found to rollback");
      return false;
    }

    const files = readdirSync(backupPath);
    const assetBackups = files.filter((f: string) => f.startsWith("assets-metadata."));

    if (assetBackups.length === 0) {
      console.error("[Migration] No asset backups found");
      return false;
    }

    assetBackups.sort().reverse();
    const latestBackup = join(backupPath, assetBackups[0]);
    const destPath = join(userDataPath, "assets-metadata.json");
    copyFile(latestBackup, destPath);

    console.log("[Migration] Rolled back to:", latestBackup);
    return true;
  } catch (error) {
    console.error("[Migration] Rollback failed:", error);
    return false;
  }
}

/**
 * Check if JSON files exist for migration.
 */
export function hasJsonData(): boolean {
  const userDataPath = app.getPath("userData");
  return (
    existsSync(join(userDataPath, "assets-metadata.json")) ||
    existsSync(join(userDataPath, "assets-folders.json")) ||
    existsSync(join(userDataPath, "assets-tag-categories.json"))
  );
}
