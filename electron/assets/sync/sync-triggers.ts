/**
 * Sync trigger manager for automatic synchronization.
 * Handles manual, focus-based, and timer-based sync triggers.
 */

import { BrowserWindow } from "electron";
import type { SyncManager } from "./sync-manager";

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
