/**
 * Type-safe IPC client for history cache (renderer process).
 */
import type {
  CachedPrediction,
  HistoryCacheListOptions,
  HistoryCacheStats,
} from "@/types/history-cache";
import type { HistoryItem } from "@/types/prediction";

export type SyncProgress = {
  stage: "fetching" | "downloading" | "complete";
  current: number;
  total: number;
  percentage: number;
};

function getApi() {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, unknown>)
    .electronAPI as Record<string, unknown> | undefined;
}

async function invoke<T>(channel: string, args?: unknown): Promise<T> {
  const api = getApi();
  if (!api) return Promise.reject(new Error("Electron API not available"));

  // Convert channel name to camelCase: "upsertBulk" -> "UpsertBulk" -> "historyCacheUpsertBulk"
  const pascalCase = channel
    .split(/(?=[A-Z])/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  const handlerName = `historyCache${pascalCase}`;

  const handler = (api as Record<string, (args?: unknown) => Promise<unknown>>)[handlerName];
  if (!handler)
    return Promise.reject(new Error(`History cache channel not found: ${channel} (tried: ${handlerName})`));
  return handler(args) as Promise<T>;
}

export const historyCacheIpc = {
  list: (options: HistoryCacheListOptions): Promise<CachedPrediction[]> =>
    invoke("list", options),

  get: (id: string): Promise<CachedPrediction | null> => invoke("get", id),

  upsert: (
    item: HistoryItem & { inputs?: Record<string, unknown> },
  ): Promise<{ success: boolean }> => invoke("upsert", item),

  upsertBulk: (
    items: HistoryItem[],
  ): Promise<{ success: boolean; count: number }> => invoke("upsertBulk", items),

  delete: (id: string): Promise<{ success: boolean }> => invoke("delete", id),

  stats: (): Promise<HistoryCacheStats> => invoke("stats"),

  clear: (): Promise<{ success: boolean }> => invoke("clear"),

  syncWithImages: async (): Promise<{
    success: boolean;
    count: number;
    errors: string[];
  }> => {
    // Fetch history and details in renderer (where API client is available)
    const { apiClient } = await import("@/api/client");
    const { webClient } = await import("@/api/web-client");
    const { useWebAuthStore } = await import("@/stores/webAuthStore");

    // Check if user is web authenticated
    const isWebAuthed = useWebAuthStore.getState().isAuthenticated;
    console.log(`[History IPC] Web auth status: ${isWebAuthed}`);

    // Fetch history items with extended timeout (sync operations can take longer)
    const historyResponse = await apiClient.getHistory(1, 100, undefined, { timeout: 120000 });
    const historyItems = historyResponse.items || [];

    // Fetch details for all items using webClient if available (for prompts), otherwise apiClient
    const detailItems = await Promise.all(
      historyItems.map(async (item) => {
        // Try webClient first if authenticated (has prompts)
        if (isWebAuthed) {
          try {
            const webDetail = await webClient.getPredictionDetail(item.id);
            if (webDetail.payload) {
              const payload = JSON.parse(webDetail.payload);
              console.log(`[History IPC] WebClient found inputs for ${item.id}`);
              return { id: item.id, input: payload };
            }
          } catch (webErr) {
            console.log(`[History IPC] WebClient failed for ${item.id}:`, webErr);
          }
        }

        // Fallback to regular API
        try {
          const details = await apiClient.getPredictionDetails(item.id);
          const input = (details as any).input || (details as any).inputs || {};
          console.log(`[History IPC] API details for ${item.id}:`, details);
          console.log(`[History IPC] API Input field:`, input);
          return { id: item.id, input };
        } catch (err) {
          console.error(`[History IPC] Failed to fetch details for ${item.id}:`, err);
          return { id: item.id, input: undefined };
        }
      }),
    );

    console.log(`[History IPC] Fetched ${detailItems.length} detail items`);
    console.log(`[History IPC] Items with input: ${detailItems.filter(d => d.input).length}`);

    // Pass data to main process for downloading and caching
    return invoke("syncWithImages", { historyItems, detailItems });
  },

  syncFromLocalStorage: async (): Promise<{
    success: boolean;
    count: number;
    errors: string[];
  }> => {
    // Read from localStorage
    const localStorageData = localStorage.getItem("wavespeed_prediction_inputs");
    if (!localStorageData) {
      return { success: false, count: 0, errors: ["No localStorage data found"] };
    }

    return invoke("syncFromLocalStorage", localStorageData);
  },

  isSyncing: (): Promise<boolean> => invoke("isSyncing"),

  onSyncProgress: (callback: (progress: SyncProgress) => void): (() => void) => {
    const api = getApi();
    if (!api) return () => {};

    const onProgress = (api as Record<string, unknown>)
      .onHistoryCacheSyncProgress as (cb: (progress: SyncProgress) => void) => (() => void);

    if (!onProgress) {
      console.warn("[History IPC] onHistoryCacheSyncProgress not available");
      return () => {};
    }

    return onProgress(callback);
  },
};
