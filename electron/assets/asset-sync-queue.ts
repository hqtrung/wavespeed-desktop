/**
 * Asset sync queue for background downloading of missing assets.
 * Processes assets that have cloud_r2_key but missing local files.
 */

import { existsSync } from "fs";
import { ipcMain, BrowserWindow } from "electron";
import { getDatabase } from "./db/connection";
import { getCacheManager } from "./cache-manager";
import type { R2Client } from "./sync/r2-client";

export interface SyncQueueEntry {
  assetId: string;
  cloudR2Key: string;
  filePath: string;
  type: string;
  priority: number; // Higher = more important
}

export interface SyncQueueStats {
  pending: number;
  downloaded: number;
  failed: number;
  isProcessing: boolean;
}

export interface SyncProgressEvent {
  assetId: string;
  fileName: string;
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
}

export class AssetSyncQueue {
  private queue: SyncQueueEntry[] = [];
  private downloaded: Set<string> = new Set();
  private failed: Set<string> = new Set();
  private isProcessing = false;
  private r2Client: R2Client | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    // Listen for window to send progress updates
    this.setupProgressEmitter();
  }

  /**
   * Set the R2 client for downloads.
   */
  setR2Client(client: R2Client | null): void {
    this.r2Client = client;
  }

  /**
   * Add an asset to the sync queue.
   */
  enqueue(assetId: string, priority: number = 0): void {
    // Skip if already in queue or processed
    if (
      this.queue.some((e) => e.assetId === assetId) ||
      this.downloaded.has(assetId) ||
      this.failed.has(assetId)
    ) {
      return;
    }

    try {
      const db = getDatabase();
      const result = db.exec(
        "SELECT cloud_r2_key, file_path, type FROM assets WHERE id = ? AND sync_status != 'deleted'",
        [assetId]
      );

      if (result.length > 0 && result[0].values.length > 0) {
        const row = result[0].values[0];
        const cloudR2Key = row[0] as string | null;
        const filePath = row[1] as string;
        const type = row[2] as string;

        if (cloudR2Key) {
          this.queue.push({ assetId, cloudR2Key, filePath, type, priority });
          // Sort by priority (descending)
          this.queue.sort((a, b) => b.priority - a.priority);
        }
      }
    } catch (error) {
      console.error(`[AssetSyncQueue] Failed to enqueue ${assetId}:`, error);
    }
  }

  /**
   * Add multiple assets to the queue.
   */
  enqueueMany(assetIds: string[], priority: number = 0): void {
    for (const id of assetIds) {
      this.enqueue(id, priority);
    }
  }

  /**
   * Scan for assets missing local files and queue them.
   */
  queueMissingAssets(maxItems?: number): number {
    try {
      const db = getDatabase();
      const sql = maxItems
        ? "SELECT id, cloud_r2_key, file_path, type FROM assets WHERE cloud_r2_key IS NOT NULL AND sync_status != 'deleted' ORDER BY created_at DESC LIMIT ?"
        : "SELECT id, cloud_r2_key, file_path, type FROM assets WHERE cloud_r2_key IS NOT NULL AND sync_status != 'deleted' ORDER BY created_at DESC";

      const result = db.exec(sql, maxItems ? [maxItems] : []);

      let queued = 0;
      if (result.length > 0) {
        for (const row of result[0].values) {
          const assetId = row[0] as string;
          const cloudR2Key = row[1] as string;
          const filePath = row[2] as string;
          const type = row[3] as string;

          // Check if file exists locally
          if (!existsSync(filePath)) {
            // Skip if already queued or processed
            if (
              !this.queue.some((e) => e.assetId === assetId) &&
              !this.downloaded.has(assetId) &&
              !this.failed.has(assetId)
            ) {
              this.queue.push({ assetId, cloudR2Key, filePath, type, priority: 0 });
              queued++;
            }
          }
        }
      }

      console.log(`[AssetSyncQueue] Queued ${queued} missing assets`);
      return queued;
    } catch (error) {
      console.error("[AssetSyncQueue] Failed to scan for missing assets:", error);
      return 0;
    }
  }

  /**
   * Process the next item in the queue.
   */
  async processNext(): Promise<{ success: boolean; assetId?: string; error?: string }> {
    if (this.queue.length === 0) {
      return { success: false, error: "Queue is empty" };
    }

    const entry = this.queue.shift()!;
    const cacheManager = getCacheManager();

    // Check if file already exists (might have been downloaded by other means)
    if (existsSync(entry.filePath)) {
      this.downloaded.add(entry.assetId);
      this.emitProgress({ assetId: entry.assetId, fileName: entry.filePath, bytesDownloaded: 0, totalBytes: 0, percentage: 100 });
      return { success: true, assetId: entry.assetId };
    }

    if (!this.r2Client) {
      this.failed.add(entry.assetId);
      return { success: false, assetId: entry.assetId, error: "R2 client not configured" };
    }

    try {
      // Ensure enough space
      const fileSize = await this.fetchFileSize(entry.cloudR2Key);
      if (!cacheManager.ensureSpace(fileSize)) {
        this.failed.add(entry.assetId);
        return { success: false, assetId: entry.assetId, error: "Insufficient disk space" };
      }

      // Download from R2 (use public URL if available for better performance)
      const downloadUrl = this.r2Client.getDownloadUrl(entry.cloudR2Key);
      const result = await this.r2Client.downloadFile(
        entry.cloudR2Key,
        entry.filePath,
        (bytes, total) => {
          this.emitProgress({
            assetId: entry.assetId,
            fileName: entry.filePath,
            bytesDownloaded: bytes,
            totalBytes: total,
            percentage: total > 0 ? Math.round((bytes / total) * 100) : 0,
          });
        }
      );

      if (result.success) {
        this.downloaded.add(entry.assetId);
        console.log(`[AssetSyncQueue] Downloaded ${entry.assetId}`);
        return { success: true, assetId: entry.assetId };
      } else {
        this.failed.add(entry.assetId);
        return { success: false, assetId: entry.assetId, error: result.error };
      }
    } catch (error) {
      this.failed.add(entry.assetId);
      return { success: false, assetId: entry.assetId, error: (error as Error).message };
    }
  }

  /**
   * Process all items in the queue.
   */
  async processAll(): Promise<{ downloaded: number; failed: number }> {
    if (this.isProcessing) {
      return { downloaded: 0, failed: 0 };
    }

    this.isProcessing = true;
    this.abortController = new AbortController();

    let downloaded = 0;
    let failed = 0;

    this.emitStats();

    try {
      while (this.queue.length > 0 && !this.abortController.signal.aborted) {
        const result = await this.processNext();
        if (result.success) {
          downloaded++;
        } else {
          failed++;
        }
        this.emitStats();
      }
    } finally {
      this.isProcessing = false;
      this.abortController = null;
      this.emitStats();
    }

    console.log(`[AssetSyncQueue] Process complete: ${downloaded} downloaded, ${failed} failed`);
    return { downloaded, failed };
  }

  /**
   * Cancel ongoing processing.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.isProcessing = false;
      this.abortController = null;
      console.log("[AssetSyncQueue] Processing cancelled");
    }
  }

  /**
   * Get queue statistics.
   */
  getStats(): SyncQueueStats {
    return {
      pending: this.queue.length,
      downloaded: this.downloaded.size,
      failed: this.failed.size,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Clear the queue and reset state.
   */
  clear(): void {
    this.cancel();
    this.queue = [];
    this.downloaded.clear();
    this.failed.clear();
    this.emitStats();
  }

  /**
   * Reset failed items (allows retrying).
   */
  resetFailed(): void {
    for (const assetId of this.failed) {
      this.enqueue(assetId, 0);
    }
    this.failed.clear();
    this.emitStats();
  }

  /**
   * Setup IPC event emitter for progress updates.
   */
  private setupProgressEmitter(): void {
    // Progress is emitted per-item during processing
  }

  /**
   * Emit progress update to renderer.
   */
  private emitProgress(progress: SyncProgressEvent): void {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send("assets:sync-progress", progress);
    }
  }

  /**
   * Emit statistics update to renderer.
   */
  private emitStats(): void {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send("assets:sync-stats", this.getStats());
    }
  }

  /**
   * Fetch file size from R2 (HEAD request).
   */
  private async fetchFileSize(key: string): Promise<number> {
    if (!this.r2Client) return 0;

    try {
      const config = this.r2Client.getConfig();
      const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
      const bucket = config.bucket;
      const url = `${endpoint}/${bucket}/${key}`;

      const response = await fetch(url, {
        method: "HEAD",
        headers: this.r2Client.generateAuthHeader("HEAD", key, ""),
      });

      if (response.ok) {
        const contentLength = response.headers.get("content-length");
        return contentLength ? parseInt(contentLength, 10) : 0;
      }
    } catch (error) {
      console.error("[AssetSyncQueue] Failed to fetch file size:", error);
    }

    return 0;
  }
}

// Singleton instance
let syncQueueInstance: AssetSyncQueue | null = null;

export function getAssetSyncQueue(): AssetSyncQueue {
  if (!syncQueueInstance) {
    syncQueueInstance = new AssetSyncQueue();
  }
  return syncQueueInstance;
}

export function setAssetSyncQueue(queue: AssetSyncQueue): void {
  syncQueueInstance = queue;
}
