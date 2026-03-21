/**
 * Assets IPC handlers - dedicated IPC module following electron/workflow/ipc/ pattern.
 */

import { ipcMain } from "electron";
import { existsSync } from "fs";
import { assetsRepo, type AssetFilter } from "./db/assets.repo";
import { foldersRepo } from "./db/folders.repo";
import { tagsRepo } from "./db/tags.repo";
import { syncRepo } from "./db/sync.repo";
import { getDatabase, persistDatabase } from "./db/connection";
import type { AssetMetadata, AssetFolder, TagCategory, TagColor } from "@/types/asset";
import type { SyncManager, SyncConfig, SyncResult } from "./sync";
import { getSyncTriggerManager } from "./sync/sync-triggers";
import { getCacheManager, type CacheStats } from "./cache-manager";
import { getAssetSyncQueue, type SyncQueueStats } from "./asset-sync-queue";
import type { R2Client } from "./sync/r2-client";

// Sync status constants
const SYNC_STATUS_DELETED = "deleted";
const SYNC_STATUS_SYNCED = "synced";
const SYNC_STATUS_PENDING = "pending";

// Trigger auto-sync after data changes
function triggerAutoSync(): void {
  try {
    getSyncTriggerManager().onDirtyState();
  } catch (error) {
    console.error("[Assets] Failed to trigger auto-sync:", error);
  }
}

// Sync manager singleton
let syncManagerInstance: SyncManager | null = null;

// R2 client singleton for asset upload/download
let r2ClientInstance: R2Client | null = null;

// Helper to check if database is available
function isDatabaseAvailable(): boolean {
  try {
    getDatabase();
    return true;
  } catch {
    return false;
  }
}

/**
 * Set R2 client for asset upload/download.
 */
export function setR2Client(client: R2Client | null): void {
  r2ClientInstance = client;
  // Also update sync queue
  getAssetSyncQueue().setR2Client(client);
  // Also update sync trigger manager for auto-upload
  getSyncTriggerManager().setR2Client(client);
}

/**
 * Get R2 client instance.
 */
export function getR2Client(): R2Client | null {
  return r2ClientInstance;
}

export function registerAssetsIpcHandlers(): void {
  // === Assets ===
  ipcMain.handle("assets:get-filtered", (_, filter: AssetFilter) => {
    if (!isDatabaseAvailable()) {
      return { items: [], nextCursor: null, totalCount: 0 };
    }
    return assetsRepo.getFiltered(filter);
  });

  ipcMain.handle("assets:get-by-id", (_, id: string) => {
    if (!isDatabaseAvailable()) {
      return null;
    }
    return assetsRepo.getById(id);
  });

  ipcMain.handle("assets:get-by-execution", (_, executionId: string) => {
    if (!isDatabaseAvailable()) {
      return [];
    }
    return assetsRepo.getByExecutionId(executionId);
  });

  /**
   * Insert asset and optionally upload to R2.
   * Uploads in background after DB insert.
   */
  ipcMain.handle("assets:insert", async (_, asset: Omit<AssetMetadata, "tags"> & { tags: string[] }) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }

    const id = assetsRepo.insert(asset);
    triggerAutoSync();

    // Upload to R2 in background if configured
    if (r2ClientInstance && r2ClientInstance.isConfigured()) {
      // Async upload - don't wait
      (async () => {
        try {
          const result = await r2ClientInstance!.uploadFile(
            id,
            asset.filePath,
            asset.type
          );

          if (result.success && result.key) {
            // Update DB with cloud_r2_key
            const db = getDatabase();
            db.run("UPDATE assets SET cloud_r2_key = ? WHERE id = ?", [result.key, id]);
            persistDatabase();
            console.log(`[Assets] Uploaded to R2: ${id} -> ${result.key}`);
          } else {
            console.error(`[Assets] R2 upload failed for ${id}:`, result.error);
          }
        } catch (error) {
          console.error(`[Assets] R2 upload error for ${id}:`, error);
        }
      })();
    }

    return id;
  });

  ipcMain.handle(
    "assets:update",
    (_, id: string, updates: Partial<Pick<AssetMetadata, "tags" | "favorite" | "folderId">>) => {
      if (!isDatabaseAvailable()) {
        throw new Error("Database not available");
      }
      assetsRepo.update(id, updates);
      triggerAutoSync();
    }
  );

  ipcMain.handle("assets:delete", (_, id: string) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    assetsRepo.delete(id);
    triggerAutoSync();
  });

  ipcMain.handle("assets:delete-many", (_, ids: string[]) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    assetsRepo.deleteMany(ids);
    triggerAutoSync();
    return ids.length;
  });

  ipcMain.handle("assets:get-all-tags", () => {
    if (!isDatabaseAvailable()) {
      return [];
    }
    return assetsRepo.getAllTags();
  });

  ipcMain.handle("assets:get-all-models", () => {
    if (!isDatabaseAvailable()) {
      return [];
    }
    return assetsRepo.getAllModels();
  });

  ipcMain.handle("assets:has-for-prediction", (_, predictionId: string) => {
    if (!isDatabaseAvailable()) {
      return false;
    }
    return assetsRepo.hasAssetForPrediction(predictionId);
  });

  ipcMain.handle("assets:has-for-execution", (_, executionId: string) => {
    if (!isDatabaseAvailable()) {
      return false;
    }
    return assetsRepo.hasAssetForExecution(executionId);
  });

  ipcMain.handle("assets:mark-pending", (_, id: string) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    assetsRepo.markPending(id);
  });

  // === Folders ===
  ipcMain.handle("folders:get-all", () => {
    if (!isDatabaseAvailable()) {
      return [];
    }
    return foldersRepo.getAll();
  });

  ipcMain.handle("folders:get-by-id", (_, id: string) => {
    if (!isDatabaseAvailable()) {
      return null;
    }
    return foldersRepo.getById(id);
  });

  ipcMain.handle(
    "folders:create",
    (_, folder: Omit<AssetFolder, "id" | "createdAt">) => {
      if (!isDatabaseAvailable()) {
        throw new Error("Database not available");
      }
      const id = foldersRepo.create(folder);
      triggerAutoSync();
      return id;
    }
  );

  ipcMain.handle(
    "folders:update",
    (_, id: string, updates: Partial<Pick<AssetFolder, "name" | "color" | "icon">>) => {
      if (!isDatabaseAvailable()) {
        throw new Error("Database not available");
      }
      foldersRepo.update(id, updates);
      triggerAutoSync();
    }
  );

  ipcMain.handle("folders:delete", (_, id: string, moveAssetsTo?: string | null) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    foldersRepo.delete(id, moveAssetsTo);
    triggerAutoSync();
  });

  ipcMain.handle("folders:get-asset-count", (_, folderId: string) => {
    if (!isDatabaseAvailable()) {
      return 0;
    }
    return foldersRepo.getAssetCount(folderId);
  });

  // === Tag Categories ===
  ipcMain.handle("tag-categories:get-all", () => {
    if (!isDatabaseAvailable()) {
      return [];
    }
    return tagsRepo.getAllCategories();
  });

  ipcMain.handle("tag-categories:get-by-id", (_, id: string) => {
    if (!isDatabaseAvailable()) {
      return null;
    }
    return tagsRepo.getCategoryById(id);
  });

  ipcMain.handle("tag-categories:create", (_, name: string, color: TagColor, tags: string[]) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    const id = tagsRepo.createCategory(name, color, tags);
    triggerAutoSync();
    return id;
  });

  ipcMain.handle(
    "tag-categories:update",
    (_, id: string, updates: Partial<Pick<TagCategory, "name" | "color" | "tags">>) => {
      if (!isDatabaseAvailable()) {
        throw new Error("Database not available");
      }
      tagsRepo.updateCategory(id, updates);
      triggerAutoSync();
    }
  );

  ipcMain.handle("tag-categories:delete", (_, id: string) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    tagsRepo.deleteCategory(id);
    triggerAutoSync();
  });

  // === Sync State ===
  ipcMain.handle("sync:get-pending", () => {
    if (!isDatabaseAvailable()) {
      return { assets: [], folders: [], categories: [] };
    }
    return syncRepo.getPendingItems();
  });

  ipcMain.handle("sync:get-state", (_, key: string) => {
    if (!isDatabaseAvailable()) {
      return null;
    }
    return syncRepo.getState(key);
  });

  ipcMain.handle("sync:get-full-state", () => {
    if (!isDatabaseAvailable()) {
      return { lastSyncAt: null, deviceId: null, remoteVersion: null, syncEnabled: false };
    }
    return syncRepo.getFullState();
  });

  ipcMain.handle("sync:set-state", (_, key: string, value: string) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    syncRepo.setState(key, value);
  });

  ipcMain.handle("sync:get-deleted", () => {
    if (!isDatabaseAvailable()) {
      return [];
    }
    return syncRepo.getDeletedItems();
  });

  ipcMain.handle("sync:update-last-sync", () => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    syncRepo.updateLastSync();
  });

  ipcMain.handle("sync:is-enabled", () => {
    if (!isDatabaseAvailable()) {
      return false;
    }
    return syncRepo.isSyncEnabled();
  });

  ipcMain.handle("sync:set-enabled", (_, enabled: boolean) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    syncRepo.setSyncEnabled(enabled);
  });

  ipcMain.handle("sync:get-recent-log", (_, limit?: number) => {
    if (!isDatabaseAvailable()) {
      return [];
    }
    return syncRepo.getRecentLog(limit);
  });

  ipcMain.handle("sync:log-event", (_, entry: Parameters<typeof syncRepo.logEvent>[0]) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    syncRepo.logEvent(entry);
  });

  // === Import from backup ===
  ipcMain.handle("assets:import-folders-backup", async (_, backupPath: string) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    const { readFileSync } = await import("fs");
    const data = JSON.parse(readFileSync(backupPath, "utf-8"));
    const folders = data.folders || [];

    const { transaction } = await import("./db/connection");
    return transaction((db) => {
      let imported = 0;
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
      return { imported, total: folders.length };
    });
  });

  // === Cloud Sync ===

  ipcMain.handle("sync:get-status", () => {
    if (!syncManagerInstance) {
      return { enabled: false, lastSync: null, pending: 0, isSyncing: false };
    }
    return syncManagerInstance.getSyncStatus();
  });

  ipcMain.handle("sync:start", async () => {
    if (!syncManagerInstance) {
      throw new Error("Sync not configured. Please set up your sync credentials in Settings.");
    }

    const result = await syncManagerInstance.sync();
    return result;
  });

  ipcMain.handle("sync:configure", async (_, config: SyncConfig) => {
    const { SyncManager } = await import("./sync");
    const { R2Client } = await import("./sync/r2-client");

    if (!config.accountId || !config.databaseId || !config.apiToken) {
      throw new Error("Missing required sync configuration (accountId, databaseId, apiToken)");
    }

    // Generate deviceId if not provided
    if (!config.deviceId) {
      const { randomUUID } = await import("crypto");
      config.deviceId = randomUUID();
    }

    // Create or update sync manager
    if (!syncManagerInstance) {
      syncManagerInstance = new SyncManager(config);
    } else {
      syncManagerInstance.updateConfig(config);
    }

    // Update trigger manager
    const triggerManager = getSyncTriggerManager();
    triggerManager.setSyncManager(syncManagerInstance);

    // Initialize R2 client if credentials provided
    if (config.bucket && config.accessKeyId && config.secretAccessKey) {
      r2ClientInstance = new R2Client({
        accountId: config.accountId,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        bucket: config.bucket,
        userId: config.userId,
        publicUrl: config.publicUrl,
      });
      // Update sync queue with R2 client
      getAssetSyncQueue().setR2Client(r2ClientInstance);
      console.log("[Assets] R2 client initialized for hybrid storage");
    } else {
      r2ClientInstance = null;
      getAssetSyncQueue().setR2Client(null);
    }

    // Store config in sync state
    if (isDatabaseAvailable()) {
      syncRepo.setState("accountId", config.accountId);
      syncRepo.setState("databaseId", config.databaseId);
      syncRepo.setState("deviceId", config.deviceId);
      syncRepo.setSyncEnabled(true);
    }

    return { success: true, deviceId: config.deviceId };
  });

  ipcMain.handle("sync:disconnect", async () => {
    syncManagerInstance = null;
    if (isDatabaseAvailable()) {
      syncRepo.setSyncEnabled(false);
    }
    return { success: true };
  });

  ipcMain.handle("sync:test-connection", async (_, config: Partial<SyncConfig>) => {
    if (!config.accountId || !config.databaseId || !config.apiToken) {
      return { success: false, error: "Missing required credentials" };
    }

    try {
      const { D1Client } = await import("./sync");
      const client = new D1Client({
        accountId: config.accountId,
        databaseId: config.databaseId,
        apiToken: config.apiToken,
      });

      const connected = await client.ping();
      return { success: connected, error: connected ? undefined : "Failed to connect to D1" };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("sync:get-config", async () => {
    if (!isDatabaseAvailable()) {
      return { accountId: null, databaseId: null, deviceId: null };
    }

    return {
      accountId: syncRepo.getState("accountId"),
      databaseId: syncRepo.getState("databaseId"),
      deviceId: syncRepo.getState("deviceId"),
    };
  });

  ipcMain.handle("sync:init-schema", async () => {
    if (!syncManagerInstance) {
      throw new Error("Sync not configured. Please set up your sync credentials first.");
    }

    return await syncManagerInstance.initializeRemoteSchema();
  });

  ipcMain.handle("sync:triggers-update", async (_, config: { timerEnabled?: boolean; intervalMinutes?: number }) => {
    const triggerManager = getSyncTriggerManager();
    triggerManager.updateConfig(config);
    return triggerManager.getConfig();
  });

  ipcMain.handle("sync:triggers-get", () => {
    const triggerManager = getSyncTriggerManager();
    return triggerManager.getConfig();
  });

  // === R2 Storage Configuration ===

  /**
   * Get R2 configuration from database.
   */
  ipcMain.handle("r2:get-config", async () => {
    if (!isDatabaseAvailable()) {
      return { accountId: null, bucket: null, accessKeyId: null, secretAccessKey: null, publicUrl: null };
    }
    return syncRepo.getR2Config();
  });

  /**
   * Set R2 configuration in database.
   */
  ipcMain.handle("r2:set-config", async (_, config: {
    accountId?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicUrl?: string;
  }) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    syncRepo.setR2Config(config);
    return { success: true };
  });

  /**
   * Clear R2 configuration from database.
   */
  ipcMain.handle("r2:clear-config", async () => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }
    syncRepo.clearR2Config();
    return { success: true };
  });

  // === Hybrid Asset Storage: Lazy Loading ===

  /**
   * Get file path with lazy loading from R2 if missing locally.
   * Returns the local file path, downloading from R2 if needed.
   */
  ipcMain.handle("assets:get-file", async (_, id: string) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }

    const asset = assetsRepo.getById(id);
    if (!asset) {
      throw new Error("Asset not found");
    }

    const cacheManager = getCacheManager();

    // Check if file exists locally
    if (existsSync(asset.filePath)) {
      cacheManager.updateAccessTime(id);
      return { success: true, filePath: asset.filePath, locallyAvailable: true };
    }

    // File missing - try to download from R2
    const db = getDatabase();
    const result = db.exec("SELECT cloud_r2_key FROM assets WHERE id = ?", [id]);

    if (result.length === 0 || result[0].values.length === 0) {
      return { success: false, error: "File not available locally or in cloud" };
    }

    const cloudR2Key = result[0].values[0][0] as string | null;

    if (!cloudR2Key || !r2ClientInstance) {
      return { success: false, error: "No cloud backup available" };
    }

    // Ensure space before downloading
    const fileSize = await fetchRemoteFileSize(cloudR2Key);
    if (!cacheManager.ensureSpace(fileSize)) {
      return { success: false, error: "Insufficient disk space" };
    }

    // Download from R2
    const downloadResult = await r2ClientInstance.downloadFile(cloudR2Key, asset.filePath);

    if (downloadResult.success) {
      cacheManager.updateAccessTime(id);
      return { success: true, filePath: asset.filePath, locallyAvailable: true };
    }

    return { success: false, error: downloadResult.error };
  });

  /**
   * Explicitly download an asset to local cache.
   */
  ipcMain.handle("assets:download-to-cache", async (_, id: string) => {
    if (!isDatabaseAvailable()) {
      throw new Error("Database not available");
    }

    const asset = assetsRepo.getById(id);
    if (!asset) {
      throw new Error("Asset not found");
    }

    // Check if already exists
    if (existsSync(asset.filePath)) {
      return { success: true, filePath: asset.filePath, alreadyCached: true };
    }

    const db = getDatabase();
    const result = db.exec("SELECT cloud_r2_key FROM assets WHERE id = ?", [id]);

    if (result.length === 0 || result[0].values.length === 0) {
      return { success: false, error: "Asset has no cloud backup" };
    }

    const cloudR2Key = result[0].values[0][0] as string | null;

    if (!cloudR2Key || !r2ClientInstance) {
      return { success: false, error: "R2 not configured" };
    }

    const downloadResult = await r2ClientInstance.downloadFile(cloudR2Key, asset.filePath);

    if (downloadResult.success) {
      return { success: true, filePath: asset.filePath, alreadyCached: false };
    }

    return { success: false, error: downloadResult.error };
  });

  // === Hybrid Asset Storage: Cache Management ===

  /**
   * Get cache statistics.
   */
  ipcMain.handle("assets:get-cache-stats", async (): Promise<CacheStats> => {
    const cacheManager = getCacheManager();
    return cacheManager.getCacheStats();
  });

  /**
   * Clear local cache (delete all files, keep metadata).
   */
  ipcMain.handle("assets:clear-cache", async () => {
    const cacheManager = getCacheManager();
    const result = cacheManager.clearCache();
    return { success: true, ...result };
  });

  /**
   * Set cache size limit.
   */
  ipcMain.handle("assets:set-cache-limit", async (_, maxBytes: number) => {
    const cacheManager = getCacheManager();
    cacheManager.setMaxSizeBytes(maxBytes);
    return { success: true };
  });

  // === Hybrid Asset Storage: Sync Queue ===

  /**
   * Get sync queue statistics.
   */
  ipcMain.handle("assets:sync-queue-stats", async (): Promise<SyncQueueStats> => {
    const queue = getAssetSyncQueue();
    return queue.getStats();
  });

  /**
   * Queue missing assets for background download.
   */
  ipcMain.handle("assets:sync-queue-missing", async (_, maxItems?: number) => {
    const queue = getAssetSyncQueue();
    const queued = queue.queueMissingAssets(maxItems);
    return { success: true, queued };
  });

  /**
   * Start processing the sync queue.
   */
  ipcMain.handle("assets:sync-queue-start", async () => {
    const queue = getAssetSyncQueue();
    // Run in background
    queue.processAll().catch(err => console.error("[Assets] Sync queue error:", err));
    return { success: true };
  });

  /**
   * Cancel sync queue processing.
   */
  ipcMain.handle("assets:sync-queue-cancel", async () => {
    const queue = getAssetSyncQueue();
    queue.cancel();
    return { success: true };
  });

  /**
   * Clear the sync queue.
   */
  ipcMain.handle("assets:sync-queue-clear", async () => {
    const queue = getAssetSyncQueue();
    queue.clear();
    return { success: true };
  });

  /**
   * Reset failed items in the queue.
   */
  ipcMain.handle("assets:sync-queue-retry", async () => {
    const queue = getAssetSyncQueue();
    queue.resetFailed();
    return { success: true };
  });

  /**
   * Upload all local assets to R2 cloud storage.
   * Useful for initial backup or re-uploading after R2 config change.
   */
  ipcMain.handle("r2:upload-all-assets", async (event) => {
    console.log("[R2] ========== Upload all assets requested ==========");
    if (!isDatabaseAvailable()) {
      console.error("[R2] Database not available");
      throw new Error("Database not available");
    }
    console.log("[R2] Database available");

    // Initialize R2 client from database config if not already initialized
    if (!r2ClientInstance) {
      console.log("[R2] R2 client instance is null, initializing...");
      let r2Config = syncRepo.getR2Config();
      console.log("[R2] r2Config from DB:", {
        accountId: r2Config.accountId,
        bucket: r2Config.bucket,
        hasAccessKeyId: !!r2Config.accessKeyId,
        hasSecretAccessKey: !!r2Config.secretAccessKey,
        publicUrl: r2Config.publicUrl,
      });

      // Fall back to sync_state for accountId if not in r2_config
      if (!r2Config.accountId) {
        const accountId = syncRepo.getState("accountId");
        console.log("[R2] accountId from sync_state:", accountId);
        if (accountId) {
          console.log("[R2] Using accountId from sync_state");
          r2Config = { ...r2Config, accountId };
        }
      }

      console.log("[R2] Final r2Config:", {
        accountId: r2Config.accountId,
        bucket: r2Config.bucket,
        hasAccessKeyId: !!r2Config.accessKeyId,
        hasSecretAccessKey: !!r2Config.secretAccessKey,
      });

      if (!r2Config.accountId || !r2Config.bucket || !r2Config.accessKeyId || !r2Config.secretAccessKey) {
        console.error("[R2] R2 config incomplete:", {
          hasAccountId: !!r2Config.accountId,
          hasBucket: !!r2Config.bucket,
          hasAccessKeyId: !!r2Config.accessKeyId,
          hasSecretAccessKey: !!r2Config.secretAccessKey,
        });
        throw new Error("R2 not configured. Please set up R2 credentials in Settings.");
      }

      console.log("[R2] Creating R2Client...");
      const { R2Client } = await import("./sync/r2-client");
      r2ClientInstance = new R2Client({
        accountId: r2Config.accountId,
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: r2Config.secretAccessKey,
        bucket: r2Config.bucket,
        publicUrl: r2Config.publicUrl ?? undefined,
      });
      // Update sync queue with R2 client
      getAssetSyncQueue().setR2Client(r2ClientInstance);
      console.log("[R2] R2 client initialized");
    }

    console.log("[R2] Checking if R2 client is configured...");
    const configured = r2ClientInstance.isConfigured();
    console.log("[R2] isConfigured():", configured);

    if (!configured) {
      console.error("[R2] R2 client not configured");
      throw new Error("R2 not configured. Please set up R2 credentials in Settings.");
    }
    console.log("[R2] R2 client is configured");

    // Get all assets - direct query to avoid pagination issues
    const db = getDatabase();
    const rowsResult = db.exec("SELECT * FROM assets WHERE sync_status != ?", [SYNC_STATUS_DELETED]);
    const rows = rowsResult[0]?.values ?? [];
    const { rowToMetadata } = await import("./db/assets.repo");
    const assets = rows.map((row) => rowToMetadata(row));
    console.log(`[R2] Found ${assets.length} assets to upload`);
    const stats = {
      total: assets.length,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    let processedCount = 0;
    for (const asset of assets) {
      // Send progress update
      const progress = {
        total: assets.length,
        uploaded: stats.uploaded,
        skipped: stats.skipped,
        failed: stats.failed,
        processed: processedCount,
        current: asset.fileName,
      };
      event.sender.send("r2:upload-progress", progress);

      // Skip if already uploaded (has cloud_r2_key)
      const db = getDatabase();
      const r2KeyResult = db.exec("SELECT cloud_r2_key FROM assets WHERE id = ?", [asset.id]);
      const hasR2Key = r2KeyResult.length > 0 &&
                       r2KeyResult[0].values.length > 0 &&
                       r2KeyResult[0].values[0][0] !== null;

      if (hasR2Key) {
        stats.skipped++;
        processedCount++;
        continue;
      }

      // Skip if file doesn't exist locally
      const { existsSync } = await import("fs");
      if (!existsSync(asset.filePath)) {
        stats.failed++;
        stats.errors.push(`${asset.fileName}: file not found`);
        processedCount++;
        continue;
      }

      try {
        const uploadResult = await r2ClientInstance.uploadFile(
          asset.id,
          asset.filePath,
          asset.type,
          (uploadProgress) => {
            // Send file-level progress
            event.sender.send("r2:upload-progress", {
              ...progress,
              fileProgress: uploadProgress,
            });
          }
        );

        if (uploadResult.success && uploadResult.key) {
          // Update DB with cloud_r2_key
          db.run("UPDATE assets SET cloud_r2_key = ? WHERE id = ?", [uploadResult.key, asset.id]);
          stats.uploaded++;
          console.log(`[R2] Uploaded: ${asset.fileName}`);
        } else {
          stats.failed++;
          stats.errors.push(`${asset.fileName}: ${uploadResult.error}`);
        }
      } catch (error) {
        stats.failed++;
        stats.errors.push(`${asset.fileName}: ${(error as Error).message}`);
      }
      processedCount++;
    }

    persistDatabase();
    return stats;
  });
}

/**
 * Fetch file size from R2 without downloading.
 */
async function fetchRemoteFileSize(key: string): Promise<number> {
  if (!r2ClientInstance) return 0;

  try {
    const config = (r2ClientInstance as any).config;
    const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
    const bucket = config.bucket;
    const url = `${endpoint}/${bucket}/${key}`;

    const response = await fetch(url, {
      method: "HEAD",
      headers: (r2ClientInstance as any).generateAuthHeader("HEAD", key, ""),
    });

    if (response.ok) {
      const contentLength = response.headers.get("content-length");
      return contentLength ? parseInt(contentLength, 10) : 0;
    }
  } catch (error) {
    console.error("[Assets] Failed to fetch file size:", error);
  }

  return 0;
}
