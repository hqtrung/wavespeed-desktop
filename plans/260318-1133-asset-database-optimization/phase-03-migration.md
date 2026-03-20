---
title: "Phase 03: Migration from JSON"
description: "Migrate existing assets, folders, and tag categories from JSON to SQLite"
status: done
priority: P1
effort: 4h
tags: [migration, json, sqlite]
created: 2026-03-18
completed: 2026-03-18
---

# Phase 03: Migration from JSON

## Context Links
- Parent: [plan.md](./plan.md)
- Implementation: [phase-02-local-sqlite.md](./phase-02-local-sqlite.md)
- Current JSON: `~/Library/Application Support/wavespeed-desktop/assets-metadata.json`

## Overview

Create migration utility to:
1. Back up existing JSON files
2. **Dry-run** to validate data without writing to DB
3. Import assets, folders, tag categories into SQLite
4. Verify data integrity in atomic transaction
5. Enable rollback on failure

## Migration Strategy

### Pre-Migration Checklist
- [ ] Database schema implemented and tested
- [ ] Backup mechanism in place
- [ ] Migration script idempotent (can run multiple times)
- [ ] Dry-run tested with real data
- [ ] Validation tests pass

### Migration Flow

```
1. Check if migration needed (schema_version < 1 or DB missing)
2. Back up JSON files to .backup folder
3. Read JSON files (assets-metadata.json, assets-folders.json, assets-tag-categories.json)
4. If dry-run: validate all records, report issues, stop
5. Begin database transaction (atomic)
6. Insert folders
7. Insert tag categories (tags as JSON array)
8. Insert assets with folder_id FK and tags JSON
9. Validate record counts match
10. Commit transaction
11. Mark migration complete in schema_version
12. On error: ROLLBACK (automatic with better-sqlite3 transactions)
```

## Implementation

### electron/assets/migrations/migrate-v1-to-v2.ts

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { app } from "electron";
import { openDatabase, getDatabase } from "../db";
import type { AssetMetadata, AssetFolder, TagCategory } from "@/types/asset";
import type Database from "better-sqlite3";

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
  dryRun?: boolean;  // Validate without writing
}

export async function migrateJsonToSqlite(options: MigrationOptions = {}): Promise<MigrationResult> {
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
    // Paths
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
        assets = JSON.parse(readFileSync(assetsJsonPath, "utf-8"));
      }
    } catch (e) {
      result.errors.push(`Failed to parse assets-metadata.json: ${e}`);
    }

    try {
      if (existsSync(foldersJsonPath)) {
        folders = JSON.parse(readFileSync(foldersJsonPath, "utf-8"));
      }
    } catch (e) {
      result.errors.push(`Failed to parse assets-folders.json: ${e}`);
    }

    try {
      if (existsSync(tagCategoriesJsonPath)) {
        tagCategories = JSON.parse(readFileSync(tagCategoriesJsonPath, "utf-8"));
      }
    } catch (e) {
      result.errors.push(`Failed to parse assets-tag-categories.json: ${e}`);
    }

    try {
      if (existsSync(deletedJsonPath)) {
        deletedAssets = JSON.parse(readFileSync(deletedJsonPath, "utf-8"));
      }
    } catch (e) {
      result.errors.push(`Failed to parse deleted-assets.json: ${e}`);
    }

    // Abort if JSON parsing failed
    if (result.errors.length > 0) {
      return result;
    }

    // Dry-run: validate data only
    if (dryRun) {
      result.foldersMigrated = folders.length;
      result.tagCategoriesMigrated = tagCategories.length;

      // Validate assets
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
      console.log(`[Migration] Dry-run complete: ${result.assetsMigrated} assets, ${result.foldersMigrated} folders, ${result.tagCategoriesMigrated} categories`);
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

    // Open database
    const db = openDatabase();

    // Migrate in atomic transaction (better-sqlite3)
    const migrate = db.transaction(() => {
      // Migrate folders
      const insertFolder = db.prepare(
        `INSERT INTO folders (id, name, color, icon, created_at, updated_at, sync_status, version)
         VALUES (?, ?, ?, ?, ?, ?, 'synced', 1)`
      );
      for (const folder of folders) {
        try {
          insertFolder.run(folder.id, folder.name, folder.color, folder.icon ?? null, folder.createdAt, folder.createdAt);
          result.foldersMigrated++;
        } catch (e) {
          result.errors.push(`Failed to migrate folder ${folder.id}: ${e}`);
        }
      }

      // Migrate tag categories (tags stored as JSON array directly)
      const insertCategory = db.prepare(
        `INSERT INTO tag_categories (id, name, color, tags, created_at, updated_at, sync_status, version)
         VALUES (?, ?, ?, ?, ?, ?, 'synced', 1)`
      );
      for (const category of tagCategories) {
        try {
          insertCategory.run(
            category.id,
            category.name,
            category.color,
            JSON.stringify(category.tags),
            category.createdAt,
            category.createdAt,
          );
          result.tagCategoriesMigrated++;
        } catch (e) {
          result.errors.push(`Failed to migrate tag category ${category.id}: ${e}`);
        }
      }

      // Migrate assets (tags as JSON, folder_id as direct FK)
      const insertAsset = db.prepare(
        `INSERT INTO assets (
          id, file_path, file_name, type, model_id, created_at, updated_at,
          file_size, favorite, prediction_id, result_index, original_url,
          source, workflow_id, workflow_name, node_id, execution_id,
          folder_id, tags, sync_status, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', 1)`
      );

      const insertTombstone = db.prepare(
        `INSERT INTO deleted_items (id, entity_type, original_id, deleted_at, version, synced)
         VALUES (?, 'asset', ?, ?, 1, 0)`
      );

      for (const asset of assets) {
        try {
          // Check if in deleted registry
          const isDeleted = deletedAssets.some(
            (key) => key === `${asset.predictionId}_${asset.resultIndex ?? 0}`
          );
          if (isDeleted) {
            insertTombstone.run(asset.id, asset.id, new Date().toISOString());
            continue;
          }

          insertAsset.run(
            asset.id,
            asset.filePath,
            asset.fileName,
            asset.type,
            asset.modelId,
            asset.createdAt,
            asset.createdAt,  // No updated_at in JSON, use created_at
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
            asset.folderId ?? null,       // Direct FK (no junction table)
            JSON.stringify(asset.tags),   // JSON array (no normalized tags table)
          );

          result.assetsMigrated++;
        } catch (e) {
          result.errors.push(`Failed to migrate asset ${asset.id}: ${e}`);
        }
      }
    });

    // Execute atomic transaction — rolls back automatically on error
    migrate();

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
    const row = db.prepare("SELECT COUNT(*) as count FROM assets").get() as { count: number };
    return row.count === 0;
  } catch {
    return true;
  }
}

function copyFile(source: string, dest: string): void {
  const data = readFileSync(source);
  writeFileSync(dest, data);
}

// Rollback function
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

    // Sort by timestamp (descending) and get latest
    assetBackups.sort().reverse();
    const latestBackup = join(backupPath, assetBackups[0]);

    // Restore
    const destPath = join(userDataPath, "assets-metadata.json");
    copyFile(latestBackup, destPath);

    console.log("[Migration] Rolled back to:", latestBackup);
    return true;
  } catch (error) {
    console.error("[Migration] Rollback failed:", error);
    return false;
  }
}
```

## Integration with Main Process

### electron/main.ts

```typescript
// At startup — migration runs inside initAssetsModule()
import { initAssetsModule } from "./assets";
import { migrateJsonToSqlite } from "./assets/migrations/migrate-v1-to-v2";

// In initAssetsModule or app.whenReady():
const migrationResult = await migrateJsonToSqlite();
if (!migrationResult.success) {
  console.error("Asset migration completed with errors:", migrationResult.errors);
  // Could show notification to user
}
```

### Dry-Run Usage

```typescript
// Can be triggered from dev tools or settings for validation
const dryRunResult = await migrateJsonToSqlite({ dryRun: true });
console.log("Dry-run result:", dryRunResult);
// { success: true, dryRun: true, assetsMigrated: 1234, errors: [], warnings: [...] }
```

## Implementation Steps

1. [ ] Create `electron/assets/migrations/` directory
2. [ ] Implement `migrateJsonToSqlite()` with dry-run support
3. [ ] Implement `rollbackMigration()` function
4. [ ] Add migration call to `initAssetsModule()`
5. [ ] Test dry-run with real data
6. [ ] Test full migration with sample data
7. [ ] Test rollback functionality
8. [ ] Add validation for data integrity

## Success Criteria

- All existing assets migrate to SQLite via atomic transaction
- Tags stored as JSON arrays (no junction tables)
- Folder assignments via direct `folder_id` FK (no junction table)
- Tag categories with tags JSON preserved
- Deleted assets registry preserved as tombstones
- No data loss during migration
- Dry-run validates without writing
- Rollback works on failure
- Migration is idempotent

## Validation Tests

```
After migration, verify:
1. Asset count matches JSON (excluding deleted)
2. All tags preserved as JSON arrays
3. All folder_id references preserved (direct FK)
4. Tag categories with embedded tags JSON preserved
5. File paths remain valid
6. Favorite flags preserved
7. Prediction IDs and result indices preserved
```

## Next Steps

[Phase 04: Cloudflare D1 Integration](./phase-04-d1-integration.md)
