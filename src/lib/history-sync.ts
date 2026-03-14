/**
 * Background sync service for periodic history synchronization.
 * Enhanced to download and cache reference images.
 */
import { historyCacheIpc, type SyncProgress } from "@/ipc/history";
import type { HistoryItem } from "@/types/prediction";

export type SyncStatus = "idle" | "syncing" | "success" | "error";
export type SyncListener = (status: SyncStatus, error?: Error) => void;
export type SyncProgressListener = (progress: SyncProgress) => void;

interface HistorySyncOptions {
  interval?: number; // milliseconds, default 5 minutes
  enabled?: boolean; // allow disabling
  useEnhancedSync?: boolean; // use enhanced sync with images (default: true)
}

export class HistorySyncService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private statusListeners: Set<SyncListener> = new Set();
  private progressListeners: Set<SyncProgressListener> = new Set();
  private status: SyncStatus = "idle";
  private currentError: Error | null = null;
  private intervalMs: number;
  private enabled: boolean;
  private useEnhancedSync: boolean;
  private syncProgressUnsubscribe: (() => void) | null = null;

  constructor(options: HistorySyncOptions = {}) {
    this.intervalMs = options.interval ?? 5 * 60 * 1000; // 5 minutes
    this.enabled = options.enabled ?? true;
    this.useEnhancedSync = options.useEnhancedSync ?? true;
  }

  // Subscribe to status changes
  onStatusChange(callback: SyncListener): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  // Subscribe to progress updates (enhanced sync only)
  onProgress(callback: SyncProgressListener): () => void {
    this.progressListeners.add(callback);
    return () => this.progressListeners.delete(callback);
  }

  private emit(status: SyncStatus, error?: Error): void {
    this.status = status;
    this.currentError = error ?? null;
    this.statusListeners.forEach((cb) => cb(status, error));
  }

  private emitProgress(progress: SyncProgress): void {
    this.progressListeners.forEach((cb) => cb(progress));
  }

  getStatus(): { status: SyncStatus; error: Error | null } {
    return { status: this.status, error: this.currentError };
  }

  // Single sync operation
  async syncOnce(): Promise<{
    success: boolean;
    count?: number;
    error?: Error;
  }> {
    if (!this.enabled) {
      return { success: false };
    }

    this.emit("syncing");

    try {
      if (this.useEnhancedSync) {
        // Use enhanced sync with image downloads
        const unsubscribe = historyCacheIpc.onSyncProgress((progress) => {
          this.emitProgress(progress);
        });
        this.syncProgressUnsubscribe = unsubscribe;

        const result = await historyCacheIpc.syncWithImages();

        if (this.syncProgressUnsubscribe) {
          this.syncProgressUnsubscribe();
          this.syncProgressUnsubscribe = null;
        }

        if (result.errors.length > 0) {
          console.warn("[History Sync] Some items failed to sync:", result.errors);
        }

        this.emit("success");
        return { success: result.success, count: result.count };
      } else {
        // Legacy basic sync (without images)
        const { apiClient } = await import("@/api/client");
        const response = await apiClient.getHistory(1, 100, undefined, { timeout: 120000 });
        const items = response.items || [];

        // Bulk upsert to cache
        await historyCacheIpc.upsertBulk(items);

        this.emit("success");
        return { success: true, count: items.length };
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Sync failed");
      this.emit("error", error);

      if (this.syncProgressUnsubscribe) {
        this.syncProgressUnsubscribe();
        this.syncProgressUnsubscribe = null;
      }

      return { success: false, error };
    }
  }

  // Start periodic sync
  start(): void {
    if (this.intervalId || !this.enabled) return;

    // Initial sync
    this.syncOnce().catch(console.error);

    // Periodic sync
    this.intervalId = setInterval(() => {
      this.syncOnce().catch(console.error);
    }, this.intervalMs);
  }

  // Stop periodic sync
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.syncProgressUnsubscribe) {
      this.syncProgressUnsubscribe();
      this.syncProgressUnsubscribe = null;
    }
  }

  // Pause sync (e.g., when page hidden)
  pause(): void {
    this.stop();
  }

  // Resume sync
  resume(): void {
    this.start();
  }

  // Update configuration
  setOptions(options: Partial<HistorySyncOptions>): void {
    if (options.interval !== undefined) {
      this.intervalMs = options.interval;
      // Restart if interval changed
      if (this.intervalId) {
        this.stop();
        this.start();
      }
    }
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
      if (!this.enabled) {
        this.stop();
      }
    }
    if (options.useEnhancedSync !== undefined) {
      this.useEnhancedSync = options.useEnhancedSync;
    }
  }

  // Cleanup
  destroy(): void {
    this.stop();
    this.statusListeners.clear();
    this.progressListeners.clear();
  }
}

// Singleton instance
let syncService: HistorySyncService | null = null;

export function getHistorySyncService(): HistorySyncService {
  if (!syncService) {
    syncService = new HistorySyncService();
  }
  return syncService;
}

