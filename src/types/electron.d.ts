export interface DownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
  canceled?: boolean;
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

export interface DeleteAssetsBulkResult {
  success: boolean;
  deleted: number;
}

export interface SelectDirectoryResult {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export interface AssetMetadataElectron {
  id: string;
  filePath: string;
  fileName: string;
  type: "image" | "video" | "audio" | "text" | "json";
  modelId: string;
  createdAt: string;
  fileSize: number;
  tags: string[];
  favorite: boolean;
  predictionId?: string;
  originalUrl?: string;
  source?: "playground" | "workflow" | "free-tool" | "z-image";
  workflowId?: string;
  workflowName?: string;
  nodeId?: string;
  executionId?: string;
}

export interface UpdateStatus {
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

export interface UpdateCheckResult {
  status: string;
  updateInfo?: {
    version: string;
    releaseNotes?: string | null;
  };
  message?: string;
}

export interface SDGenerationParams {
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
  samplingMethod?: string;
  scheduler?: string;
  outputPath: string;
}

export interface SDProgressData {
  phase: string;
  progress: number;
  detail?: {
    current?: number;
    total?: number;
    unit?: "bytes" | "steps" | "percent";
  };
}

export interface SDModelInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface ElectronAPI {
  getApiKey: () => Promise<string>;
  setApiKey: (apiKey: string) => Promise<boolean>;
  getSettings: () => Promise<{
    theme: "light" | "dark" | "system";
    defaultPollInterval: number;
    defaultTimeout: number;
    updateChannel: "stable" | "nightly";
    autoCheckUpdate: boolean;
    language?: string;
  }>;
  setSettings: (settings: Record<string, unknown>) => Promise<boolean>;
  clearAllData: () => Promise<boolean>;
  downloadFile: (
    url: string,
    defaultFilename: string,
  ) => Promise<DownloadResult>;
  saveFileSilent: (
    url: string,
    dir: string,
    fileName: string,
  ) => Promise<DownloadResult>;
  openExternal: (url: string) => Promise<void>;

  // Web authentication (OAuth for /center/* endpoints)
  webAuthSignIn: () => Promise<{ success: boolean; token?: string; error?: string }>;
  webAuthRequest: (
    token: string,
    endpoint: string,
    method?: "GET" | "POST",
    body?: unknown,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  getWebAuthToken: () => Promise<string | null>;
  setWebAuthToken: (token: string) => Promise<boolean>;
  removeWebAuthToken: () => Promise<boolean>;

  // Title bar theme
  updateTitlebarTheme: (isDark: boolean) => Promise<void>;

  // Auto-updater APIs
  getAppVersion: () => Promise<string>;
  getLogFilePath: () => Promise<string>;
  openLogDirectory: () => Promise<{ success: boolean; path: string }>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<{ status: string; message?: string }>;
  installUpdate: () => void;
  setUpdateChannel: (channel: "stable" | "nightly") => Promise<boolean>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;

  // Assets APIs
  getAssetsSettings: () => Promise<AssetsSettings>;
  setAssetsSettings: (settings: Partial<AssetsSettings>) => Promise<boolean>;
  getDefaultAssetsDirectory: () => Promise<string>;
  getZImageOutputPath: () => Promise<string>;
  selectDirectory: () => Promise<SelectDirectoryResult>;
  saveAsset: (
    url: string,
    type: string,
    fileName: string,
    subDir: string,
  ) => Promise<SaveAssetResult>;
  deleteAsset: (filePath: string) => Promise<DeleteAssetResult>;
  deleteAssetsBulk: (filePaths: string[]) => Promise<DeleteAssetsBulkResult>;
  getAssetsMetadata: () => Promise<AssetMetadataElectron[]>;
  saveAssetsMetadata: (metadata: AssetMetadataElectron[]) => Promise<boolean>;
  openFileLocation: (filePath: string) => Promise<DeleteAssetResult>;
  checkFileExists: (filePath: string) => Promise<boolean>;
  openAssetsFolder: () => Promise<{ success: boolean; error?: string }>;
  scanAssetsDirectory: () => Promise<
    Array<{
      filePath: string;
      fileName: string;
      type: "image" | "video" | "audio" | "text";
      fileSize: number;
      createdAt: string;
    }>
  >;

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
  }) => Promise<{
    items: AssetMetadataElectron[];
    nextCursor: string | null;
    totalCount: number;
  }>;
  assetsGetById: (id: string) => Promise<AssetMetadataElectron | null>;
  assetsGetByExecution: (executionId: string) => Promise<AssetMetadataElectron[]>;
  assetsInsert: (asset: Omit<AssetMetadataElectron, "tags"> & { tags: string[] }) => Promise<string>;
  assetsUpdate: (
    id: string,
    updates: { tags?: string[]; favorite?: boolean; folderId?: string | null },
  ) => Promise<void>;
  assetsDelete: (id: string) => Promise<void>;
  assetsDeleteMany: (ids: string[]) => Promise<number>;
  assetsGetAllTags: () => Promise<string[]>;
  assetsGetAllModels: () => Promise<string[]>;
  assetsHasForPrediction: (predictionId: string) => Promise<boolean>;
  assetsHasForExecution: (executionId: string) => Promise<boolean>;
  assetsMarkPending: (id: string) => Promise<void>;

  // Folder APIs
  foldersGetAll: () => Promise<
    Array<{ id: string; name: string; color: string; icon?: string; createdAt: string }>
  >;
  foldersGetById: (id: string) => Promise<
    { id: string; name: string; color: string; icon?: string; createdAt: string } | null
  >;
  foldersCreate: (folder: { name: string; color: string; icon?: string }) => Promise<string>;
  foldersUpdate: (
    id: string,
    updates: { name?: string; color?: string; icon?: string },
  ) => Promise<void>;
  foldersDelete: (id: string, moveAssetsTo?: string | null) => Promise<void>;
  foldersGetAssetCount: (folderId: string) => Promise<number>;
  foldersImportBackup: (backupPath: string) => Promise<{ imported: number; total: number }>;

  // Tag Category APIs
  tagCategoriesGetAll: () => Promise<
    Array<{ id: string; name: string; color: string; tags: string[]; createdAt: string }>
  >;
  tagCategoriesGetById: (id: string) => Promise<
    | { id: string; name: string; color: string; tags: string[]; createdAt: string }
    | undefined
  >;
  tagCategoriesCreate: (name: string, color: string, tags?: string[]) => Promise<string>;
  tagCategoriesUpdate: (
    id: string,
    updates: { name?: string; color?: string; tags?: string[] },
  ) => Promise<void>;
  tagCategoriesDelete: (id: string) => Promise<void>;

  // Sync State APIs
  syncGetPending: () => Promise<{
    assets: string[];
    folders: string[];
    categories: string[];
  }>;
  syncGetState: (key: string) => Promise<string | null>;
  syncGetFullState: () => Promise<{
    lastSyncAt: string | null;
    deviceId: string | null;
    remoteVersion: number | null;
    syncEnabled: boolean;
  }>;
  syncSetState: (key: string, value: string) => Promise<void>;
  syncGetDeleted: () => Promise<
    Array<{ id: string; entityType: string; originalId: string }>
  >;
  syncUpdateLastSync: () => Promise<void>;
  syncIsEnabled: () => Promise<boolean>;
  syncSetEnabled: (enabled: boolean) => Promise<void>;
  syncGetRecentLog: (limit?: number) => Promise<any[]>;
  syncLogEvent: (entry: {
    entityType: string;
    entityId: string;
    operation: "create" | "update" | "delete" | "move";
    deviceId?: string;
    version?: number;
  }) => Promise<void>;

  // Cloud Sync APIs
  syncGetStatus: () => Promise<{
    enabled: boolean;
    lastSync: string | null;
    pending: number;
    isSyncing: boolean;
  }>;
  syncStart: () => Promise<{
    success: boolean;
    uploaded: { assets: number; folders: number; categories: number };
    downloaded: { assets: number; folders: number; categories: number };
    deleted: number;
    conflicts: number;
    errors: string[];
    duration: number;
  }>;
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
  }) => Promise<{ success: boolean; deviceId?: string }>;
  syncDisconnect: () => Promise<{ success: boolean }>;
  syncTestConnection: (config: {
    accountId: string;
    databaseId: string;
    apiToken: string;
  }) => Promise<{ success: boolean; error?: string }>;
  syncGetConfig: () => Promise<{
    accountId: string | null;
    databaseId: string | null;
    deviceId: string | null;
  }>;
  syncInitSchema: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  syncTriggersUpdate: (config: {
    timerEnabled?: boolean;
    intervalMinutes?: number;
  }) => Promise<{
    timerEnabled: boolean;
    intervalMinutes: number;
    focusDebounceMs: number;
  }>;
  syncTriggersGet: () => Promise<{
    timerEnabled: boolean;
    intervalMinutes: number;
    focusDebounceMs: number;
  }>;

  // === R2 Storage Configuration APIs ===

  /**
   * Get R2 configuration from database.
   */
  r2GetConfig: () => Promise<{
    accountId: string | null;
    bucket: string | null;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    publicUrl: string | null;
  }>;

  /**
   * Set R2 configuration in database.
   */
  r2SetConfig: (config: {
    accountId?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicUrl?: string;
  }) => Promise<{
    success: boolean;
  }>;

  /**
   * Clear R2 configuration from database.
   */
  r2ClearConfig: () => Promise<{
    success: boolean;
  }>;

  /**
   * Upload all local assets to R2 cloud storage.
   */
  r2UploadAllAssets: () => Promise<{
    total: number;
    uploaded: number;
    skipped: number;
    failed: number;
    errors: string[];
  }>;

  /**
   * Listen for R2 upload progress updates.
   * Returns an unsubscribe function.
   */
  onR2UploadProgress: (callback: (data: {
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
  }) => void) => () => void;

  // === Hybrid Asset Storage APIs ===

  /**
   * Get file path with lazy loading from R2 if missing locally.
   */
  assetsGetFile: (id: string) => Promise<{
    success: boolean;
    filePath?: string;
    locallyAvailable: boolean;
    error?: string;
  }>;

  /**
   * Explicitly download an asset to local cache.
   */
  assetsDownloadToCache: (id: string) => Promise<{
    success: boolean;
    filePath?: string;
    alreadyCached: boolean;
    error?: string;
  }>;

  /**
   * Get cache statistics.
   */
  assetsGetCacheStats: () => Promise<{
    totalBytes: number;
    totalFiles: number;
    maxBytes: number;
    usagePercentage: number;
    oldestAccess?: string;
  }>;

  /**
   * Clear local cache (delete all files, keep metadata).
   */
  assetsClearCache: () => Promise<{
    success: boolean;
    deleted: number;
    freed: number;
  }>;

  /**
   * Set cache size limit.
   */
  assetsSetCacheLimit: (maxBytes: number) => Promise<{
    success: boolean;
  }>;

  /**
   * Get sync queue statistics.
   */
  assetsSyncQueueStats: () => Promise<{
    pending: number;
    downloaded: number;
    failed: number;
    isProcessing: boolean;
  }>;

  /**
   * Queue missing assets for background download.
   */
  assetsSyncQueueMissing: (maxItems?: number) => Promise<{
    success: boolean;
    queued: number;
  }>;

  /**
   * Start processing the sync queue.
   */
  assetsSyncQueueStart: () => Promise<{
    success: boolean;
  }>;

  /**
   * Cancel sync queue processing.
   */
  assetsSyncQueueCancel: () => Promise<{
    success: boolean;
  }>;

  /**
   * Clear the sync queue.
   */
  assetsSyncQueueClear: () => Promise<{
    success: boolean;
  }>;

  /**
   * Reset failed items in the queue.
   */
  assetsSyncQueueRetry: () => Promise<{
    success: boolean;
  }>;

  // Stable Diffusion APIs
  sdGetBinaryPath: () => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  sdCheckAuxiliaryModels: () => Promise<{
    success: boolean;
    llmExists: boolean;
    vaeExists: boolean;
    llmPath: string;
    vaePath: string;
    error?: string;
  }>;
  sdListAuxiliaryModels: () => Promise<{
    success: boolean;
    models?: Array<{
      name: string;
      path: string;
      size: number;
      type: "llm" | "vae";
    }>;
    error?: string;
  }>;
  sdDeleteAuxiliaryModel: (
    type: "llm" | "vae",
  ) => Promise<{ success: boolean; error?: string }>;
  sdGenerateImage: (
    params: SDGenerationParams,
  ) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
  sdCancelGeneration: () => Promise<{ success: boolean; error?: string }>;
  sdSaveModelFromCache: (
    filename: string,
    data: Uint8Array,
    type: "model" | "llm" | "vae",
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  sdListModels: () => Promise<{
    success: boolean;
    models?: SDModelInfo[];
    error?: string;
  }>;
  sdDeleteModel: (
    modelPath: string,
  ) => Promise<{ success: boolean; error?: string }>;
  sdGetBinaryPath: () => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  sdDeleteBinary: () => Promise<{ success: boolean; error?: string }>;
  getFileSize: (filePath: string) => Promise<number>;
  sdGetSystemInfo: () => Promise<{
    platform: string;
    arch: string;
    acceleration: string;
    supported: boolean;
  }>;
  sdGetGpuVramMb: () => Promise<{
    success: boolean;
    vramMb: number | null;
    error?: string;
  }>;
  onSdProgress: (callback: (data: SDProgressData) => void) => () => void;
  onSdLog: (
    callback: (data: { type: "stdout" | "stderr"; message: string }) => void,
  ) => () => void;
  onSdDownloadProgress: (
    callback: (data: SDProgressData) => void,
  ) => () => void;
  onSdBinaryDownloadProgress: (
    callback: (data: SDProgressData) => void,
  ) => () => void;
  onSdLlmDownloadProgress: (
    callback: (data: SDProgressData) => void,
  ) => () => void;
  onSdVaeDownloadProgress: (
    callback: (data: SDProgressData) => void,
  ) => () => void;

  // File operations for chunked downloads
  fileGetSize: (
    filePath: string,
  ) => Promise<{ success: boolean; size?: number; error?: string }>;
  fileAppendChunk: (
    filePath: string,
    chunk: ArrayBuffer,
  ) => Promise<{ success: boolean; error?: string }>;
  fileRename: (
    oldPath: string,
    newPath: string,
  ) => Promise<{ success: boolean; error?: string }>;
  fileDelete: (
    filePath: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // SD download path helpers for chunked downloads
  sdGetBinaryDownloadPath: () => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  sdGetAuxiliaryModelDownloadPath: (
    type: "llm" | "vae",
  ) => Promise<{ success: boolean; path?: string; error?: string }>;
  sdGetModelsDir: () => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  sdExtractBinary: (
    zipPath: string,
    destPath: string,
  ) => Promise<{ success: boolean; path?: string; error?: string }>;

  // Persistent key-value state (survives app restarts)
  getState: (key: string) => Promise<unknown>;
  setState: (key: string, value: unknown) => Promise<boolean>;
  removeState: (key: string) => Promise<boolean>;

  // Assets event listener (workflow executor pushes new assets)
  onAssetsNewAsset: (callback: (asset: unknown) => void) => () => void;
}

export interface WorkflowAPI {
  invoke: (channel: string, args?: unknown) => Promise<unknown>;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  removeListener: (
    channel: string,
    callback: (...args: unknown[]) => void,
  ) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    workflowAPI: WorkflowAPI;
  }
}
