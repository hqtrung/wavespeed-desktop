import type { HistoryItem } from "./prediction";

export interface ReferenceImage {
  url: string;
  localPath: string;
}

export interface CachedPrediction extends HistoryItem {
  inputs?: Record<string, unknown>; // Stored for "open in playground"
  input_details?: Record<string, unknown>; // Full inputs from API
  reference_images?: ReferenceImage[]; // Downloaded reference images
  synced_at?: string;
}

export interface HistoryCacheFilters {
  status?: string;
  model_id?: string;
  created_after?: string;
  created_before?: string;
}

export interface HistoryCacheListOptions {
  limit?: number;
  offset?: number;
  filters?: HistoryCacheFilters;
}

export interface HistoryCacheStats {
  totalCount: number;
  lastSyncTime: string | null;
  dbSizeBytes: number;
}
