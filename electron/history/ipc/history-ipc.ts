/**
 * IPC handlers for history cache (main process).
 */

import { ipcMain } from "electron";
import type { HistoryItem } from "@/types/prediction";
import * as predictionRepo from "../db/prediction-repo";
import { getHistorySyncService } from "../sync-service";
import { getLocalStorageSyncService } from "../sync/local-storage-sync";

export function registerHistoryIpc(): void {
  // Get predictions from cache
  ipcMain.handle(
    "history-cache:list",
    async (_event, options: { limit?: number; offset?: number; status?: string }) => {
      return predictionRepo.listPredictions(options);
    },
  );

  // Get single prediction
  ipcMain.handle("history-cache:get", async (_event, id: string) => {
    return predictionRepo.getPredictionById(id);
  });

  // Upsert prediction
  ipcMain.handle(
    "history-cache:upsert",
    async (_event, item: unknown) => {
      predictionRepo.upsertPrediction(
        item as Parameters<typeof predictionRepo.upsertPrediction>[0],
      );
      return { success: true };
    },
  );

  // Bulk upsert (for sync)
  ipcMain.handle(
    "history-cache:upsert-bulk",
    async (_event, items: unknown[]) => {
      predictionRepo.upsertPredictions(
        items as Parameters<typeof predictionRepo.upsertPredictions>[0],
      );
      return { success: true, count: items.length };
    },
  );

  // Delete prediction
  ipcMain.handle("history-cache:delete", async (_event, id: string) => {
    predictionRepo.deletePrediction(id);
    return { success: true };
  });

  // Get stats
  ipcMain.handle("history-cache:stats", async () => {
    return {
      totalCount: predictionRepo.getCount(),
      lastSyncTime: predictionRepo.getLastSyncTime(),
    };
  });

  // Clear all
  ipcMain.handle("history-cache:clear", async () => {
    const { getDatabase, persistDatabase } = await import("../db/connection");
    const db = getDatabase();
    db.run("DELETE FROM predictions");
    persistDatabase();
    return { success: true };
  });

  // Enhanced sync with images
  ipcMain.handle(
    "history-cache:sync-with-images",
    async (event, data: { historyItems: HistoryItem[]; detailItems: Array<{ id: string; input?: Record<string, unknown> }> }) => {
      const syncService = getHistorySyncService();

      // Forward progress events to renderer
      const unsubscribe = syncService.onProgress((progress) => {
        event.sender.send("history-cache:sync-progress", progress);
      });

      try {
        const result = await syncService.syncHistoryWithImages(
          // Fetch history (already fetched from renderer)
          async () => data.historyItems,
          // Fetch details (already fetched from renderer)
          async (predictionId: string) => {
            const detail = data.detailItems.find(d => d.id === predictionId);
            return detail || {};
          },
        );

        return result;
      } finally {
        unsubscribe();
      }
    },
  );

  // Check if syncing
  ipcMain.handle("history-cache:is-syncing", async () => {
    const syncService = getHistorySyncService();
    return syncService.isCurrentlySyncing();
  });

  // Sync from localStorage
  ipcMain.handle(
    "history-cache:sync-from-local-storage",
    async (event, localStorageData: string) => {
      const syncService = getLocalStorageSyncService();

      // Forward progress events to renderer
      const unsubscribe = syncService.onProgress((progress) => {
        event.sender.send("history-cache:sync-progress", progress);
      });

      try {
        const result = await syncService.syncFromLocalStorage(localStorageData);
        return result;
      } finally {
        unsubscribe();
      }
    },
  );

  console.log("[History Cache IPC] Registered IPC handlers");
}
