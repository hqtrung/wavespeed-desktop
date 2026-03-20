import { contextBridge, ipcRenderer } from "electron";

interface Settings {
  theme: "light" | "dark" | "system";
  defaultPollInterval: number;
  defaultTimeout: number;
  updateChannel: "stable" | "nightly";
  autoCheckUpdate: boolean;
  language?: string;
}

interface UpdateStatus {
  status: string;
  version?: string;
  releaseNotes?: string | null;
  releaseDate?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
}

interface UpdateCheckResult {
  status: string;
  updateInfo?: {
    version: string;
    releaseNotes?: string | null;
  };
  message?: string;
}

interface DownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
  canceled?: boolean;
}

interface AssetsSettings {
  autoSaveAssets: boolean;
  assetsDirectory: string;
}

interface SaveAssetResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  error?: string;
}

interface DeleteAssetResult {
  success: boolean;
  error?: string;
}

interface DeleteAssetsBulkResult {
  success: boolean;
  deleted: number;
}

interface SelectDirectoryResult {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

interface AssetMetadata {
  id: string;
  filePath: string;
  fileName: string;
  type: "image" | "video" | "audio" | "text" | "json";
  modelId: string;
  modelName: string;
  createdAt: string;
  fileSize: number;
  tags: string[];
  favorite: boolean;
  predictionId?: string;
  originalUrl?: string;
}

const electronAPI = {
  getApiKey: (): Promise<string> => ipcRenderer.invoke("get-api-key"),
  setApiKey: (apiKey: string): Promise<boolean> =>
    ipcRenderer.invoke("set-api-key", apiKey),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("get-settings"),
  setSettings: (settings: Partial<Settings>): Promise<boolean> =>
    ipcRenderer.invoke("set-settings", settings),
  clearAllData: (): Promise<boolean> => ipcRenderer.invoke("clear-all-data"),
  downloadFile: (
    url: string,
    defaultFilename: string,
  ): Promise<DownloadResult> =>
    ipcRenderer.invoke("download-file", url, defaultFilename),
  saveFileSilent: (
    url: string,
    dir: string,
    fileName: string,
  ): Promise<DownloadResult> =>
    ipcRenderer.invoke("save-file-silent", url, dir, fileName),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("open-external", url),

  // Web authentication (OAuth for /center/* endpoints)
  webAuthSignIn: (): Promise<{ success: boolean; token?: string; error?: string }> =>
    ipcRenderer.invoke("web-auth-sign-in"),
  webAuthRequest: (
    token: string,
    endpoint: string,
    method?: "GET" | "POST",
    body?: unknown,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke("web-auth-request", token, endpoint, method, body),
  getWebAuthToken: (): Promise<string | null> => ipcRenderer.invoke("get-web-auth-token"),
  setWebAuthToken: (token: string): Promise<boolean> => ipcRenderer.invoke("set-web-auth-token", token),
  removeWebAuthToken: (): Promise<boolean> => ipcRenderer.invoke("remove-web-auth-token"),

  // Title bar theme
  updateTitlebarTheme: (isDark: boolean): Promise<void> =>
    ipcRenderer.invoke("update-titlebar-theme", isDark),

  // Auto-updater APIs
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("get-app-version"),
  getLogFilePath: (): Promise<string> =>
    ipcRenderer.invoke("get-log-file-path"),
  openLogDirectory: (): Promise<{ success: boolean; path: string }> =>
    ipcRenderer.invoke("open-log-directory"),
  checkForUpdates: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: (): Promise<{ status: string; message?: string }> =>
    ipcRenderer.invoke("download-update"),
  installUpdate: (): void => {
    ipcRenderer.invoke("install-update");
  },
  setUpdateChannel: (channel: "stable" | "nightly"): Promise<boolean> =>
    ipcRenderer.invoke("set-update-channel", channel),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_: unknown, status: UpdateStatus) => callback(status);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },

  // Assets APIs
  getAssetsSettings: (): Promise<AssetsSettings> =>
    ipcRenderer.invoke("get-assets-settings"),
  setAssetsSettings: (settings: Partial<AssetsSettings>): Promise<boolean> =>
    ipcRenderer.invoke("set-assets-settings", settings),
  getDefaultAssetsDirectory: (): Promise<string> =>
    ipcRenderer.invoke("get-default-assets-directory"),
  getZImageOutputPath: (): Promise<string> =>
    ipcRenderer.invoke("get-zimage-output-path"),
  selectDirectory: (): Promise<SelectDirectoryResult> =>
    ipcRenderer.invoke("select-directory"),
  saveAsset: (
    url: string,
    type: string,
    fileName: string,
    subDir: string,
  ): Promise<SaveAssetResult> =>
    ipcRenderer.invoke("save-asset", url, type, fileName, subDir),
  deleteAsset: (filePath: string): Promise<DeleteAssetResult> =>
    ipcRenderer.invoke("delete-asset", filePath),
  deleteAssetsBulk: (filePaths: string[]): Promise<DeleteAssetsBulkResult> =>
    ipcRenderer.invoke("delete-assets-bulk", filePaths),
  getAssetsMetadata: (): Promise<AssetMetadata[]> =>
    ipcRenderer.invoke("get-assets-metadata"),
  saveAssetsMetadata: (metadata: AssetMetadata[]): Promise<boolean> =>
    ipcRenderer.invoke("save-assets-metadata", metadata),
  openFileLocation: (filePath: string): Promise<DeleteAssetResult> =>
    ipcRenderer.invoke("open-file-location", filePath),
  checkFileExists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke("check-file-exists", filePath),
  openAssetsFolder: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("open-assets-folder"),
  scanAssetsDirectory: (): Promise<
    Array<{
      filePath: string;
      fileName: string;
      type: "image" | "video" | "audio" | "text";
      fileSize: number;
      createdAt: string;
    }>
  > => ipcRenderer.invoke("scan-assets-directory"),
  getAssetsFolders: (): Promise<
    Array<{
      id: string;
      name: string;
      color: string;
      icon?: string;
      createdAt: string;
    }>
  > => ipcRenderer.invoke("get-assets-folders"),
  saveAssetsFolders: (
    folders: Array<{
      id: string;
      name: string;
      color: string;
      icon?: string;
      createdAt: string;
    }>,
  ): Promise<boolean> => ipcRenderer.invoke("save-assets-folders", folders),
  getAssetsTagCategories: (): Promise<
    Array<{
      id: string;
      name: string;
      color: "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink";
      tags: string[];
      createdAt: string;
    }>
  > => ipcRenderer.invoke("get-assets-tag-categories"),
  saveAssetsTagCategories: (
    categories: Array<{
      id: string;
      name: string;
      color: "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink";
      tags: string[];
      createdAt: string;
    }>,
  ): Promise<boolean> => ipcRenderer.invoke("save-assets-tag-categories", categories),
  exportAssetsFolder: (
    folderName: string,
    folderId: string,
    assetFilePaths: string[],
  ) => ipcRenderer.invoke("export-assets-folder", folderName, folderId, assetFilePaths),
  onAssetsExportProgress: (
    callback: (data: {
      phase: string;
      progress: number;
      current: number;
      total: number;
      errors?: string[];
    }) => void,
  ): (() => void) => {
    const handler = (_: unknown, data: unknown) =>
      callback(data as {
        phase: string;
        progress: number;
        current: number;
        total: number;
        errors?: string[];
      });
    ipcRenderer.on("assets-export-progress", handler);
    return () => ipcRenderer.removeListener("assets-export-progress", handler);
  },

  // === Database-based Assets APIs ===
  assetsGetFiltered: (filter: {
    types?: string[];
    models?: string[];
    sources?: string[];
    dateFrom?: string;
    dateTo?: string;
    favoritesOnly?: boolean;
    folderId?: string | null;
    search?: string;
    limit?: number;
    cursor?: string;
  }) => ipcRenderer.invoke("assets:get-filtered", filter),
  assetsGetById: (id: string) => ipcRenderer.invoke("assets:get-by-id", id),
  assetsGetByExecution: (executionId: string) => ipcRenderer.invoke("assets:get-by-execution", executionId),
  assetsInsert: (asset: Omit<AssetMetadata, "tags"> & { tags: string[] }) =>
    ipcRenderer.invoke("assets:insert", asset),
  assetsUpdate: (
    id: string,
    updates: { tags?: string[]; favorite?: boolean; folderId?: string | null },
  ) => ipcRenderer.invoke("assets:update", id, updates),
  assetsDelete: (id: string) => ipcRenderer.invoke("assets:delete", id),
  assetsDeleteMany: (ids: string[]) => ipcRenderer.invoke("assets:delete-many", ids),
  assetsGetAllTags: () => ipcRenderer.invoke("assets:get-all-tags"),
  assetsGetAllModels: () => ipcRenderer.invoke("assets:get-all-models"),
  assetsHasForPrediction: (predictionId: string) => ipcRenderer.invoke("assets:has-for-prediction", predictionId),
  assetsHasForExecution: (executionId: string) => ipcRenderer.invoke("assets:has-for-execution", executionId),
  assetsMarkPending: (id: string) => ipcRenderer.invoke("assets:mark-pending", id),

  // Folder APIs
  foldersGetAll: () => ipcRenderer.invoke("folders:get-all"),
  foldersGetById: (id: string) => ipcRenderer.invoke("folders:get-by-id", id),
  foldersCreate: (folder: { name: string; color: string; icon?: string }) =>
    ipcRenderer.invoke("folders:create", folder),
  foldersUpdate: (
    id: string,
    updates: { name?: string; color?: string; icon?: string },
  ) => ipcRenderer.invoke("folders:update", id, updates),
  foldersDelete: (id: string, moveAssetsTo?: string | null) =>
    ipcRenderer.invoke("folders:delete", id, moveAssetsTo),
  foldersGetAssetCount: (folderId: string) => ipcRenderer.invoke("folders:get-asset-count", folderId),
  foldersImportBackup: (backupPath: string) => ipcRenderer.invoke("assets:import-folders-backup", backupPath),

  // Tag Category APIs
  tagCategoriesGetAll: () => ipcRenderer.invoke("tag-categories:get-all"),
  tagCategoriesGetById: (id: string) => ipcRenderer.invoke("tag-categories:get-by-id", id),
  tagCategoriesCreate: (name: string, color: string, tags?: string[]) =>
    ipcRenderer.invoke("tag-categories:create", name, color, tags),
  tagCategoriesUpdate: (
    id: string,
    updates: { name?: string; color?: string; tags?: string[] },
  ) => ipcRenderer.invoke("tag-categories:update", id, updates),
  tagCategoriesDelete: (id: string) => ipcRenderer.invoke("tag-categories:delete", id),

  // Sync State APIs
  syncGetPending: () => ipcRenderer.invoke("sync:get-pending"),
  syncGetState: (key: string) => ipcRenderer.invoke("sync:get-state", key),
  syncGetFullState: () => ipcRenderer.invoke("sync:get-full-state"),
  syncSetState: (key: string, value: string) => ipcRenderer.invoke("sync:set-state", key, value),
  syncGetDeleted: () => ipcRenderer.invoke("sync:get-deleted"),
  syncUpdateLastSync: () => ipcRenderer.invoke("sync:update-last-sync"),
  syncIsEnabled: () => ipcRenderer.invoke("sync:is-enabled"),
  syncSetEnabled: (enabled: boolean) => ipcRenderer.invoke("sync:set-enabled", enabled),
  syncGetRecentLog: (limit?: number) => ipcRenderer.invoke("sync:get-recent-log", limit),
  syncLogEvent: (entry: {
    entityType: string;
    entityId: string;
    operation: "create" | "update" | "delete" | "move";
    deviceId?: string;
    version?: number;
  }) => ipcRenderer.invoke("sync:log-event", entry),

  // Cloud Sync APIs
  syncGetStatus: () => ipcRenderer.invoke("sync:get-status"),
  syncStart: () => ipcRenderer.invoke("sync:start"),
  syncConfigure: (config: {
    accountId: string;
    databaseId: string;
    apiToken: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    userId?: string;
    deviceId?: string;
    publicUrl?: string;
  }) => ipcRenderer.invoke("sync:configure", config),
  syncDisconnect: () => ipcRenderer.invoke("sync:disconnect"),
  syncTestConnection: (config: {
    accountId: string;
    databaseId: string;
    apiToken: string;
  }) => ipcRenderer.invoke("sync:test-connection", config),
  syncGetConfig: () => ipcRenderer.invoke("sync:get-config"),
  syncInitSchema: () => ipcRenderer.invoke("sync:init-schema"),
  syncTriggersUpdate: (config: { timerEnabled?: boolean; intervalMinutes?: number }) =>
    ipcRenderer.invoke("sync:triggers-update", config),
  syncTriggersGet: () => ipcRenderer.invoke("sync:triggers-get"),

  // === R2 Storage Configuration APIs ===
  r2GetConfig: () => ipcRenderer.invoke("r2:get-config"),
  r2SetConfig: (config: {
    accountId?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicUrl?: string;
  }) => ipcRenderer.invoke("r2:set-config", config),
  r2ClearConfig: () => ipcRenderer.invoke("r2:clear-config"),
  r2UploadAllAssets: () => ipcRenderer.invoke("r2:upload-all-assets"),

  // Listen for R2 upload progress updates
  onR2UploadProgress: (
    callback: (data: {
      total: number;
      uploaded: number;
      skipped: number;
      failed: number;
      processed: number;
      current: string;
      fileProgress?: {
        assetId: string;
        fileName: string;
        bytesUploaded: number;
        totalBytes: number;
        percentage: number;
      };
    }) => void,
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as Parameters<typeof callback>[0]);
    ipcRenderer.on("r2:upload-progress", listener);
    return () => ipcRenderer.removeListener("r2:upload-progress", listener);
  },

  // === Hybrid Asset Storage APIs ===
  assetsGetFile: (id: string) => ipcRenderer.invoke("assets:get-file", id),
  assetsDownloadToCache: (id: string) => ipcRenderer.invoke("assets:download-to-cache", id),
  assetsGetCacheStats: () => ipcRenderer.invoke("assets:get-cache-stats"),
  assetsClearCache: () => ipcRenderer.invoke("assets:clear-cache"),
  assetsSetCacheLimit: (maxBytes: number) => ipcRenderer.invoke("assets:set-cache-limit", maxBytes),
  assetsSyncQueueStats: () => ipcRenderer.invoke("assets:sync-queue-stats"),
  assetsSyncQueueMissing: (maxItems?: number) => ipcRenderer.invoke("assets:sync-queue-missing", maxItems),
  assetsSyncQueueStart: () => ipcRenderer.invoke("assets:sync-queue-start"),
  assetsSyncQueueCancel: () => ipcRenderer.invoke("assets:sync-queue-cancel"),
  assetsSyncQueueClear: () => ipcRenderer.invoke("assets:sync-queue-clear"),
  assetsSyncQueueRetry: () => ipcRenderer.invoke("assets:sync-queue-retry"),

  // Listen for sync queue progress updates
  onAssetsSyncProgress: (
    callback: (data: {
      assetId: string;
      fileName: string;
      bytesDownloaded: number;
      totalBytes: number;
      percentage: number;
    }) => void,
  ): (() => void) => {
    const handler = (_: unknown, data: unknown) =>
      callback(data as {
        assetId: string;
        fileName: string;
        bytesDownloaded: number;
        totalBytes: number;
        percentage: number;
      });
    ipcRenderer.on("assets:sync-progress", handler);
    return () => ipcRenderer.removeListener("assets:sync-progress", handler);
  },

  // Listen for sync queue statistics updates
  onAssetsSyncStats: (
    callback: (stats: {
      pending: number;
      downloaded: number;
      failed: number;
      isProcessing: boolean;
    }) => void,
  ): (() => void) => {
    const handler = (_: unknown, stats: unknown) =>
      callback(stats as {
        pending: number;
        downloaded: number;
        failed: number;
        isProcessing: boolean;
      });
    ipcRenderer.on("assets:sync-stats", handler);
    return () => ipcRenderer.removeListener("assets:sync-stats", handler);
  },

  // Stable Diffusion APIs
  sdGetBinaryPath: (): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> => ipcRenderer.invoke("sd-get-binary-path"),
  sdGetSystemInfo: (): Promise<{
    platform: string;
    arch: string;
    acceleration: string;
    supported: boolean;
  }> => ipcRenderer.invoke("sd-get-system-info"),
  sdGetGpuVramMb: (): Promise<{
    success: boolean;
    vramMb: number | null;
    error?: string;
  }> => ipcRenderer.invoke("sd-get-gpu-vram"),
  sdCheckAuxiliaryModels: (): Promise<{
    success: boolean;
    llmExists: boolean;
    vaeExists: boolean;
    llmPath: string;
    vaePath: string;
    error?: string;
  }> => ipcRenderer.invoke("sd-check-auxiliary-models"),
  sdListAuxiliaryModels: (): Promise<{
    success: boolean;
    models?: Array<{
      name: string;
      path: string;
      size: number;
      type: "llm" | "vae";
    }>;
    error?: string;
  }> => ipcRenderer.invoke("sd-list-auxiliary-models"),
  sdDeleteAuxiliaryModel: (
    type: "llm" | "vae",
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("sd-delete-auxiliary-model", type),
  sdGenerateImage: (params: {
    modelPath: string;
    llmPath?: string;
    vaePath?: string;
    lowVramMode?: boolean;
    vaeTiling?: boolean;
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    seed?: number;
    outputPath: string;
  }): Promise<{ success: boolean; outputPath?: string; error?: string }> =>
    ipcRenderer.invoke("sd-generate-image", params),
  sdCancelGeneration: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("sd-cancel-generation"),
  sdSaveModelFromCache: (
    filename: string,
    data: Uint8Array,
    type: "model" | "llm" | "vae",
  ): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke("sd-save-model-from-cache", filename, data, type),
  sdListModels: (): Promise<{
    success: boolean;
    models?: Array<{
      name: string;
      path: string;
      size: number;
      createdAt: string;
    }>;
    error?: string;
  }> => ipcRenderer.invoke("sd-list-models"),
  sdDeleteModel: (
    modelPath: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("sd-delete-model", modelPath),
  sdDeleteBinary: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("sd-delete-binary"),
  getFileSize: (filePath: string): Promise<number> =>
    ipcRenderer.invoke("get-file-size", filePath),
  onSdProgress: (
    callback: (data: {
      phase: string;
      progress: number;
      detail?: unknown;
    }) => void,
  ): (() => void) => {
    const handler = (_: unknown, data: unknown) =>
      callback(data as { phase: string; progress: number; detail?: unknown });
    ipcRenderer.on("sd-progress", handler);
    return () => ipcRenderer.removeListener("sd-progress", handler);
  },
  onSdLog: (
    callback: (data: { type: "stdout" | "stderr"; message: string }) => void,
  ): (() => void) => {
    const handler = (_: unknown, data: unknown) =>
      callback(data as { type: "stdout" | "stderr"; message: string });
    ipcRenderer.on("sd-log", handler);
    return () => ipcRenderer.removeListener("sd-log", handler);
  },
  onSdDownloadProgress: (
    callback: (data: {
      phase: string;
      progress: number;
      detail?: unknown;
    }) => void,
  ): (() => void) => {
    const handler = (_: unknown, data: unknown) =>
      callback(data as { phase: string; progress: number; detail?: unknown });
    ipcRenderer.on("sd-download-progress", handler);
    return () => ipcRenderer.removeListener("sd-download-progress", handler);
  },
  onSdBinaryDownloadProgress: (
    callback: (data: {
      phase: string;
      progress: number;
      detail?: unknown;
    }) => void,
  ): (() => void) => {
    const handler = (_: unknown, data: unknown) =>
      callback(data as { phase: string; progress: number; detail?: unknown });
    ipcRenderer.on("sd-binary-download-progress", handler);
    return () =>
      ipcRenderer.removeListener("sd-binary-download-progress", handler);
  },
  onSdLlmDownloadProgress: (
    callback: (data: {
      phase: string;
      progress: number;
      detail?: unknown;
    }) => void,
  ): (() => void) => {
    const handler = (_: unknown, data: unknown) =>
      callback(data as { phase: string; progress: number; detail?: unknown });
    ipcRenderer.on("sd-llm-download-progress", handler);
    return () =>
      ipcRenderer.removeListener("sd-llm-download-progress", handler);
  },
  onSdVaeDownloadProgress: (
    callback: (data: {
      phase: string;
      progress: number;
      detail?: unknown;
    }) => void,
  ): (() => void) => {
    const handler = (_: unknown, data: unknown) =>
      callback(data as { phase: string; progress: number; detail?: unknown });
    ipcRenderer.on("sd-vae-download-progress", handler);
    return () =>
      ipcRenderer.removeListener("sd-vae-download-progress", handler);
  },

  // File operations for chunked downloads
  fileGetSize: (
    filePath: string,
  ): Promise<{ success: boolean; size?: number; error?: string }> =>
    ipcRenderer.invoke("file-get-size", filePath),
  fileAppendChunk: (
    filePath: string,
    chunk: ArrayBuffer,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("file-append-chunk", filePath, chunk),
  fileRename: (
    oldPath: string,
    newPath: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("file-rename", oldPath, newPath),
  fileDelete: (
    filePath: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("file-delete", filePath),

  // SD download path helpers for chunked downloads
  sdGetBinaryDownloadPath: (): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> => ipcRenderer.invoke("sd-get-binary-download-path"),
  sdGetAuxiliaryModelDownloadPath: (
    type: "llm" | "vae",
  ): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("sd-get-auxiliary-model-download-path", type),
  sdGetModelsDir: (): Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }> => ipcRenderer.invoke("sd-get-models-dir"),
  sdExtractBinary: (
    zipPath: string,
    destPath: string,
  ): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("sd-extract-binary", zipPath, destPath),

  // Persistent key-value state (survives app restarts, unlike renderer localStorage)
  getState: (key: string): Promise<unknown> =>
    ipcRenderer.invoke("get-state", key),
  setState: (key: string, value: unknown): Promise<boolean> =>
    ipcRenderer.invoke("set-state", key, value),
  removeState: (key: string): Promise<boolean> =>
    ipcRenderer.invoke("remove-state", key),

  // Assets event listener (workflow executor pushes new assets)
  onAssetsNewAsset: (callback: (asset: unknown) => void): (() => void) => {
    const handler = (_: unknown, asset: unknown) => callback(asset);
    ipcRenderer.on("assets:new-asset", handler);
    return () => ipcRenderer.removeListener("assets:new-asset", handler);
  },

  // Deleted assets registry (prevents re-syncing intentionally deleted assets)
  getDeletedAssets: (): Promise<string[]> =>
    ipcRenderer.invoke("get-deleted-assets"),
  saveDeletedAssets: (deletedAssets: string[]): Promise<void> =>
    ipcRenderer.invoke("save-deleted-assets", deletedAssets),

  // History cache APIs
  historyCacheList: (
    options: { limit?: number; offset?: number; status?: string },
  ): Promise<unknown[]> =>
    ipcRenderer.invoke("history-cache:list", options),
  historyCacheGet: (id: string): Promise<unknown> =>
    ipcRenderer.invoke("history-cache:get", id),
  historyCacheUpsert: (
    item: unknown,
  ): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("history-cache:upsert", item),
  historyCacheUpsertBulk: (
    items: unknown[],
  ): Promise<{ success: boolean; count: number }> =>
    ipcRenderer.invoke("history-cache:upsert-bulk", items),
  historyCacheDelete: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("history-cache:delete", id),
  historyCacheStats: (): Promise<{
    totalCount: number;
    lastSyncTime: string | null;
  }> => ipcRenderer.invoke("history-cache:stats"),
  historyCacheClear: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("history-cache:clear"),
  historyCacheSyncWithImages: (data: {
    historyItems: unknown[];
    detailItems: Array<{ id: string; input?: Record<string, unknown> }>;
  }): Promise<{
    success: boolean;
    count: number;
    errors: string[];
  }> => ipcRenderer.invoke("history-cache:sync-with-images", data),
  historyCacheIsSyncing: (): Promise<boolean> =>
    ipcRenderer.invoke("history-cache:is-syncing"),
  historyCacheSyncFromLocalStorage: (localStorageData: string): Promise<{
    success: boolean;
    count: number;
    errors: string[];
  }> => ipcRenderer.invoke("history-cache:sync-from-local-storage", localStorageData),
  onHistoryCacheSyncProgress: (
    callback: (progress: {
      stage: "fetching" | "downloading" | "complete";
      current: number;
      total: number;
      percentage: number;
    }) => void,
  ): (() => void) => {
    const handler = (_: unknown, progress: unknown) => callback(progress as {
      stage: "fetching" | "downloading" | "complete";
      current: number;
      total: number;
      percentage: number;
    });
    ipcRenderer.on("history-cache:sync-progress", handler);
    return () => ipcRenderer.removeListener("history-cache:sync-progress", handler);
  },
};

// ─── Workflow API (isolated namespace to avoid collision with electronAPI) ────
const workflowAPI = {
  invoke: (channel: string, args?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, args),
  on: (channel: string, callback: (...args: unknown[]) => void): void => {
    const handler = (_event: unknown, ...rest: unknown[]) => callback(...rest);
    ipcRenderer.on(channel, handler);
    // Store handler reference for removal
    (workflowAPI as Record<string, unknown>)[
      `__handler_${channel}_${callback.toString().slice(0, 50)}`
    ] = handler;
  },
  removeListener: (
    channel: string,
    _callback: (...args: unknown[]) => void,
  ): void => {
    // Best-effort removal — remove all listeners for this channel
    ipcRenderer.removeAllListeners(channel);
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electronAPI", electronAPI);
    contextBridge.exposeInMainWorld("workflowAPI", workflowAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore - fallback for non-isolated context
  window.electronAPI = electronAPI;
  // @ts-ignore
  window.workflowAPI = workflowAPI;
}
