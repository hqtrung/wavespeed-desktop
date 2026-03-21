/**
 * Sync trigger manager for automatic synchronization.
 * Handles manual, focus-based, and timer-based sync triggers.
 * Also uploads files to R2 cloud storage during sync.
 */

import { BrowserWindow } from "electron";
import type { SyncManager } from "./sync-manager";
import type { R2Client } from "./r2-client";
import { getDatabase, persistDatabase } from "../db/connection";
import { assetsRepo, rowToMetadata } from "../db/assets.repo";

export interface TriggerConfig {
  timerEnabled: boolean;
  intervalMinutes: number;
  focusDebounceMs: number;
  dirtyDebounceMs: number;
  enableDirtyTrigger: boolean;
}

export class SyncTriggerManager {
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private focusDebounce: ReturnType<typeof setTimeout> | null = null;
  private dirtyDebounce: ReturnType<typeof setTimeout> | null = null;
  private syncManager: SyncManager | null = null;
  private r2Client: R2Client | null = null;
  private config: TriggerConfig;

  constructor(config: TriggerConfig = {
    timerEnabled: false,
    intervalMinutes: 15,
    focusDebounceMs: 5000,
    dirtyDebounceMs: 5000,
    enableDirtyTrigger: true,
  }) {
    this.config = config;
  }

  /**
   * Set the sync manager instance.
   */
  setSyncManager(manager: SyncManager): void {
    this.syncManager = manager;
  }

  /**
   * Set the R2 client instance for file uploads.
   */
  setR2Client(client: R2Client | null): void {
    this.r2Client = client;
  }

  /**
   * Setup all sync triggers for a window.
   */
  setupTriggers(window: BrowserWindow, config?: Partial<TriggerConfig>): void {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // App focus trigger (debounced)
    window.on("focus", () => {
      this.handleFocus();
    });

    // Optional timer trigger
    if (this.config.timerEnabled) {
      this.startTimer(this.config.intervalMinutes);
    }
  }

  /**
   * Handle app focus event with debouncing.
   */
  private handleFocus(): void {
    if (this.focusDebounce) {
      clearTimeout(this.focusDebounce);
    }

    this.focusDebounce = setTimeout(() => {
      this.triggerSync().catch(console.error);
    }, this.config.focusDebounceMs);
  }

  /**
   * Called when data changes (dirty state).
   * Triggers sync after debounce if enabled.
   */
  onDirtyState(): void {
    if (!this.config.enableDirtyTrigger) {
      return;
    }

    if (this.dirtyDebounce) {
      clearTimeout(this.dirtyDebounce);
    }

    this.dirtyDebounce = setTimeout(() => {
      this.triggerSync().catch(console.error);
    }, this.config.dirtyDebounceMs);

    console.log("[SyncTriggers] Dirty state detected, scheduling sync...");
  }

  /**
   * Start or restart the timer trigger.
   */
  startTimer(intervalMinutes?: number): void {
    this.stopTimer();

    const interval = intervalMinutes ?? this.config.intervalMinutes;
    if (interval <= 0) return;

    this.syncTimer = setInterval(() => {
      this.triggerSync().catch(console.error);
    }, interval * 60 * 1000);

    console.log(`[SyncTriggers] Timer started: ${interval}min interval`);
  }

  /**
   * Stop the timer trigger.
   */
  stopTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log("[SyncTriggers] Timer stopped");
    }
  }

  /**
   * Trigger manual sync (called from IPC).
   */
  async triggerManual(): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.triggerSync();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Internal sync trigger method.
   * Syncs D1 metadata and uploads new files to R2.
   */
  private async triggerSync(): Promise<void> {
    if (!this.syncManager) {
      console.warn("[SyncTriggers] Sync manager not configured");
      return;
    }

    if (this.syncManager.syncing) {
      console.log("[SyncTriggers] Sync already in progress, skipping");
      return;
    }

    console.log("[SyncTriggers] Triggering sync...");
    const result = await this.syncManager.sync();

    if (result.success) {
      console.log(
        `[SyncTriggers] Sync complete: up=${result.uploaded.assets}/${result.uploaded.folders}/${result.uploaded.categories}, down=${result.downloaded.assets}/${result.downloaded.folders}/${result.downloaded.categories}`
      );
    } else {
      console.error("[SyncTriggers] Sync failed:", result.errors);
    }

    // Upload new files to R2 if configured
    if (this.r2Client && this.r2Client.isConfigured()) {
      await this.uploadPendingFilesToR2();
    }
  }

  /**
   * Upload files that don't have cloud_r2_key yet to R2.
   */
  private async uploadPendingFilesToR2(): Promise<void> {
    if (!this.r2Client) return;

    try {
      const db = getDatabase();
      const rowsResult = db.exec("SELECT * FROM assets WHERE cloud_r2_key IS NULL AND sync_status != ?", ["deleted"]);
      const rows = rowsResult[0]?.values ?? [];
      const assets = rows.map((row) => rowToMetadata(row));

      if (assets.length === 0) {
        console.log("[SyncTriggers] No pending files to upload to R2");
        return;
      }

      console.log(`[SyncTriggers] Uploading ${assets.length} pending files to R2...`);

      let uploaded = 0;
      let failed = 0;

      for (const asset of assets) {
        try {
          // Check if file exists locally
          const { existsSync } = require("fs");
          if (!existsSync(asset.filePath)) {
            console.log(`[SyncTriggers] File not found, skipping: ${asset.fileName}`);
            failed++;
            continue;
          }

          const uploadResult = await this.r2Client.uploadFile(asset.id, asset.filePath, asset.type);

          if (uploadResult.success && uploadResult.key) {
            // Update DB with cloud_r2_key
            db.run("UPDATE assets SET cloud_r2_key = ? WHERE id = ?", [uploadResult.key, asset.id]);
            uploaded++;
            console.log(`[SyncTriggers] Uploaded to R2: ${asset.fileName}`);
          } else {
            failed++;
            console.error(`[SyncTriggers] R2 upload failed: ${asset.fileName} - ${uploadResult.error}`);
          }
        } catch (error) {
          failed++;
          console.error(`[SyncTriggers] R2 upload error for ${asset.fileName}:`, error);
        }
      }

      persistDatabase();
      console.log(`[SyncTriggers] R2 upload complete: ${uploaded} uploaded, ${failed} failed`);
    } catch (error) {
      console.error("[SyncTriggers] R2 upload error:", error);
    }
  }

  /**
   * Update trigger configuration.
   */
  updateConfig(config: Partial<TriggerConfig>): void {
    const oldTimerEnabled = this.config.timerEnabled;
    const oldInterval = this.config.intervalMinutes;

    this.config = { ...this.config, ...config };

    // Restart timer if configuration changed
    if (this.config.timerEnabled !== oldTimerEnabled || this.config.intervalMinutes !== oldInterval) {
      if (oldTimerEnabled) {
        this.stopTimer();
      }
      if (this.config.timerEnabled) {
        this.startTimer();
      }
    }
  }

  /**
   * Get current trigger configuration.
   */
  getConfig(): TriggerConfig {
    return { ...this.config };
  }

  /**
   * Clean up all triggers.
   */
  cleanup(): void {
    this.stopTimer();
    if (this.focusDebounce) {
      clearTimeout(this.focusDebounce);
      this.focusDebounce = null;
    }
    if (this.dirtyDebounce) {
      clearTimeout(this.dirtyDebounce);
      this.dirtyDebounce = null;
    }
  }
}

// Global singleton instance
let globalTriggerManager: SyncTriggerManager | null = null;

/**
 * Get or create the global sync trigger manager.
 */
export function getSyncTriggerManager(): SyncTriggerManager {
  if (!globalTriggerManager) {
    globalTriggerManager = new SyncTriggerManager();
  }
  return globalTriggerManager;
}

/**
 * Clean up the global sync trigger manager.
 */
export function cleanupSyncTriggerManager(): void {
  if (globalTriggerManager) {
    globalTriggerManager.cleanup();
    globalTriggerManager = null;
  }
}
