export type AssetType = "image" | "video" | "audio" | "text" | "json";

export type AssetSortBy =
  | "date-desc"
  | "date-asc"
  | "name-asc"
  | "name-desc"
  | "size-desc"
  | "size-asc";

export type AssetSource = "playground" | "workflow" | "free-tool" | "z-image";

export interface AssetMetadata {
  id: string;
  filePath: string;
  fileName: string;
  type: AssetType;
  modelId: string;
  createdAt: string;
  fileSize: number;
  tags: string[];
  favorite: boolean;
  predictionId?: string;
  resultIndex?: number; // For batch predictions, which output index
  originalUrl?: string;
  source?: AssetSource;
  workflowId?: string;
  workflowName?: string;
  nodeId?: string;
  executionId?: string;
  folderId?: string; // Optional folder assignment
  cloudR2Key?: string | null; // R2 storage key for cloud backup
  locallyAvailable?: boolean; // Whether file exists locally (computed)
}

export interface AssetsFilter {
  types?: AssetType[];
  models?: string[];
  dateFrom?: string;
  dateTo?: string;
  tags?: string[];
  favoritesOnly?: boolean;
  search?: string;
  sortBy?: AssetSortBy;
  sources?: AssetSource[];
  folderId?: string | null | NoFolderId; // Filter by folder (null = all assets, "__none__" = unassigned)
}

export interface AssetsSaveOptions {
  modelId: string;
  predictionId?: string;
  originalUrl?: string;
  resultIndex?: number;
  source?: AssetSource;
  workflowId?: string;
  workflowName?: string;
  nodeId?: string;
  executionId?: string;
}

export interface AssetsSettings {
  autoSaveAssets: boolean;
  assetsDirectory: string;
}

export interface SaveAssetResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  error?: string;
}

export interface DeleteAssetResult {
  success: boolean;
  error?: string;
}

export interface SelectDirectoryResult {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

// Folder/collection for organizing assets
export interface AssetFolder {
  id: string;
  name: string;
  color: string; // Hex color or preset name
  icon?: string; // Lucide icon name (optional)
  createdAt: string;
  assetCount?: number; // Computed, not persisted
}

// Tag color presets for categorization
export type TagColor =
  | "default"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink";

// Special value for filtering assets without a folder
export const NO_FOLDER_ID = "__none__" as const;
export type NoFolderId = typeof NO_FOLDER_ID;

// Tag category for grouping and coloring tags
export interface TagCategory {
  id: string;
  name: string;
  color: TagColor;
  tags: string[]; // Tags in this category
  createdAt: string;
}
