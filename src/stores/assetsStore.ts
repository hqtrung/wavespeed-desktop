import { create } from "zustand";
import type {
  AssetMetadata,
  AssetType,
  AssetsFilter,
  AssetsSaveOptions,
  AssetsSettings,
  AssetFolder,
  TagCategory,
  TagColor,
} from "@/types/asset";

const METADATA_STORAGE_KEY = "wavespeed_assets_metadata";
const SETTINGS_STORAGE_KEY = "wavespeed_assets_settings";
const FOLDERS_STORAGE_KEY = "wavespeed_assets_folders";
const TAG_CATEGORIES_STORAGE_KEY = "wavespeed_assets_tag_categories";
const DELETED_ASSETS_KEY = "wavespeed_deleted_assets"; // Track intentionally deleted assets

// Track whether we've subscribed to the IPC event for new assets from workflow executor
let assetsIpcListenerRegistered = false;

// Helper to generate key for deleted assets registry
function getDeletedAssetKey(predictionId: string, resultIndex: number): string {
  return `${predictionId}_${resultIndex}`;
}

// Helper to remove from deleted registry when user manually re-saves
async function removeFromDeletedRegistry(
  deletedAssets: Set<string>,
  predictionId: string,
  resultIndex: number,
): Promise<Set<string>> {
  const deletedKey = getDeletedAssetKey(predictionId, resultIndex);
  if (!deletedAssets.has(deletedKey)) return deletedAssets;

  const newDeletedAssets = new Set(deletedAssets);
  newDeletedAssets.delete(deletedKey);

  // Persist the change
  const store = useAssetsStore.getState();
  await store.saveDeletedAssets(newDeletedAssets);

  return newDeletedAssets;
}

// Helper to generate unique ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// Helper to get file extension from URL
function getExtensionFromUrl(url: string): string | null {
  const match = url.match(/\.([a-zA-Z0-9]+)(\?.*)?$/);
  return match ? match[1].toLowerCase() : null;
}

// Helper to get default extension for asset type
function getDefaultExtension(type: AssetType): string {
  switch (type) {
    case "image":
      return "png";
    case "video":
      return "mp4";
    case "audio":
      return "mp3";
    case "text":
      return "txt";
    case "json":
      return "json";
  }
}

// Helper to get subdirectory for asset type
function getSubDir(type: AssetType): string {
  switch (type) {
    case "image":
      return "images";
    case "video":
      return "videos";
    case "audio":
      return "audio";
    case "text":
    case "json":
      return "text";
  }
}

// Helper to detect asset type from URL
export function detectAssetType(url: string): AssetType | null {
  const ext = getExtensionFromUrl(url);
  if (ext) {
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
    const videoExts = ["mp4", "webm", "mov", "avi", "mkv"];
    const audioExts = ["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma"];

    if (imageExts.includes(ext)) return "image";
    if (videoExts.includes(ext)) return "video";
    if (audioExts.includes(ext)) return "audio";
  }

  // Fallback: infer from URL path segments for CDN URLs without extensions
  // e.g. https://cdn.example.com/outputs/.../result
  const lower = url.toLowerCase();
  if (/\/(image|img)[s]?\//i.test(lower)) return "image";
  if (/\/(video|vid)[s]?\//i.test(lower)) return "video";
  if (/\/(audio|sound)[s]?\//i.test(lower)) return "audio";

  return null;
}

// Helper to generate filename: model_predictionid_resultindex.ext
function generateFileName(
  modelId: string,
  type: AssetType,
  url: string,
  predictionId?: string,
  resultIndex: number = 0,
): string {
  // Replace / with _, other special chars with -, then clean up
  const slug = modelId
    .replace(/\//g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-");
  const id =
    predictionId ||
    Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const ext = getExtensionFromUrl(url) || getDefaultExtension(type);
  return `${slug}_${id}_${resultIndex}.${ext}`;
}

// Exported version for downloads - uses same naming convention as saved assets
export function generateDownloadFilename(options: {
  modelId?: string;
  url: string;
  predictionId?: string;
  resultIndex?: number;
}): string {
  const { modelId, url, predictionId, resultIndex = 0 } = options;
  const slug = modelId
    ? modelId
        .replace(/\//g, "_")
        .replace(/[^a-zA-Z0-9_]/g, "-")
        .toLowerCase()
        .replace(/-+/g, "-")
    : "output";
  const id =
    predictionId ||
    Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const ext = getExtensionFromUrl(url) || "png";
  return `${slug}_${id}_${resultIndex}.${ext}`;
}

// Generate filename for free tools - format: free-tools_{tool-name}_{id}_{resultIndex}.{ext}
export function generateFreeToolFilename(
  toolName: string,
  extension: string,
  suffix?: string,
): string {
  const id =
    Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const toolSlug = toolName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  const suffixPart = suffix ? `-${suffix}` : "";
  return `free-tools_${toolSlug}${suffixPart}_${id}_0.${extension}`;
}

// Helper to extract model ID from filename
// Format: "{model-slug}_{predictionId}_{resultIndex}.{ext}"
// where model-slug has / replaced with _
// Examples: "wavespeed-ai_flux-schnell_abc123_0.png" -> "wavespeed-ai/flux-schnell"
//           "google_nano-banana-pro_edit_abc123_0.png" -> "google/nano-banana-pro/edit"
//           "local_z-image_2024-12-21_0.png" -> "local/z-image"
function extractModelId(fileName: string): string {
  // Remove extension
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");
  const parts = nameWithoutExt.split("_");

  // Need at least 3 parts: model (1+), predictionId, resultIndex
  if (parts.length >= 3) {
    // Last part is resultIndex, second to last is predictionId
    // Everything before is the model slug (joined with /)
    const modelParts = parts.slice(0, -2);
    return modelParts.join("/");
  }

  if (parts.length > 0 && parts[0]) {
    return parts[0];
  }
  return "unknown";
}

// Extract prediction ID from filename
// Format: "{model-slug}_{predictionId}_{resultIndex}.{ext}"
// Returns prediction ID (32 hex chars, no dashes) or null
function extractPredictionId(fileName: string): string | null {
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");
  const parts = nameWithoutExt.split("_");

  // Need at least 3 parts: model (1+), predictionId, resultIndex
  if (parts.length >= 3) {
    // Second to last part should be the prediction ID
    const predictionPart = parts[parts.length - 2];

    // Remove any dashes and check if it's 32 hex chars
    const cleanPart = predictionPart.replace(/-/g, "");
    if (cleanPart.length === 32 && /^[a-f0-9]+$/.test(cleanPart)) {
      return cleanPart; // Return without dashes (matching API format)
    }
  }
  return null;
}

// Extract result index from filename
function extractResultIndex(fileName: string): number {
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");
  const parts = nameWithoutExt.split("_");

  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    const index = parseInt(lastPart, 10);
    if (!isNaN(index)) {
      return index;
    }
  }
  return 0;
}

interface AssetsState {
  assets: AssetMetadata[];
  deletedAssets: Set<string>; // Registry of intentionally deleted {predictionId_resultIndex}
  isLoaded: boolean;
  isLoading: boolean;
  settings: AssetsSettings;

  // Folder and tag category state
  folders: AssetFolder[];
  tagCategories: TagCategory[];

  // Data loading
  loadAssets: () => Promise<void>;
  loadSettings: () => Promise<void>;
  loadFolders: () => Promise<void>;
  loadTagCategories: () => Promise<void>;
  loadDeletedAssets: () => Promise<void>;
  saveDeletedAssets: (deletedAssets: Set<string>) => Promise<void>;

  // Asset operations
  saveAsset: (
    url: string,
    type: AssetType,
    options: AssetsSaveOptions,
  ) => Promise<AssetMetadata | null>;
  registerLocalAsset: (
    filePath: string,
    type: AssetType,
    options: AssetsSaveOptions,
  ) => Promise<AssetMetadata | null>;
  deleteAsset: (id: string) => Promise<boolean>;
  deleteAssets: (ids: string[]) => Promise<number>;
  updateAsset: (
    id: string,
    updates: Partial<Pick<AssetMetadata, "tags" | "favorite" | "folderId">>,
  ) => Promise<void>;

  // Filtering
  getFilteredAssets: (filter: AssetsFilter) => AssetMetadata[];

  // Tag operations
  getAllTags: () => string[];
  getAllTagsWithCategories: () => Map<string, TagCategory | null>;
  getAllModels: () => string[];

  // Folder operations
  createFolder: (name: string, color: string) => Promise<AssetFolder>;
  updateFolder: (
    id: string,
    updates: Partial<Pick<AssetFolder, "name" | "color" | "icon">>,
  ) => Promise<void>;
  deleteFolder: (
    id: string,
    moveAssetsTo?: string | null,
  ) => Promise<void>;
  moveAssetsToFolder: (
    assetIds: string[],
    folderId: string | null,
  ) => Promise<void>;
  exportFolder: (
    folderId: string,
  ) => Promise<
    | { success: true; exportPath: string; copied: number; total: number; errors?: string[] }
    | { success: false; canceled: true }
    | { success: false; error: string }
  >;

  // Tag category operations
  createTagCategory: (
    name: string,
    color: TagColor,
    tags?: string[],
  ) => Promise<TagCategory>;
  updateTagCategory: (
    id: string,
    updates: Partial<Pick<TagCategory, "name" | "color" | "tags">>,
  ) => Promise<void>;
  deleteTagCategory: (id: string) => Promise<void>;

  // Settings
  setAutoSave: (enabled: boolean) => Promise<void>;
  setAssetsDirectory: (path: string) => Promise<void>;

  // Utilities
  openAssetLocation: (id: string) => Promise<void>;
  getAssetById: (id: string) => AssetMetadata | undefined;
  hasAssetForPrediction: (predictionId: string) => boolean;
  hasAssetForExecution: (executionId: string) => boolean;
  validateAssets: () => Promise<void>;
}

export const useAssetsStore = create<AssetsState>((set, get) => ({
  assets: [],
  deletedAssets: new Set<string>(),
  isLoaded: false,
  isLoading: false,
  settings: {
    autoSaveAssets: true,
    assetsDirectory: "",
  },
  folders: [],
  tagCategories: [],

  loadAssets: async () => {
    // Prevent duplicate loading
    if (get().isLoading) return;

    set({ isLoading: true });

    // Subscribe to new assets pushed from the workflow executor (Electron only, once)
    if (!assetsIpcListenerRegistered && window.electronAPI?.onAssetsNewAsset) {
      assetsIpcListenerRegistered = true;
      window.electronAPI.onAssetsNewAsset((raw) => {
        const asset = raw as AssetMetadata;
        if (!asset?.id) return;
        // Avoid duplicates
        const { assets } = useAssetsStore.getState();
        if (assets.some((a) => a.id === asset.id)) return;
        useAssetsStore.setState({ assets: [asset, ...assets] });
      });
    }

    try {
      if (window.electronAPI?.assetsGetFiltered) {
        try {
          // Load from database using cursor-based pagination (load all without hardcoded limit)
          const allAssets: AssetMetadata[] = [];
          let cursor: string | null = null;
          let totalLoaded = 0;
          const maxIterations = 1000; // Safety limit: 1000 * 500 = 500k max assets
          const seenCursors = new Set<string>();

          for (let i = 0; i < maxIterations; i++) {
            const result = await window.electronAPI.assetsGetFiltered({
              cursor: cursor || undefined,
              limit: 500, // Reasonable chunk size for performance
            });

            allAssets.push(...result.items);
            totalLoaded += result.items.length;

            const newCursor = result.nextCursor;

            // Stop if no more results
            if (!newCursor) break;

            // Detect circular cursor (bug)
            if (seenCursors.has(newCursor)) {
              console.error("[Assets] Circular cursor detected, stopping pagination");
              break;
            }
            seenCursors.add(newCursor);
            cursor = newCursor;
          }

          if (totalLoaded >= maxIterations * 500) {
            console.warn("[Assets] Reached pagination safety limit, some assets may not be loaded");
          }

          set({
            assets: allAssets,
            isLoaded: true,
            isLoading: false,
          });

          // Load folders and tag categories
          get().loadFolders();
          get().loadTagCategories();

          // Load deleted assets registry (legacy compatibility - can be phased out)
          get().loadDeletedAssets();
          return;
        } catch (ipcError) {
          // IPC handler not registered - fall back to JSON storage
          console.warn("[Assets] Database IPC not available, falling back to JSON:", ipcError);
        }
      }

      // Fallback: Browser/JSON mode - limited functionality
      const stored = localStorage.getItem(METADATA_STORAGE_KEY);
      set({
        assets: stored ? JSON.parse(stored) : [],
        isLoaded: true,
        isLoading: false,
      });
      // Load deleted assets in fallback mode
      get().loadDeletedAssets();
    } catch (error) {
      console.error("Failed to load assets:", error);
      set({ isLoaded: true, isLoading: false });
    }
  },

  loadSettings: async () => {
    if (window.electronAPI?.getAssetsSettings) {
      const settings = await window.electronAPI.getAssetsSettings();
      set({ settings });
    } else {
      // Browser fallback
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        set({ settings: JSON.parse(stored) });
      }
    }
  },

  saveAsset: async (url, type, options) => {
    const resultIndex = options.resultIndex ?? 0;

    // Check if this asset was intentionally deleted - don't re-save
    if (options.predictionId !== undefined) {
      const deletedKey = getDeletedAssetKey(options.predictionId, resultIndex);
      if (get().deletedAssets.has(deletedKey)) {
        // User deliberately deleted this, don't auto-save
        return null;
      }
    }

    // Check for duplicate: if asset with same predictionId + resultIndex exists, return it
    if (options.predictionId !== undefined) {
      const existing = get().assets.find(
        (a) =>
          a.predictionId === options.predictionId &&
          a.resultIndex === resultIndex,
      );
      if (existing) {
        return existing;
      }
    }

    const fileName = generateFileName(
      options.modelId,
      type,
      url,
      options.predictionId,
      resultIndex,
    );

    // Build optional workflow/source fields
    const extraFields: Partial<AssetMetadata> = {};
    if (options.source) extraFields.source = options.source;
    if (options.workflowId) extraFields.workflowId = options.workflowId;
    if (options.workflowName) extraFields.workflowName = options.workflowName;
    if (options.nodeId) extraFields.nodeId = options.nodeId;
    if (options.executionId) extraFields.executionId = options.executionId;

    // Desktop mode: save file to disk
    if (window.electronAPI?.saveAsset) {
      const subDir = getSubDir(type);
      const result = await window.electronAPI.saveAsset(
        url,
        type,
        fileName,
        subDir,
      );

      if (result.success && result.filePath) {
        const metadata: AssetMetadata = {
          id: generateId(),
          filePath: result.filePath,
          fileName,
          type,
          modelId: options.modelId,
          createdAt: new Date().toISOString(),
          fileSize: result.fileSize || 0,
          tags: [],
          favorite: false,
          predictionId: options.predictionId,
          resultIndex,
          originalUrl: url,
          ...extraFields,
        };

        // Remove from deleted registry if user manually re-saves
        let newDeletedAssets = get().deletedAssets;
        if (options.predictionId !== undefined) {
          newDeletedAssets = await removeFromDeletedRegistry(
            newDeletedAssets,
            options.predictionId,
            resultIndex,
          );
        }

        // IMPORTANT: Load latest metadata from disk to avoid race conditions
        // when multiple assets are saved simultaneously
        let currentAssets = get().assets;
        if (window.electronAPI?.getAssetsMetadata) {
          try {
            const diskMetadata = await window.electronAPI.getAssetsMetadata();
            if (diskMetadata && diskMetadata.length > 0) {
              currentAssets = diskMetadata;
            }
          } catch (e) {
            console.warn("Failed to load latest metadata from disk:", e);
          }
        }

        set(() => {
          const newAssets = [metadata, ...currentAssets];
          if (window.electronAPI?.saveAssetsMetadata) {
            window.electronAPI.saveAssetsMetadata(
              newAssets as Parameters<
                typeof window.electronAPI.saveAssetsMetadata
              >[0],
            );
          }
          return { assets: newAssets, deletedAssets: newDeletedAssets };
        });

        return metadata;
      }
      const reason = result.error || "Download failed";
      throw new Error(`Failed to save output: ${reason}`);
    }

    // Browser fallback: store URL reference only
    const metadata: AssetMetadata = {
      id: generateId(),
      filePath: "", // No local file in browser mode
      fileName,
      type,
      modelId: options.modelId,
      createdAt: new Date().toISOString(),
      fileSize: 0,
      tags: [],
      favorite: false,
      predictionId: options.predictionId,
      resultIndex,
      originalUrl: url,
      ...extraFields,
    };

    // Remove from deleted registry if user manually re-saves
    let newDeletedAssets = get().deletedAssets;
    if (options.predictionId !== undefined) {
      newDeletedAssets = await removeFromDeletedRegistry(
        newDeletedAssets,
        options.predictionId,
        resultIndex,
      );
    }

    // Load latest from localStorage to avoid race conditions
    let currentAssets = get().assets;
    try {
      const stored = localStorage.getItem(METADATA_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AssetMetadata[];
        if (parsed.length > currentAssets.length) {
          currentAssets = parsed;
        }
      }
    } catch (e) {
      console.warn("Failed to load latest metadata from localStorage:", e);
    }

    set(() => {
      const newAssets = [metadata, ...currentAssets];
      localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets));
      return { assets: newAssets, deletedAssets: newDeletedAssets };
    });

    return metadata;
  },

  registerLocalAsset: async (filePath, type, options) => {
    // Extract filename from path
    const fileName = filePath.split(/[/\\]/).pop() || "unknown";

    // Get file size if in Electron
    let fileSize = 0;
    if (window.electronAPI?.checkFileExists) {
      const exists = await window.electronAPI.checkFileExists(filePath);
      if (!exists) {
        console.error("File does not exist:", filePath);
        return null;
      }
    }

    const metadata: AssetMetadata = {
      id: generateId(),
      filePath,
      fileName,
      type,
      modelId: options.modelId,
      createdAt: new Date().toISOString(),
      fileSize,
      tags: [],
      favorite: false,
      predictionId: options.predictionId,
      originalUrl: options.originalUrl,
      source: options.source,
    };

    set((state) => {
      const newAssets = [metadata, ...state.assets];
      if (window.electronAPI?.saveAssetsMetadata) {
        window.electronAPI.saveAssetsMetadata(
          newAssets as Parameters<
            typeof window.electronAPI.saveAssetsMetadata
          >[0],
        );
      } else {
        localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets));
      }
      return { assets: newAssets };
    });

    return metadata;
  },

  deleteAsset: async (id) => {
    const { assets, deletedAssets } = get();
    const asset = assets.find((a) => a.id === id);
    if (!asset) return false;

    // Try to delete the file first
    if (window.electronAPI?.deleteAsset) {
      const result = await window.electronAPI.deleteAsset(asset.filePath);
      if (!result.success) {
        throw new Error(`Failed to delete asset file: ${result.error}`);
      }
    }

    // Delete from database
    if (window.electronAPI?.assetsDelete) {
      await window.electronAPI.assetsDelete(id);

      // Add to deleted registry to prevent re-syncing the same asset
      let newDeletedAssets = deletedAssets;
      if (asset.predictionId !== undefined) {
        const deletedKey = getDeletedAssetKey(asset.predictionId, asset.resultIndex ?? 0);
        newDeletedAssets = new Set(deletedAssets);
        newDeletedAssets.add(deletedKey);
        await get().saveDeletedAssets(newDeletedAssets);
      }

      // Update local state
      set((state) => {
        const newAssets = state.assets.filter((a) => a.id !== id);
        return { assets: newAssets, deletedAssets: newDeletedAssets };
      });
      return true;
    }

    // Fallback to old behavior
    // Add to deleted registry if it has a predictionId (to prevent re-saving during sync)
    let newDeletedAssets = deletedAssets;
    if (asset.predictionId !== undefined) {
      const deletedKey = getDeletedAssetKey(asset.predictionId, asset.resultIndex ?? 0);
      newDeletedAssets = new Set(deletedAssets);
      newDeletedAssets.add(deletedKey);
      // Save deleted registry
      await get().saveDeletedAssets(newDeletedAssets);
    }

    set((state) => {
      const newAssets = state.assets.filter((a) => a.id !== id);
      if (window.electronAPI?.saveAssetsMetadata) {
        window.electronAPI.saveAssetsMetadata(
          newAssets as Parameters<
            typeof window.electronAPI.saveAssetsMetadata
          >[0],
        );
      } else {
        localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets));
      }
      return { assets: newAssets, deletedAssets: newDeletedAssets };
    });

    return true;
  },

  deleteAssets: async (ids) => {
    const { assets } = get();
    const toDelete = assets.filter((a) => ids.includes(a.id));

    // Delete files first - if this fails, don't remove metadata
    if (window.electronAPI?.deleteAssetsBulk) {
      const filePaths = toDelete.map((a) => a.filePath);
      const result = await window.electronAPI.deleteAssetsBulk(filePaths);
      if (!result.success) {
        throw new Error(`Failed to delete some asset files`);
      }
    }

    // Delete from database
    if (window.electronAPI?.assetsDeleteMany) {
      await window.electronAPI.assetsDeleteMany(ids);

      // Track deleted assets to prevent re-sync
      const { deletedAssets } = get();
      let newDeletedAssets = deletedAssets;
      for (const asset of toDelete) {
        if (asset.predictionId !== undefined) {
          const deletedKey = getDeletedAssetKey(asset.predictionId, asset.resultIndex ?? 0);
          if (!newDeletedAssets) newDeletedAssets = new Set(deletedAssets);
          newDeletedAssets.add(deletedKey);
        }
      }
      await get().saveDeletedAssets(newDeletedAssets);

      // Update local state
      set((state) => {
        const newAssets = state.assets.filter((a) => !ids.includes(a.id));
        return { assets: newAssets, deletedAssets: newDeletedAssets };
      });
      return toDelete.length;
    }

    // Fallback to old behavior
    const { deletedAssets } = get();
    let newDeletedAssets = deletedAssets;
    for (const asset of toDelete) {
      if (asset.predictionId !== undefined) {
        if (!newDeletedAssets) newDeletedAssets = new Set(deletedAssets);
        const deletedKey = getDeletedAssetKey(asset.predictionId, asset.resultIndex ?? 0);
        newDeletedAssets.add(deletedKey);
      }
    }
    if (newDeletedAssets !== deletedAssets) {
      await get().saveDeletedAssets(newDeletedAssets);
    }

    set((state) => {
      const newAssets = state.assets.filter((a) => !ids.includes(a.id));
      if (window.electronAPI?.saveAssetsMetadata) {
        window.electronAPI.saveAssetsMetadata(
          newAssets as Parameters<
            typeof window.electronAPI.saveAssetsMetadata
          >[0],
        );
      } else {
        localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets));
      }
      return { assets: newAssets, deletedAssets: newDeletedAssets };
    });

    return toDelete.length;
  },

  updateAsset: async (id, updates) => {
    if (window.electronAPI?.assetsUpdate) {
      await window.electronAPI.assetsUpdate(id, updates);
      // Reload from database to ensure consistency
      const updated = await window.electronAPI.assetsGetById(id);
      if (updated) {
        set((state) => {
          const newAssets = state.assets.map((a) => (a.id === id ? updated : a));
          return { assets: newAssets };
        });
      }
    } else {
      // Browser fallback
      set((state) => {
        const newAssets = state.assets.map((a) =>
          a.id === id ? { ...a, ...updates } : a,
        );
        localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets));
        return { assets: newAssets };
      });
    }
  },

  getFilteredAssets: (filter) => {
    const { assets } = get();
    let filtered = [...assets];

    // Filter by types
    if (filter.types && filter.types.length > 0) {
      filtered = filtered.filter((a) => filter.types!.includes(a.type));
    }

    // Filter by models
    if (filter.models && filter.models.length > 0) {
      filtered = filtered.filter((a) => filter.models!.includes(a.modelId));
    }

    // Filter by source
    if (filter.sources && filter.sources.length > 0) {
      filtered = filtered.filter((a) => {
        const source =
          a.source ??
          (a.modelId === "local/z-image" ? "z-image" : "playground");
        return filter.sources!.includes(source);
      });
    }

    // Filter by date range
    if (filter.dateFrom) {
      const from = new Date(filter.dateFrom);
      filtered = filtered.filter((a) => new Date(a.createdAt) >= from);
    }
    if (filter.dateTo) {
      const to = new Date(filter.dateTo);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter((a) => new Date(a.createdAt) <= to);
    }

    // Filter by tags
    if (filter.tags && filter.tags.length > 0) {
      filtered = filtered.filter((a) =>
        filter.tags!.some((tag) => a.tags.includes(tag)),
      );
    }

    // Filter favorites only
    if (filter.favoritesOnly) {
      filtered = filtered.filter((a) => a.favorite);
    }

    // Filter by folder
    // null = show all assets (including legacy without folderId)
    // "__none__" = show only unassigned assets
    if (filter.folderId === "__none__") {
      filtered = filtered.filter((a) => !a.folderId);
    } else if (filter.folderId != null) {
      filtered = filtered.filter((a) => a.folderId === filter.folderId);
    }

    // Search
    if (filter.search && filter.search.trim()) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.fileName.toLowerCase().includes(search) ||
          a.modelId.toLowerCase().includes(search) ||
          a.tags.some((t) => t.toLowerCase().includes(search)),
      );
    }

    // Sort
    const sortBy = filter.sortBy || "date-desc";
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "date-desc":
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        case "date-asc":
          return (
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        case "name-asc":
          return a.fileName.localeCompare(b.fileName);
        case "name-desc":
          return b.fileName.localeCompare(a.fileName);
        case "size-desc":
          return b.fileSize - a.fileSize;
        case "size-asc":
          return a.fileSize - b.fileSize;
        default:
          return 0;
      }
    });

    return filtered;
  },

  getAllTags: () => {
    const { assets } = get();
    const tagsSet = new Set<string>();
    assets.forEach((a) => a.tags.forEach((t) => tagsSet.add(t)));
    return Array.from(tagsSet).sort();
  },

  getAllModels: () => {
    const { assets } = get();
    const modelIds = new Set<string>();
    assets.forEach((a) => modelIds.add(a.modelId));
    return Array.from(modelIds).sort();
  },

  setAutoSave: async (enabled) => {
    const newSettings = { ...get().settings, autoSaveAssets: enabled };
    if (window.electronAPI?.setAssetsSettings) {
      await window.electronAPI.setAssetsSettings({ autoSaveAssets: enabled });
    } else {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    }
    set({ settings: newSettings });
  },

  setAssetsDirectory: async (path) => {
    const newSettings = { ...get().settings, assetsDirectory: path };
    if (window.electronAPI?.setAssetsSettings) {
      await window.electronAPI.setAssetsSettings({ assetsDirectory: path });
    } else {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    }
    set({ settings: newSettings });
  },

  openAssetLocation: async (id) => {
    const asset = get().assets.find((a) => a.id === id);
    if (asset && window.electronAPI?.openFileLocation) {
      await window.electronAPI.openFileLocation(asset.filePath);
    }
  },

  getAssetById: (id) => {
    return get().assets.find((a) => a.id === id);
  },

  hasAssetForPrediction: (predictionId: string) => {
    return get().assets.some((a) => a.predictionId === predictionId);
  },

  hasAssetForExecution: (executionId: string) => {
    return get().assets.some((a) => a.executionId === executionId);
  },

  validateAssets: async () => {
    // No-op: assets are now loaded directly from disk scan, so validation is not needed
    // The loadAssets function scans actual files and merges with metadata
  },

  // ===== FOLDER OPERATIONS =====

  loadFolders: async () => {
    if (window.electronAPI?.foldersGetAll) {
      try {
        const folders = await window.electronAPI.foldersGetAll();
        set({ folders });
        return;
      } catch (ipcError) {
        console.warn("[Assets] Folders IPC not available, falling back to JSON:", ipcError);
      }
    }
    // Fallback to JSON storage
    const stored = localStorage.getItem(FOLDERS_STORAGE_KEY);
    set({ folders: stored ? JSON.parse(stored) : [] });
  },

  createFolder: async (name, color) => {
    if (window.electronAPI?.foldersCreate) {
      const id = await window.electronAPI.foldersCreate({ name, color });
      const folder: AssetFolder = {
        id,
        name,
        color,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({ folders: [...state.folders, folder] }));
      return folder;
    }

    // Fallback to old behavior
    const folder: AssetFolder = {
      id: generateId(),
      name,
      color,
      createdAt: new Date().toISOString(),
    };
    set((state) => {
      const newFolders = [...state.folders, folder];
      if (window.electronAPI?.saveAssetsFolders) {
        window.electronAPI.saveAssetsFolders(
          newFolders as Parameters<typeof window.electronAPI.saveAssetsFolders>[0],
        );
      } else {
        localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(newFolders));
      }
      return { folders: newFolders };
    });
    return folder;
  },

  updateFolder: async (id, updates) => {
    if (window.electronAPI?.foldersUpdate) {
      await window.electronAPI.foldersUpdate(id, updates);
      set((state) => ({
        folders: state.folders.map((f) =>
          f.id === id ? { ...f, ...updates } : f,
        ),
      }));
    } else {
      // Fallback to old behavior
      set((state) => {
        const newFolders = state.folders.map((f) =>
          f.id === id ? { ...f, ...updates } : f,
        );
        if (window.electronAPI?.saveAssetsFolders) {
          window.electronAPI.saveAssetsFolders(
            newFolders as Parameters<typeof window.electronAPI.saveAssetsFolders>[0],
          );
        } else {
          localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(newFolders));
        }
        return { folders: newFolders };
      });
    }
  },

  deleteFolder: async (id, moveAssetsTo) => {
    if (window.electronAPI?.foldersDelete) {
      await window.electronAPI.foldersDelete(id, moveAssetsTo);
      // Reload folders and assets from database to ensure consistency
      const folders = await window.electronAPI.foldersGetAll();
      set((state) => {
        const newAssets = moveAssetsTo !== undefined
          ? state.assets.map((a) =>
              a.folderId === id ? { ...a, folderId: moveAssetsTo } : a,
            )
          : state.assets.map((a) =>
              a.folderId === id ? { ...a, folderId: undefined } : a,
            );
        return { folders, assets: newAssets };
      });
    } else {
      // Fallback to old behavior
      set((state) => {
        const newFolders = state.folders.filter((f) => f.id !== id);
        const newAssets = moveAssetsTo !== undefined
          ? state.assets.map((a) =>
              a.folderId === id ? { ...a, folderId: moveAssetsTo } : a,
            )
          : state.assets.map((a) =>
              a.folderId === id ? { ...a, folderId: undefined } : a,
            );

        if (window.electronAPI?.saveAssetsFolders) {
          window.electronAPI.saveAssetsFolders(
            newFolders as Parameters<typeof window.electronAPI.saveAssetsFolders>[0],
          );
        } else {
          localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(newFolders));
        }

        if (window.electronAPI?.saveAssetsMetadata) {
          window.electronAPI.saveAssetsMetadata(
            newAssets as Parameters<typeof window.electronAPI.saveAssetsMetadata>[0],
          );
        } else {
          localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets));
        }

        return { folders: newFolders, assets: newAssets };
      });
    }
  },

  moveAssetsToFolder: async (assetIds, folderId) => {
    if (window.electronAPI?.assetsUpdate) {
      // Update each asset individually in the database
      for (const assetId of assetIds) {
        await window.electronAPI.assetsUpdate(assetId, { folderId });
      }
      // Update local state
      set((state) => ({
        assets: state.assets.map((a) =>
          assetIds.includes(a.id) ? { ...a, folderId: folderId || undefined } : a,
        ),
      }));
    } else {
      // Fallback to old behavior
      set((state) => {
        const newAssets = state.assets.map((a) =>
          assetIds.includes(a.id) ? { ...a, folderId: folderId || undefined } : a,
        );

        if (window.electronAPI?.saveAssetsMetadata) {
          window.electronAPI.saveAssetsMetadata(
            newAssets as Parameters<typeof window.electronAPI.saveAssetsMetadata>[0],
          );
        } else {
          localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(newAssets));
        }

        return { assets: newAssets };
      });
    }
  },

  exportFolder: async (folderId) => {
    const { assets, folders } = get();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) {
      throw new Error("Folder not found");
    }

    // Get all assets in this folder
    const folderAssets = assets.filter((a) => a.folderId === folderId);
    if (folderAssets.length === 0) {
      throw new Error("No assets in this folder");
    }

    if (window.electronAPI?.exportAssetsFolder) {
      const result = await window.electronAPI.exportAssetsFolder(
        folder.name,
        folderId,
        folderAssets.map((a) => a.filePath),
      );

      if (!result.success) {
        if ("canceled" in result && (result as { canceled: boolean }).canceled) {
          return { canceled: true };
        }
        throw new Error(result.error || "Export failed");
      }

      return {
        success: true,
        exportPath: (result as { exportPath?: string }).exportPath,
        copied: (result as { copied?: number }).copied,
        total: (result as { total?: number }).total,
        errors: (result as { errors?: string[] }).errors,
      };
    }

    throw new Error("Export not supported in browser mode");
  },

  // ===== TAG CATEGORY OPERATIONS =====

  loadTagCategories: async () => {
    if (window.electronAPI?.tagCategoriesGetAll) {
      try {
        const tagCategories = await window.electronAPI.tagCategoriesGetAll();
        set({ tagCategories });
        return;
      } catch (ipcError) {
        console.warn("[Assets] Tag categories IPC not available, falling back to JSON:", ipcError);
      }
    }
    // Fallback to JSON storage
    const stored = localStorage.getItem(TAG_CATEGORIES_STORAGE_KEY);
    set({ tagCategories: stored ? JSON.parse(stored) : [] });
  },

  loadDeletedAssets: async () => {
    try {
      let deleted: string[] = [];
      if (window.electronAPI?.getDeletedAssets) {
        deleted = await window.electronAPI.getDeletedAssets();
      } else {
        const stored = localStorage.getItem(DELETED_ASSETS_KEY);
        deleted = stored ? JSON.parse(stored) : [];
      }
      set({ deletedAssets: new Set(deleted) });
    } catch {
      set({ deletedAssets: new Set() });
    }
  },

  saveDeletedAssets: async (deletedAssets: Set<string>) => {
    const deletedArray = Array.from(deletedAssets);
    if (window.electronAPI?.saveDeletedAssets) {
      await window.electronAPI.saveDeletedAssets(deletedArray);
    } else {
      localStorage.setItem(DELETED_ASSETS_KEY, JSON.stringify(deletedArray));
    }
  },

  createTagCategory: async (name, color, tags = []) => {
    if (window.electronAPI?.tagCategoriesCreate) {
      const id = await window.electronAPI.tagCategoriesCreate(name, color, tags);
      const category: TagCategory = {
        id,
        name,
        color,
        tags,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({ tagCategories: [...state.tagCategories, category] }));
      return category;
    }

    // Fallback to old behavior
    const category: TagCategory = {
      id: generateId(),
      name,
      color,
      tags,
      createdAt: new Date().toISOString(),
    };
    set((state) => {
      const newCategories = [...state.tagCategories, category];
      if (window.electronAPI?.saveAssetsTagCategories) {
        window.electronAPI.saveAssetsTagCategories(
          newCategories as Parameters<typeof window.electronAPI.saveAssetsTagCategories>[0],
        );
      } else {
        localStorage.setItem(TAG_CATEGORIES_STORAGE_KEY, JSON.stringify(newCategories));
      }
      return { tagCategories: newCategories };
    });
    return category;
  },

  updateTagCategory: async (id, updates) => {
    if (window.electronAPI?.tagCategoriesUpdate) {
      await window.electronAPI.tagCategoriesUpdate(id, updates);
      set((state) => ({
        tagCategories: state.tagCategories.map((c) =>
          c.id === id ? { ...c, ...updates } : c,
        ),
      }));
    } else {
      // Fallback to old behavior
      set((state) => {
        const newCategories = state.tagCategories.map((c) =>
          c.id === id ? { ...c, ...updates } : c,
        );
        if (window.electronAPI?.saveAssetsTagCategories) {
          window.electronAPI.saveAssetsTagCategories(
            newCategories as Parameters<typeof window.electronAPI.saveAssetsTagCategories>[0],
          );
        } else {
          localStorage.setItem(TAG_CATEGORIES_STORAGE_KEY, JSON.stringify(newCategories));
        }
        return { tagCategories: newCategories };
      });
    }
  },

  deleteTagCategory: async (id) => {
    if (window.electronAPI?.tagCategoriesDelete) {
      await window.electronAPI.tagCategoriesDelete(id);
      set((state) => ({
        tagCategories: state.tagCategories.filter((c) => c.id !== id),
      }));
    } else {
      // Fallback to old behavior
      set((state) => {
        const newCategories = state.tagCategories.filter((c) => c.id !== id);
        if (window.electronAPI?.saveAssetsTagCategories) {
          window.electronAPI.saveAssetsTagCategories(
            newCategories as Parameters<typeof window.electronAPI.saveAssetsTagCategories>[0],
          );
        } else {
          localStorage.setItem(TAG_CATEGORIES_STORAGE_KEY, JSON.stringify(newCategories));
        }
        return { tagCategories: newCategories };
      });
    }
  },

  getAllTagsWithCategories: () => {
    const { assets, tagCategories } = get();
    const tagMap = new Map<string, TagCategory | null>();

    // Collect all tags from assets
    const allTags = new Set<string>();
    assets.forEach((a) => a.tags.forEach((t) => allTags.add(t)));

    // Map tags to their categories
    tagCategories.forEach((category) => {
      category.tags.forEach((tag) => {
        if (allTags.has(tag)) {
          tagMap.set(tag, category);
        }
      });
    });

    // Tags without categories remain as null
    allTags.forEach((tag) => {
      if (!tagMap.has(tag)) {
        tagMap.set(tag, null);
      }
    });

    return tagMap;
  },
}));
