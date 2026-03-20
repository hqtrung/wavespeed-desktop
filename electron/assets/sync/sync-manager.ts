/**
 * Sync orchestrator for asset database synchronization.
 * Manages bidirectional sync between local SQLite and Cloudflare D1/R2.
 */

import { D1Client } from "./d1-client";
import { R2Client } from "./r2-client";
import { ConflictResolver, type ConflictResolution } from "./conflict-resolver";
import { parseTags, mergeTags } from "./utils";
import { assetsRepo } from "../db/assets.repo";
import { foldersRepo } from "../db/folders.repo";
import { tagsRepo } from "../db/tags.repo";
import { syncRepo } from "../db/sync.repo";
import { getDatabase, transaction } from "../db/connection";
import { getRemoteSchemaSql } from "../db/schema";
import type { AssetMetadata, AssetFolder, TagCategory } from "@/types/asset";

export interface SyncConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  userId?: string;
  deviceId: string;
  publicUrl?: string; // Public r2.dev URL for fast downloads
}

export interface SyncResult {
  success: boolean;
  uploaded: { assets: number; folders: number; categories: number };
  downloaded: { assets: number; folders: number; categories: number };
  deleted: number;
  conflicts: number;
  errors: string[];
  duration: number;
}

export interface SyncProgressCallback {
  (progress: {
    phase: "uploading" | "downloading" | "conflicts" | "complete";
    message: string;
    current: number;
    total: number;
  }): void;
}

export class SyncManager {
  private d1: D1Client | null = null;
  private r2: R2Client | null = null;
  private resolver: ConflictResolver;
  private isSyncing = false;
  private config: SyncConfig;

  constructor(config: SyncConfig) {
    this.config = config;
    this.resolver = new ConflictResolver(config.deviceId);

    // Initialize clients if credentials provided
    if (config.accountId && config.databaseId && config.apiToken) {
      this.d1 = new D1Client({
        accountId: config.accountId,
        databaseId: config.databaseId,
        apiToken: config.apiToken,
      });
    }

    if (config.bucket && config.accessKeyId && config.secretAccessKey) {
      this.r2 = new R2Client({
        accountId: config.accountId,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        bucket: config.bucket,
        userId: config.userId,
        publicUrl: config.publicUrl,
      });
    }
  }

  /**
   * Main sync orchestration - bidirectional sync.
   */
  async sync(onProgress?: SyncProgressCallback): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        uploaded: { assets: 0, folders: 0, categories: 0 },
        downloaded: { assets: 0, folders: 0, categories: 0 },
        deleted: 0,
        conflicts: 0,
        errors: ["Sync already in progress"],
        duration: 0,
      };
    }

    if (!this.d1) {
      return {
        success: false,
        uploaded: { assets: 0, folders: 0, categories: 0 },
        downloaded: { assets: 0, folders: 0, categories: 0 },
        deleted: 0,
        conflicts: 0,
        errors: ["D1 client not configured"],
        duration: 0,
      };
    }

    this.isSyncing = true;
    const startTime = Date.now();

    const result: SyncResult = {
      success: false,
      uploaded: { assets: 0, folders: 0, categories: 0 },
      downloaded: { assets: 0, folders: 0, categories: 0 },
      deleted: 0,
      conflicts: 0,
      errors: [],
      duration: 0,
    };

    try {
      // 1. Check connection
      onProgress?.({ phase: "uploading", message: "Connecting to D1...", current: 0, total: 1 });
      const connected = await this.d1.ping();
      if (!connected) {
        result.errors.push("Failed to connect to D1");
        return result;
      }

      // 2. Download remote changes first (to detect conflicts)
      onProgress?.({ phase: "downloading", message: "Downloading remote changes...", current: 0, total: 1 });
      const downloadResult = await this.downloadChanges(onProgress);
      result.downloaded = downloadResult.downloaded;
      result.conflicts = downloadResult.conflicts;
      result.errors.push(...downloadResult.errors);

      // 3. Upload pending local changes
      onProgress?.({ phase: "uploading", message: "Uploading local changes...", current: 0, total: 1 });
      const uploadResult = await this.uploadPending(onProgress);
      result.uploaded = uploadResult.uploaded;
      result.errors.push(...uploadResult.errors);

      // 4. Clean up synced deleted items
      await this.cleanupSyncedDeleted();

      // 5. Sync R2 config (upload local to remote)
      onProgress?.({ phase: "uploading", message: "Syncing R2 config...", current: 1, total: 1 });
      await this.syncR2Config();

      // 6. Update sync state
      syncRepo.setState("lastSyncAt", new Date().toISOString());
      syncRepo.setState("deviceId", this.config.deviceId);
      syncRepo.updateLastSync();

      result.success = result.errors.length === 0;
    } catch (error) {
      result.errors.push(`Sync failed: ${(error as Error).message}`);
    } finally {
      result.duration = Date.now() - startTime;
      this.isSyncing = false;
      onProgress?.({ phase: "complete", message: "Sync complete", current: 1, total: 1 });
    }

    return result;
  }

  /**
   * Check if sync is currently in progress.
   */
  get syncing(): boolean {
    return this.isSyncing;
  }

  /**
   * Get current sync status.
   */
  getSyncStatus(): {
    enabled: boolean;
    lastSync: string | null;
    pending: number;
    isSyncing: boolean;
  } {
    const state = syncRepo.getFullState();
    const pending = syncRepo.getPendingItems();
    const totalPending = pending.assets.length + pending.folders.length + pending.categories.length;

    return {
      enabled: state.syncEnabled,
      lastSync: state.lastSyncAt,
      pending: totalPending,
      isSyncing: this.isSyncing,
    };
  }

  /**
   * Upload pending local changes to D1.
   */
  private async uploadPending(
    onProgress?: SyncProgressCallback
  ): Promise<{
    uploaded: { assets: number; folders: number; categories: number };
    errors: string[];
  }> {
    const uploaded = { assets: 0, folders: 0, categories: 0 };
    const errors: string[] = [];

    const pending = syncRepo.getPendingItems();
    const totalPending = pending.assets.length + pending.folders.length + pending.categories.length;
    let processed = 0;

    if (!this.d1) return { uploaded, errors: ["D1 client not configured"] };

    // Upload folders
    for (const folderId of pending.folders) {
      onProgress?.({
        phase: "uploading",
        message: `Uploading folder ${folderId}...`,
        current: ++processed,
        total: totalPending,
      });

      const result = await this.uploadFolder(folderId);
      if (result.success) {
        uploaded.folders++;
        syncRepo.markAsSynced("folders", [folderId]);
      } else {
        errors.push(`Folder ${folderId}: ${result.error}`);
      }
    }

    // Upload tag categories
    for (const categoryId of pending.categories) {
      onProgress?.({
        phase: "uploading",
        message: `Uploading tag category ${categoryId}...`,
        current: ++processed,
        total: totalPending,
      });

      const result = await this.uploadTagCategory(categoryId);
      if (result.success) {
        uploaded.categories++;
        syncRepo.markAsSynced("tag_categories", [categoryId]);
      } else {
        errors.push(`Tag category ${categoryId}: ${result.error}`);
      }
    }

    // Upload assets
    for (const assetId of pending.assets) {
      onProgress?.({
        phase: "uploading",
        message: `Uploading asset ${assetId}...`,
        current: ++processed,
        total: totalPending,
      });

      const result = await this.uploadAsset(assetId);
      if (result.success) {
        uploaded.assets++;
        syncRepo.markAsSynced("assets", [assetId]);
      } else {
        errors.push(`Asset ${assetId}: ${result.error}`);
      }
    }

    // Upload deleted items
    const deleted = syncRepo.getDeletedItems();
    for (const item of deleted) {
      const result = await this.uploadDeleted(item);
      if (result.success) {
        syncRepo.markDeletedSynced([item.id]);
      }
    }

    return { uploaded, errors };
  }

  /**
   * Upload a single asset to D1.
   */
  private async uploadAsset(assetId: string): Promise<{ success: boolean; error?: string }> {
    const asset = assetsRepo.getById(assetId);
    if (!asset) {
      return { success: false, error: "Asset not found" };
    }

    if (!this.d1) return { success: false, error: "D1 client not configured" };

    // Get current version and increment atomically
    const currentVersion = this.getAssetVersion(asset.id);
    const nextVersion = currentVersion + 1;

    // Update local version immediately to prevent race conditions
    const db = getDatabase();
    db.run("UPDATE assets SET version = ? WHERE id = ?", [nextVersion, asset.id]);

    const assetWithDevice = {
      ...asset,
      deviceId: this.config.deviceId,
      version: nextVersion,
    };

    return await this.d1.uploadAsset(assetWithDevice);
  }

  /**
   * Upload a folder to D1.
   */
  private async uploadFolder(folderId: string): Promise<{ success: boolean; error?: string }> {
    const folders = foldersRepo.getAll();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) {
      return { success: false, error: "Folder not found" };
    }

    if (!this.d1) return { success: false, error: "D1 client not configured" };

    // Get and increment version atomically
    const currentVersion = this.getFolderVersion(folder.id);
    const nextVersion = currentVersion + 1;
    const db = getDatabase();
    db.run("UPDATE folders SET version = ? WHERE id = ?", [nextVersion, folder.id]);

    return await this.d1.uploadFolder({
      ...folder,
      deviceId: this.config.deviceId,
      version: nextVersion,
    });
  }

  /**
   * Upload a tag category to D1.
   */
  private async uploadTagCategory(categoryId: string): Promise<{ success: boolean; error?: string }> {
    const categories = tagsRepo.getAllCategories();
    const category = categories.find((c) => c.id === categoryId);
    if (!category) {
      return { success: false, error: "Tag category not found" };
    }

    if (!this.d1) return { success: false, error: "D1 client not configured" };

    // Get and increment version atomically
    const currentVersion = this.getCategoryVersion(category.id);
    const nextVersion = currentVersion + 1;
    const db = getDatabase();
    db.run("UPDATE tag_categories SET version = ? WHERE id = ?", [nextVersion, category.id]);

    return await this.d1.uploadTagCategory({
      ...category,
      deviceId: this.config.deviceId,
      version: nextVersion,
    });
  }

  /**
   * Upload a deleted item marker to D1 and delete from R2 if applicable.
   */
  private async uploadDeleted(item: {
    id: string;
    entityType: string;
    originalId: string;
    cloudR2Key: string | null;
  }): Promise<{ success: boolean; error?: string }> {
    if (!this.d1) return { success: false, error: "D1 client not configured" };

    const table =
      item.entityType === "folder"
        ? "folders"
        : item.entityType === "tag_category"
          ? "tag_categories"
          : "assets";

    // Mark as deleted in D1
    const d1Result = await this.d1.markDeleted(table, item.originalId, this.config.deviceId);
    if (!d1Result.success) {
      return d1Result;
    }

    // Delete from R2 if asset has R2 key
    if (item.entityType === "asset" && item.cloudR2Key && this.r2) {
      try {
        const r2Result = await this.r2.deleteFile(item.cloudR2Key);
        if (!r2Result.success) {
          console.error(`[SyncManager] Failed to delete R2 file ${item.cloudR2Key}:`, r2Result.error);
          // Don't fail the sync - log error but continue
          // The tombstone is already synced, so deletion will be retried on next sync if needed
        } else {
          console.log(`[SyncManager] Deleted R2 file: ${item.cloudR2Key}`);
        }
      } catch (error) {
        console.error(`[SyncManager] R2 deletion error for ${item.cloudR2Key}:`, (error as Error).message);
      }
    }

    return { success: true };
  }

  /**
   * Download remote changes from D1.
   */
  private async downloadChanges(
    onProgress?: SyncProgressCallback
  ): Promise<{
    downloaded: { assets: number; folders: number; categories: number };
    conflicts: number;
    errors: string[];
  }> {
    const downloaded = { assets: 0, folders: 0, categories: 0 };
    const errors: string[] = [];
    let conflicts = 0;

    if (!this.d1) return { downloaded, conflicts, errors: ["D1 client not configured"] };

    const lastSync = syncRepo.getState("lastSyncAt");
    const lastSyncDate = lastSync ? new Date(lastSync).toISOString() : "1900-01-01T00:00:00.000Z";

    const changes = await this.d1.fetchChanges(lastSyncDate);

    if (!changes.success) {
      return { downloaded, conflicts, errors: [changes.error || "Failed to fetch changes"] };
    }

    // Use transaction for atomic updates
    return transaction(() => {
      let processed = 0;
      const totalChanges = changes.folders.length + changes.tagCategories.length + changes.assets.length;

      // Process folders
      for (const row of changes.folders) {
        onProgress?.({
          phase: "downloading",
          message: `Processing folder ${row.name}...`,
          current: ++processed,
          total: totalChanges,
        });

        const merged = this.mergeFolder(row as any);
        if (merged === "created") downloaded.folders++;
        if (merged === "conflict") conflicts++;
      }

      // Process tag categories
      for (const row of changes.tagCategories) {
        onProgress?.({
          phase: "downloading",
          message: `Processing category ${row.name}...`,
          current: ++processed,
          total: totalChanges,
        });

        const merged = this.mergeTagCategory(row as any);
        if (merged === "created") downloaded.categories++;
        if (merged === "conflict") conflicts++;
      }

      // Process assets
      for (const row of changes.assets) {
        onProgress?.({
          phase: "downloading",
          message: `Processing asset ${row.file_name}...`,
          current: ++processed,
          total: totalChanges,
        });

        const merged = this.mergeAsset(row as any);
        if (merged === "created") downloaded.assets++;
        if (merged === "conflict") conflicts++;
      }

      return { downloaded, conflicts, errors };
    });
  }

  /**
   * Merge a remote folder into local database.
   */
  private mergeFolder(remote: any): "created" | "updated" | "conflict" | "skipped" {
    const local = foldersRepo.getAll().find((f) => f.id === remote.id);

    if (!local) {
      foldersRepo.create({
        name: remote.name,
        color: remote.color,
        icon: remote.icon,
      });
      return "created";
    }

    const localVersion = this.getFolderVersion(remote.id);
    if (remote.version > localVersion) {
      foldersRepo.update(remote.id, {
        name: remote.name,
        color: remote.color,
        icon: remote.icon,
      });
      return "updated";
    }

    return "skipped";
  }

  /**
   * Merge a remote tag category into local database.
   */
  private mergeTagCategory(remote: any): "created" | "updated" | "conflict" | "skipped" {
    const local = tagsRepo.getAllCategories().find((c) => c.id === remote.id);

    if (!local) {
      const tags = this.parseTags(remote.tags);
      tagsRepo.createCategory(remote.name, remote.color, tags);
      return "created";
    }

    const localVersion = this.getCategoryVersion(remote.id);
    if (remote.version > localVersion) {
      const tags = this.parseTags(remote.tags);
      tagsRepo.updateCategory(remote.id, { name: remote.name, color: remote.color, tags });
      return "updated";
    }

    return "skipped";
  }

  /**
   * Merge a remote asset into local database.
   */
  private mergeAsset(remote: any): "created" | "updated" | "conflict" | "skipped" {
    // Check if asset exists locally (including deleted)
    const localSyncStatus = assetsRepo.getSyncStatus(remote.id);

    // If asset was locally deleted, don't restore it from remote
    if (localSyncStatus === "deleted") {
      return "skipped";
    }

    const local = assetsRepo.getById(remote.id);

    if (!local) {
      const tags = this.parseTags(remote.tags);
      assetsRepo.insert({
        id: remote.id,
        filePath: remote.file_path,
        fileName: remote.file_name,
        type: remote.type,
        modelId: remote.model_id,
        createdAt: remote.created_at,
        fileSize: remote.file_size,
        favorite: remote.favorite === 1,
        predictionId: remote.prediction_id ?? undefined,
        resultIndex: remote.result_index,
        originalUrl: remote.original_url ?? undefined,
        source: remote.source ?? undefined,
        workflowId: remote.workflow_id ?? undefined,
        workflowName: remote.workflow_name ?? undefined,
        nodeId: remote.node_id ?? undefined,
        executionId: remote.execution_id ?? undefined,
        folderId: remote.folder_id ?? undefined,
        tags,
      });
      return "created";
    }

    // Version-based conflict resolution
    const localVersion = this.getAssetVersion(remote.id);
    if (remote.version > localVersion) {
      const tags = this.parseTags(remote.tags);
      assetsRepo.update(remote.id, {
        favorite: remote.favorite === 1,
        tags,
        folderId: remote.folder_id ?? undefined,
      });
      return "updated";
    } else if (remote.version === localVersion && this.resolver.tagsDiffer(local, remote)) {
      // Same version - merge tags
      const localTags = local.tags || [];
      const remoteTags = this.parseTags(remote.tags);
      const mergedTags = Array.from(new Set([...localTags, ...remoteTags]));
      assetsRepo.update(remote.id, { tags: mergedTags });
      // Mark for re-upload with incremented version
      syncRepo.markAsPending("assets", [remote.id]);
      return "conflict";
    }

    return "skipped";
  }

  /**
   * Clean up synced deleted items from local tombstone.
   */
  private async cleanupSyncedDeleted(): Promise<void> {
    const deleted = syncRepo.getDeletedItems();
    if (deleted.length > 0) {
      syncRepo.markDeletedSynced(deleted.map((d) => d.id));
    }
  }

  /**
   * Get current version for an asset.
   */
  private getAssetVersion(id: string): number {
    const db = getDatabase();
    try {
      const row = db.exec(`SELECT version FROM assets WHERE id = ?`, [id]);
      if (row.length > 0 && row[0].values.length > 0) {
        return row[0].values[0][0] as number;
      }
    } catch {}
    return 0;
  }

  /**
   * Get current version for a folder.
   */
  private getFolderVersion(id: string): number {
    const db = getDatabase();
    try {
      const row = db.exec(`SELECT version FROM folders WHERE id = ?`, [id]);
      if (row.length > 0 && row[0].values.length > 0) {
        return row[0].values[0][0] as number;
      }
    } catch {}
    return 0;
  }

  /**
   * Get current version for a tag category.
   */
  private getCategoryVersion(id: string): number {
    const db = getDatabase();
    try {
      const row = db.exec(`SELECT version FROM tag_categories WHERE id = ?`, [id]);
      if (row.length > 0 && row[0].values.length > 0) {
        return row[0].values[0][0] as number;
      }
    } catch {}
    return 0;
  }

  /**
   * Update sync configuration.
   */
  updateConfig(config: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...config };

    // Reinitialize clients if credentials changed
    if (config.accountId || config.databaseId || config.apiToken) {
      this.d1 = new D1Client({
        accountId: this.config.accountId,
        databaseId: this.config.databaseId,
        apiToken: this.config.apiToken,
      });
    }

    if (config.bucket || config.accessKeyId || config.secretAccessKey) {
      this.r2 = new R2Client({
        accountId: this.config.accountId,
        accessKeyId: this.config.accessKeyId!,
        secretAccessKey: this.config.secretAccessKey!,
        bucket: this.config.bucket!,
        userId: this.config.userId,
      });
    }
  }

  /**
   * Sync R2 config (upload local to remote, download remote to local).
   * Uses "last writer wins" - remote overwrites local if newer.
   */
  private async syncR2Config(): Promise<void> {
    if (!this.d1) return;

    try {
      // Get local R2 config
      const localConfig = syncRepo.getR2Config();

      // Get remote R2 config
      const remoteResult = await this.d1.getR2Config();
      if (remoteResult.success && remoteResult.config) {
        const remoteConfig = remoteResult.config;

        // If remote has config and local doesn't, pull from remote
        const localHasConfig = !!(localConfig.bucket || localConfig.accessKeyId || localConfig.publicUrl);
        const remoteHasConfig = !!(remoteConfig.bucket || remoteConfig.accessKeyId || remoteConfig.publicUrl);

        if (remoteHasConfig && !localHasConfig) {
          // Pull from remote
          syncRepo.setR2Config({
            bucket: remoteConfig.bucket ?? undefined,
            accessKeyId: remoteConfig.accessKeyId ?? undefined,
            secretAccessKey: remoteConfig.secretAccessKey ?? undefined,
            publicUrl: remoteConfig.publicUrl ?? undefined,
          });
          console.log("[SyncManager] R2 config pulled from remote");
        } else if (localHasConfig) {
          // Push local to remote (local always wins for convenience)
          await this.d1.setR2Config({
            bucket: localConfig.bucket ?? undefined,
            accessKeyId: localConfig.accessKeyId ?? undefined,
            secretAccessKey: localConfig.secretAccessKey ?? undefined,
            publicUrl: localConfig.publicUrl ?? undefined,
          });
          console.log("[SyncManager] R2 config pushed to remote");
        }
      }
    } catch (error) {
      console.error("[SyncManager] R2 config sync error:", (error as Error).message);
    }
  }

  /**
   * Initialize remote D1 database schema.
   * Should be called once when setting up sync for the first time.
   */
  async initializeRemoteSchema(): Promise<{ success: boolean; error?: string }> {
    if (!this.d1) {
      return { success: false, error: "D1 client not configured" };
    }

    try {
      // Check if schema already exists
      const existingVersion = await this.d1.getSchemaVersion();
      if (existingVersion > 0) {
        console.log(`[SyncManager] Remote schema already exists (version ${existingVersion})`);
        return { success: true };
      }

      // Initialize remote schema
      console.log("[SyncManager] Initializing remote D1 schema...");
      const schemaSql = getRemoteSchemaSql();
      const result = await this.d1.initializeSchema(schemaSql);

      if (result.success) {
        console.log("[SyncManager] Remote schema initialized successfully");
      } else {
        console.error("[SyncManager] Failed to initialize remote schema:", result.error);
      }

      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.error("[SyncManager] Schema initialization error:", errorMsg);
      return { success: false, error: errorMsg };
    }
  }
}
