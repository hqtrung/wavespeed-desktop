/**
 * Hook for caching prediction history items.
 */
import { useCallback } from "react";
import { historyCacheIpc } from "@/ipc/history";
import type { HistoryItem } from "@/types/prediction";

export function useHistoryCache() {
  const upsertToCache = useCallback(
    async (item: HistoryItem & { inputs?: Record<string, unknown> }) => {
      try {
        await historyCacheIpc.upsert(item);
      } catch (err) {
        console.error("[History Cache] Failed to upsert:", err);
        // Don't throw - cache failures shouldn't break playground
      }
    },
    [],
  );

  return { upsertToCache };
}
