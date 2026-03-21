import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { apiClient } from "@/api/client";
import { useThemeStore, type Theme } from "@/stores/themeStore";
import { useAssetsStore } from "@/stores/assetsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWebAuthStore } from "@/stores/webAuthStore";
import { languages } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/useToast";
import {
  Eye,
  EyeOff,
  Check,
  Loader2,
  Monitor,
  Moon,
  Sun,
  Download,
  RefreshCw,
  Rocket,
  AlertCircle,
  Shield,
  Github,
  Globe,
  FolderOpen,
  FileText,
  Trash2,
  Database,
  ChevronRight,
  X,
  Clock,
  Settings,
  LogIn,
  LogOut,
  Link as LinkIcon,
  Cloud,
  CloudOff,
  CheckCircle2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface CacheItem {
  cacheName: string;
  url: string;
  size: number;
  type?: "browser" | "sd-model" | "sd-auxiliary" | "sd-binary"; // browser: browser cache, sd-model: SD models, sd-auxiliary: LLM/VAE, sd-binary: SD binary
  modelType?: "llm" | "vae"; // for sd-auxiliary models
}

type UpdateChannel = "stable" | "nightly";

interface UpdateStatus {
  status: string;
  version?: string;
  releaseNotes?: string | null;
  percent?: number;
  message?: string;
}

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const {
    apiKey,
    setApiKey,
    isValidated,
    isValidating: storeIsValidating,
    validateApiKey,
  } = useApiKeyStore();
  const { theme, setTheme } = useThemeStore();
  const {
    settings: assetsSettings,
    loadSettings: loadAssetsSettings,
    setAutoSave,
    setAssetsDirectory,
  } = useAssetsStore();
  const {
    settings: generalSettings,
    setDownloadTimeout,
    initSettings: initGeneralSettings,
  } = useSettingsStore();

  // Web auth state (for accessing /center/* endpoints with prompt data)
  const {
    isAuthenticated: isWebAuthed,
    user: webUser,
    isLoading: isWebAuthLoading,
    signIn: webSignIn,
    signOut: webSignOut,
  } = useWebAuthStore();

  const [inputKey, setInputKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Sync inputKey when apiKey loads from storage
  useEffect(() => {
    setInputKey(apiKey);
  }, [apiKey]);

  // Balance state
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  // Update state
  const [appVersion, setAppVersion] = useState<string>("");
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Cache state
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheItems, setCacheItems] = useState<CacheItem[]>([]);
  const [showCacheDialog, setShowCacheDialog] = useState(false);
  const [isDeletingItem, setIsDeletingItem] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Cloud sync state
  const [syncConfig, setSyncConfig] = useState({
    accountId: "",
    databaseId: "",
    apiToken: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    userId: "",
    publicUrl: "",
  });
  // R2 config stored in D1 (separate from sync config)
  const [r2StoredConfig, setR2StoredConfig] = useState({
    accountId: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrl: "",
  });
  const [syncStatus, setSyncStatus] = useState<{
    enabled: boolean;
    lastSync: string | null;
    pending: number;
    isSyncing: boolean;
  } | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSyncToken, setShowSyncToken] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    uploaded: { assets: number; folders: number; categories: number };
    downloaded: { assets: number; folders: number; categories: number };
    deleted: number;
    conflicts: number;
    errors: string[];
    duration: number;
  } | null>(null);

  // Helper to check if sync config is valid
  const isSyncConfigValid = () => {
    const aid = (syncConfig.accountId || "").trim();
    const did = (syncConfig.databaseId || "").trim();
    const token = (syncConfig.apiToken || "").trim();
    return aid.length > 0 && did.length > 0 && token.length > 0;
  };

  // Get the saved language preference (including 'auto')
  const [languagePreference, setLanguagePreference] = useState(() => {
    return localStorage.getItem("wavespeed_language") || "auto";
  });

  const handleLanguageChange = useCallback(
    (langCode: string) => {
      setLanguagePreference(langCode);
      localStorage.setItem("wavespeed_language", langCode);
      if (window.electronAPI?.setSettings) {
        window.electronAPI.setSettings({ language: langCode });
      }

      if (langCode === "auto") {
        // Detect browser language
        const browserLang = navigator.language || "en";
        // Find matching language or fallback to 'en'
        const supportedLangs = [
          "en",
          "zh-CN",
          "zh-TW",
          "ja",
          "ko",
          "es",
          "fr",
          "de",
          "it",
          "ru",
          "pt",
          "hi",
          "id",
          "ms",
          "th",
          "vi",
          "tr",
          "ar",
        ];
        const matchedLang =
          supportedLangs.find((l) => browserLang.startsWith(l.split("-")[0])) ||
          "en";
        i18n.changeLanguage(matchedLang);
      } else {
        i18n.changeLanguage(langCode);
      }

      toast({
        title: t("settings.language.changed"),
        description: t("settings.language.changedDesc"),
      });
    },
    [i18n, t],
  );

  // Load cache details (browser caches + SD models)
  const loadCacheDetails = useCallback(async () => {
    try {
      const items: CacheItem[] = [];
      let totalSize = 0;

      // 1. Load browser cache (Image Eraser, etc.)
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        for (const request of keys) {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            items.push({
              cacheName: name,
              url: request.url,
              size: blob.size,
              type: "browser",
            });
            totalSize += blob.size;
          }
        }
      }

      // 2. Load SD auxiliary models (LLM, VAE)
      if (window.electronAPI?.sdListAuxiliaryModels) {
        const result = await window.electronAPI.sdListAuxiliaryModels();
        if (result.success && result.models) {
          for (const model of result.models) {
            items.push({
              cacheName: "z-image-auxiliary",
              url: model.path,
              size: model.size,
              type: "sd-auxiliary",
              modelType: model.type,
            });
            totalSize += model.size;
          }
        }
      }

      // 3. Load SD models
      if (window.electronAPI?.sdListModels) {
        const result = await window.electronAPI.sdListModels();
        if (result.success && result.models) {
          for (const model of result.models) {
            items.push({
              cacheName: "z-image-models",
              url: model.path,
              size: model.size,
              type: "sd-model",
            });
            totalSize += model.size;
          }
        }
      }

      // 4. Load SD binary
      if (window.electronAPI?.sdGetBinaryPath) {
        const result = await window.electronAPI.sdGetBinaryPath();
        if (result.success && result.path) {
          try {
            // Use Node.js fs to get binary size
            if (window.electronAPI?.getFileSize) {
              const size = await window.electronAPI.getFileSize(result.path);
              items.push({
                cacheName: "z-image-binary",
                url: result.path,
                size: size,
                type: "sd-binary",
              });
              totalSize += size;
            }
          } catch (error) {
            console.error("Failed to get SD binary size:", error);
          }
        }
      }

      setCacheItems(items);
      setCacheSize(totalSize);
    } catch (error) {
      console.error("Failed to load cache details:", error);
      setCacheItems([]);
      setCacheSize(0);
    }
  }, []);

  // Calculate cache size (calls loadCacheDetails)
  const calculateCacheSize = useCallback(async () => {
    await loadCacheDetails();
  }, [loadCacheDetails]);

  // Fetch account balance
  const fetchBalance = useCallback(async () => {
    if (!isValidated) return;
    setIsLoadingBalance(true);
    try {
      const bal = await apiClient.getBalance();
      setBalance(bal);
    } catch {
      toast({
        title: t("common.error"),
        description: t("settings.balance.refreshFailed"),
        variant: "destructive",
      });
    } finally {
      setIsLoadingBalance(false);
    }
  }, [isValidated, t]);

  // Delete a single cache item
  const handleDeleteCacheItem = useCallback(
    async (item: CacheItem) => {
      setIsDeletingItem(item.url);
      try {
        if (item.type === "browser") {
          // Delete from browser cache
          const cache = await caches.open(item.cacheName);
          await cache.delete(item.url);
        } else if (item.type === "sd-auxiliary" && item.modelType) {
          // Delete SD auxiliary model (LLM or VAE)
          if (window.electronAPI?.sdDeleteAuxiliaryModel) {
            const result = await window.electronAPI.sdDeleteAuxiliaryModel(
              item.modelType,
            );
            if (!result.success) {
              throw new Error(result.error || "Failed to delete model");
            }
          }
        } else if (item.type === "sd-model") {
          // Delete SD model
          if (window.electronAPI?.sdDeleteModel) {
            const result = await window.electronAPI.sdDeleteModel(item.url);
            if (!result.success) {
              throw new Error(result.error || "Failed to delete model");
            }
          }
        } else if (item.type === "sd-binary") {
          // Delete SD binary
          if (window.electronAPI?.sdDeleteBinary) {
            const result = await window.electronAPI.sdDeleteBinary();
            if (!result.success) {
              throw new Error(result.error || "Failed to delete binary");
            }
          }
        }

        await loadCacheDetails();
        toast({
          title: t("common.success"),
          description: t("settings.cache.itemDeleted"),
        });
      } catch (error) {
        toast({
          title: t("common.error"),
          description:
            (error as Error).message || t("settings.cache.clearFailed"),
          variant: "destructive",
        });
      } finally {
        setIsDeletingItem(null);
      }
    },
    [loadCacheDetails, t],
  );

  // Clear all caches
  const handleClearCache = useCallback(async () => {
    setIsClearingCache(true);
    try {
      // 1. Clear browser caches
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      // 2. Clear SD auxiliary models (LLM, VAE)
      if (window.electronAPI?.sdDeleteAuxiliaryModel) {
        await window.electronAPI
          .sdDeleteAuxiliaryModel("llm")
          .catch(console.error);
        await window.electronAPI
          .sdDeleteAuxiliaryModel("vae")
          .catch(console.error);
      }

      // 3. Clear SD models
      const electronApi = window.electronAPI;
      if (electronApi?.sdListModels && electronApi?.sdDeleteModel) {
        const result = await electronApi.sdListModels();
        if (result.success && result.models) {
          await Promise.all(
            result.models.map((model) =>
              electronApi.sdDeleteModel(model.path).catch(console.error),
            ),
          );
        }
      }

      // 4. Clear SD binary
      if (window.electronAPI?.sdDeleteBinary) {
        await window.electronAPI.sdDeleteBinary().catch(console.error);
      }

      setCacheSize(0);
      setCacheItems([]);
      setShowCacheDialog(false);
      toast({
        title: t("settings.cache.cleared"),
        description: t("settings.cache.clearedDesc"),
      });
    } catch {
      toast({
        title: t("common.error"),
        description: t("settings.cache.clearFailed"),
        variant: "destructive",
      });
    } finally {
      setIsClearingCache(false);
    }
  }, [t]);

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // Get display name from cache item
  const getDisplayName = (item: CacheItem) => {
    if (item.type === "sd-auxiliary") {
      return item.modelType === "llm"
        ? "Qwen3-4B LLM (2.4 GB)"
        : "Z-Image VAE (335 MB)";
    } else if (item.type === "sd-model") {
      // Extract filename from path
      const filename = item.url.split(/[\\/]/).pop() || item.url;
      return filename.replace(".gguf", "");
    } else if (item.type === "sd-binary") {
      // SD binary
      return "stable-diffusion (SD Binary)";
    } else {
      // Browser cache
      try {
        const urlObj = new URL(item.url);
        const path = urlObj.pathname;
        const filename = path.split("/").pop() || path;
        return filename.length > 40 ? filename.slice(0, 37) + "..." : filename;
      } catch {
        return item.url.slice(0, 40);
      }
    }
  };

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (window.electronAPI) {
        const version = await window.electronAPI.getAppVersion();
        setAppVersion(version);

        const settings = await window.electronAPI.getSettings();
        setUpdateChannel(settings.updateChannel || "stable");
        setAutoCheckUpdate(settings.autoCheckUpdate !== false);
        if (settings.language) {
          setLanguagePreference(settings.language);
          localStorage.setItem("wavespeed_language", settings.language);
        }
      }
      // Load assets settings
      loadAssetsSettings();
      // Load general settings
      initGeneralSettings();
      // Calculate cache size
      calculateCacheSize();
    };
    loadSettings();
  }, [loadAssetsSettings, initGeneralSettings, calculateCacheSize]);

  // Fetch balance when authenticated
  useEffect(() => {
    if (isValidated) {
      fetchBalance();
    } else {
      setBalance(null);
    }
  }, [isValidated, fetchBalance]);

  // Subscribe to update status events
  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;

    const unsubscribe = window.electronAPI.onUpdateStatus((status) => {
      setUpdateStatus(status);

      if (status.status === "checking") {
        setIsCheckingUpdate(true);
      } else {
        setIsCheckingUpdate(false);
      }

      if (status.status === "downloading") {
        setIsDownloading(true);
      } else if (status.status === "downloaded" || status.status === "error") {
        setIsDownloading(false);
      }
    });

    return unsubscribe;
  }, []);

  // Load sync configuration and status on mount
  useEffect(() => {
    const loadSyncConfig = async () => {
      if (window.electronAPI?.syncGetConfig) {
        const config = await window.electronAPI.syncGetConfig();
        setSyncConfig((prev) => ({
          ...prev,
          accountId: config.accountId || "",
          databaseId: config.databaseId || "",
          // Load apiToken from localStorage for persistence
          apiToken: localStorage.getItem("wavespeed_sync_api_token") || "",
        }));
      }
    };
    loadSyncConfig();
  }, []);

  // Load R2 storage config from D1 on mount
  useEffect(() => {
    const loadR2Config = async () => {
      if (window.electronAPI?.r2GetConfig) {
        const config = await window.electronAPI.r2GetConfig();
        setR2StoredConfig({
          accountId: config.accountId || "",
          bucket: config.bucket || "",
          accessKeyId: config.accessKeyId || "",
          secretAccessKey: config.secretAccessKey || "",
          publicUrl: config.publicUrl || "",
        });
        // Populate form with stored R2 config
        setSyncConfig((prev) => ({
          ...prev,
          accountId: config.accountId || prev.accountId,
          bucket: config.bucket || "",
          accessKeyId: config.accessKeyId || "",
          secretAccessKey: config.secretAccessKey || "",
          publicUrl: config.publicUrl || "",
        }));
      }
    };
    loadR2Config();
  }, []);

  useEffect(() => {
    const loadSyncStatus = async () => {
      if (window.electronAPI?.syncGetStatus) {
        const status = await window.electronAPI.syncGetStatus();
        setSyncStatus(status);
      }
    };
    loadSyncStatus();
    // Poll sync status every 5 seconds when syncing
    const interval = setInterval(() => {
      if (syncStatus?.isSyncing) {
        loadSyncStatus();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [syncStatus?.isSyncing]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await setApiKey(inputKey);
      const isValid = await validateApiKey();
      if (isValid) {
        toast({
          title: t("settings.apiKey.saved"),
          description: t("settings.apiKey.savedDesc"),
        });
      } else {
        toast({
          title: t("settings.apiKey.invalid"),
          description: t("settings.apiKey.invalidDesc"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("settings.apiKey.error"),
        description: t("settings.apiKey.errorDesc"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setInputKey("");
    await setApiKey("");
    toast({
      title: t("settings.apiKey.cleared"),
      description: t("settings.apiKey.clearedDesc"),
    });
  };

  const handleChannelChange = useCallback(
    async (channel: UpdateChannel) => {
      setUpdateChannel(channel);
      setUpdateStatus(null);
      if (window.electronAPI?.setUpdateChannel) {
        await window.electronAPI.setUpdateChannel(channel);
        toast({
          title: t("settings.updates.channelChanged"),
          description: t("settings.updates.channelChangedDesc", { channel }),
        });
      }
    },
    [t],
  );

  const handleAutoCheckUpdateChange = useCallback(async (checked: boolean) => {
    setAutoCheckUpdate(checked);
    if (window.electronAPI?.setSettings) {
      await window.electronAPI.setSettings({ autoCheckUpdate: checked });
    }
  }, []);

  const handleAutoSaveAssetsChange = useCallback(
    async (checked: boolean) => {
      await setAutoSave(checked);
      toast({
        title: checked
          ? t("settings.assets.autoSaveEnabled")
          : t("settings.assets.autoSaveDisabled"),
        description: checked
          ? t("settings.assets.autoSaveEnabledDesc")
          : t("settings.assets.autoSaveDisabledDesc"),
      });
    },
    [setAutoSave, t],
  );

  const handleSelectAssetsDirectory = useCallback(async () => {
    if (!window.electronAPI?.selectDirectory) {
      toast({
        title: t("common.error"),
        description: t("settings.assets.desktopOnly"),
        variant: "destructive",
      });
      return;
    }

    const result = await window.electronAPI.selectDirectory();
    if (result.success && result.path) {
      await setAssetsDirectory(result.path);
      toast({
        title: t("settings.assets.directoryChanged"),
        description: t("settings.assets.directoryChangedDesc", {
          path: result.path,
        }),
      });
    }
  }, [setAssetsDirectory, t]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!window.electronAPI?.checkForUpdates) {
      toast({
        title: t("settings.updates.devMode"),
        description: t("settings.updates.notAvailableInDev"),
        variant: "destructive",
      });
      return;
    }

    setIsCheckingUpdate(true);
    setUpdateStatus(null);

    try {
      const result = await window.electronAPI.checkForUpdates();
      if (result.status === "dev-mode") {
        toast({
          title: t("settings.updates.devMode"),
          description: t("settings.updates.devModeDesc"),
        });
      } else if (result.status === "error") {
        toast({
          title: t("settings.updates.checkFailed"),
          description: result.message || t("settings.updates.checkFailed"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("common.error"),
        description: t("settings.updates.checkFailed"),
        variant: "destructive",
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [t]);

  const handleDownloadUpdate = useCallback(async () => {
    if (!window.electronAPI?.downloadUpdate) return;

    setIsDownloading(true);
    try {
      await window.electronAPI.downloadUpdate();
    } catch {
      toast({
        title: t("settings.updates.downloadFailed"),
        description: t("settings.updates.downloadFailedDesc"),
        variant: "destructive",
      });
      setIsDownloading(false);
    }
  }, [t]);

  const handleInstallUpdate = useCallback(() => {
    if (window.electronAPI?.installUpdate) {
      window.electronAPI.installUpdate();
    }
  }, []);

  // Cloud sync handlers
  const handleTestSyncConnection = async () => {
    if (!window.electronAPI?.syncTestConnection) {
      toast({
        title: "Not available",
        description: "Sync is only available in the desktop app",
        variant: "destructive",
      });
      return;
    }
    setIsTestingConnection(true);
    try {
      const result = await window.electronAPI?.syncTestConnection({
        accountId: syncConfig.accountId,
        databaseId: syncConfig.databaseId,
        apiToken: syncConfig.apiToken,
      });
      if (result?.success) {
        toast({
          title: "Connection successful",
          description: "Successfully connected to Cloudflare D1",
        });
      } else {
        toast({
          title: "Connection failed",
          description: result?.error || "Failed to connect to Cloudflare D1",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Connection failed",
        description: "Failed to connect to Cloudflare D1",
        variant: "destructive",
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleConfigureSync = async () => {
    if (!window.electronAPI?.syncConfigure) {
      toast({
        title: "Not available",
        description: "Sync is only available in the desktop app",
        variant: "destructive",
      });
      return;
    }
    try {
      // Save R2 config to D1 database
      if (window.electronAPI?.r2SetConfig) {
        await window.electronAPI.r2SetConfig({
          accountId: syncConfig.accountId || undefined,
          bucket: syncConfig.bucket || undefined,
          accessKeyId: syncConfig.accessKeyId || undefined,
          secretAccessKey: syncConfig.secretAccessKey || undefined,
          publicUrl: syncConfig.publicUrl || undefined,
        });
      }

      const result = await window.electronAPI?.syncConfigure({
        accountId: syncConfig.accountId,
        databaseId: syncConfig.databaseId,
        apiToken: syncConfig.apiToken,
        bucket: syncConfig.bucket || undefined,
        accessKeyId: syncConfig.accessKeyId || undefined,
        secretAccessKey: syncConfig.secretAccessKey || undefined,
        userId: syncConfig.userId || undefined,
        publicUrl: syncConfig.publicUrl || undefined,
      });
      if (result?.success) {
        toast({
          title: "Sync configured",
          description: "Cloud sync has been configured successfully",
        });
        // Update stored R2 config
        setR2StoredConfig({
          bucket: syncConfig.bucket || "",
          accessKeyId: syncConfig.accessKeyId || "",
          secretAccessKey: syncConfig.secretAccessKey || "",
          publicUrl: syncConfig.publicUrl || "",
        });
        // Reload sync status
        const status = await window.electronAPI?.syncGetStatus();
        setSyncStatus(status);
      }
    } catch {
      toast({
        title: "Configuration failed",
        description: "Failed to configure cloud sync",
        variant: "destructive",
      });
    }
  };

  const handleDisconnectSync = async () => {
    try {
      const result = await window.electronAPI?.syncDisconnect();
      if (result?.success) {
        toast({
          title: "Sync disconnected",
          description: "Cloud sync has been disconnected",
        });
        setSyncStatus(null);
      }
    } catch {
      toast({
        title: "Disconnect failed",
        description: "Failed to disconnect cloud sync",
        variant: "destructive",
      });
    }
  };

  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [cloudSyncProgress, setCloudSyncProgress] = useState<{
    phase: "sync" | "upload" | "done";
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
  } | null>(null);

  // Set up cloud sync progress listener
  useEffect(() => {
    if (!window.electronAPI?.onR2UploadProgress) return;
    const unsubscribe = window.electronAPI.onR2UploadProgress((data) => {
      setCloudSyncProgress({ ...data, phase: "upload" });
    });
    return unsubscribe;
  }, []);

  const handleSyncCloudStorage = async () => {
    console.log("[UI] Sync Cloud Storage clicked");
    if (!window.electronAPI?.r2UploadAllAssets || !window.electronAPI?.syncStart) {
      console.error("[UI] Cloud sync APIs not available");
      toast({
        title: "Not available",
        description: "Cloud sync is only available in the desktop app",
        variant: "destructive",
      });
      return;
    }
    console.log("[UI] Starting cloud sync...");
    setIsSyncingCloud(true);
    setCloudSyncProgress(null);
    try {
      // Step 1: Sync D1 metadata first
      setCloudSyncProgress({ phase: "sync", total: 0, uploaded: 0, skipped: 0, failed: 0, processed: 0, current: "Syncing metadata..." });
      const syncResult = await window.electronAPI.syncStart();
      console.log("[UI] D1 sync result:", syncResult);

      // Step 2: Upload to R2
      setCloudSyncProgress({ phase: "upload", total: 0, uploaded: 0, skipped: 0, failed: 0, processed: 0, current: "Uploading files to cloud..." });
      const r2Result = await window.electronAPI.r2UploadAllAssets();
      console.log("[UI] R2 upload result:", r2Result);

      // Show combined result
      const hasErrors = !syncResult.success || r2Result.failed > 0;
      toast({
        title: hasErrors ? "Sync completed with errors" : "Cloud sync complete",
        description: `D1: ${syncResult.success ? "OK" : "Failed"}, R2: ${r2Result.uploaded} uploaded, ${r2Result.skipped} skipped, ${r2Result.failed} failed`,
        variant: hasErrors ? "destructive" : "default",
      });

      if (r2Result.errors.length > 0) {
        console.error("[R2 Upload errors]", r2Result.errors);
      }

      // Reload sync status
      const status = await window.electronAPI?.syncGetStatus();
      setSyncStatus(status);
    } catch (error) {
      console.error("[UI] Cloud sync error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Cloud sync failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSyncingCloud(false);
      setCloudSyncProgress(null);
    }
  };

  const handleStartSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await window.electronAPI?.syncStart();
      setSyncResult(result);
      // Reload sync status
      const status = await window.electronAPI?.syncGetStatus();
      setSyncStatus(status);
      if (result?.success) {
        toast({
          title: "Sync complete",
          description: `Uploaded: ${result.uploaded.assets} assets, ${result.uploaded.folders} folders. Downloaded: ${result.downloaded.assets} assets, ${result.downloaded.folders} folders.`,
        });
      } else {
        toast({
          title: "Sync completed with errors",
          description: `${result?.errors.length} errors occurred`,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Sync failed",
        description: "Failed to complete sync",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const renderUpdateStatus = () => {
    if (!updateStatus) return null;

    switch (updateStatus.status) {
      case "checking":
        return (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("settings.updates.checking")}</span>
          </div>
        );

      case "available":
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Download className="h-4 w-4" />
              <span>
                {t("settings.updates.available", {
                  version: updateStatus.version,
                })}
              </span>
            </div>
            <Button onClick={handleDownloadUpdate} disabled={isDownloading}>
              <Download className="mr-2 h-4 w-4" />
              {t("settings.updates.downloadUpdate")}
            </Button>
          </div>
        );

      case "not-available":
        return (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Check className="h-4 w-4" />
            <span>
              {t("settings.updates.notAvailable", {
                version: updateStatus.version,
              })}
            </span>
          </div>
        );

      case "downloading":
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {t("settings.updates.downloading", {
                  percent: Math.round(updateStatus.percent || 0),
                })}
              </span>
            </div>
            <Progress value={updateStatus.percent || 0} />
          </div>
        );

      case "downloaded":
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              <span>
                {t("settings.updates.downloaded", {
                  version: updateStatus.version,
                })}
              </span>
            </div>
            <Button onClick={handleInstallUpdate}>
              <Rocket className="mr-2 h-4 w-4" />
              {t("settings.updates.restartInstall")}
            </Button>
          </div>
        );

      case "error":
        return (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>
              {t("settings.updates.error", { message: updateStatus.message })}
            </span>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="container max-w-2xl px-4 md:px-6 py-6 md:py-8 pt-14 md:pt-4 settings-stagger">
      <div className="mb-6 md:mb-8 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          {t("settings.title")}
        </h1>
        <p className="text-muted-foreground text-sm md:text-base mt-2">
          {t("settings.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("settings.apiKey.title")}</CardTitle>
              <CardDescription>
                {t("settings.apiKey.description")}
              </CardDescription>
            </div>
            {apiKey && storeIsValidating && (
              <Badge variant="secondary">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />{" "}
                {t("settings.apiKey.validating")}
              </Badge>
            )}
            {apiKey && !storeIsValidating && isValidated && (
              <Badge variant="success">
                <Check className="mr-1 h-3 w-3" /> {t("settings.apiKey.valid")}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apiKey">{t("settings.apiKey.label")}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="apiKey"
                  type={showKey ? "text" : "password"}
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder={t("settings.apiKey.placeholder")}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.apiKey.getKey")}{" "}
              <a
                href="https://wavespeed.ai/accesskey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                wavespeed.ai/accesskey
              </a>
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={isSaving || !inputKey}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("settings.apiKey.validating")}
                </>
              ) : (
                t("settings.apiKey.save")
              )}
            </Button>
            <Button variant="outline" onClick={handleClear} disabled={!apiKey}>
              {t("common.clear")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Web Authentication (for accessing /center/* endpoints with prompt data) */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="h-5 w-5" />
                Web Authentication
              </CardTitle>
              <CardDescription>
                Sign in with GitHub or Google to view prompts in history
              </CardDescription>
            </div>
            {isWebAuthed && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Check className="h-3 w-3" />
                Connected
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isWebAuthed ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{webUser?.user_name}</p>
                  <p className="text-xs text-muted-foreground">{webUser?.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {webUser?.org_name}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={webSignOut}
                  disabled={isWebAuthLoading}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Web authentication enables viewing full prompts in history. Your
                session is stored locally.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sign in to view prompts when browsing your prediction history.
                This uses the same OAuth as wavespeed.ai (GitHub/Google).
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  const result = await webSignIn();
                  if (!result.success) {
                    toast({
                      title: "Authentication failed",
                      description: result.error || "Please try again",
                      variant: "destructive",
                    });
                  } else {
                    toast({
                      title: "Authentication successful",
                      description: "You can now view prompts in history",
                    });
                  }
                }}
                disabled={isWebAuthLoading}
              >
                {isWebAuthLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4 mr-2" />
                    Sign In with GitHub/Google
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isValidated && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("settings.balance.title")}</CardTitle>
                <CardDescription>
                  {t("settings.balance.description")}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={fetchBalance}
                disabled={isLoadingBalance}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoadingBalance ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">
                {isLoadingBalance ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : balance !== null ? (
                  `$${balance.toFixed(2)}`
                ) : (
                  "—"
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("settings.appearance.title")}</CardTitle>
          <CardDescription>
            {t("settings.appearance.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="theme">{t("settings.appearance.theme")}</Label>
            <Select
              value={theme}
              onValueChange={(value) => setTheme(value as Theme)}
            >
              <SelectTrigger id="theme" className="w-[200px]">
                <SelectValue placeholder={t("settings.appearance.theme")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4" />
                    <span>{t("settings.appearance.themeAuto")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="light">
                  <div className="flex items-center gap-2">
                    <Sun className="h-4 w-4" />
                    <span>{t("settings.appearance.themeLight")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="dark">
                  <div className="flex items-center gap-2">
                    <Moon className="h-4 w-4" />
                    <span>{t("settings.appearance.themeDark")}</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("settings.appearance.themeDesc")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("settings.language.title")}</CardTitle>
          <CardDescription>
            {t("settings.language.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="language">{t("settings.language.label")}</Label>
            <Select
              value={languagePreference}
              onValueChange={handleLanguageChange}
            >
              <SelectTrigger id="language" className="w-[200px]">
                <SelectValue placeholder={t("settings.language.label")} />
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      <span>
                        {lang.code === "auto"
                          ? t("settings.language.auto")
                          : lang.nativeName}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("settings.assets.title")}</CardTitle>
          <CardDescription>{t("settings.assets.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="autoSaveAssets">
                {t("settings.assets.autoSave")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.assets.autoSaveDesc")}
              </p>
            </div>
            <Switch
              id="autoSaveAssets"
              checked={assetsSettings.autoSaveAssets}
              onCheckedChange={handleAutoSaveAssetsChange}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("settings.assets.directory")}</Label>
            <div className="flex gap-2">
              <Input
                value={
                  assetsSettings.assetsDirectory ||
                  t("settings.assets.defaultDirectory")
                }
                readOnly
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSelectAssetsDirectory}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t("settings.assets.browse")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.assets.directoryDesc")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("settings.downloads.title")}</CardTitle>
          <CardDescription>
            {t("settings.downloads.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <Label>{t("settings.downloads.downloadTimeout")}</Label>
            </div>
            <div className="flex items-center gap-3">
              <Select
                value={String(generalSettings.downloadTimeout)}
                onValueChange={(value) =>
                  setDownloadTimeout(parseInt(value, 10))
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="120">
                    2 {t("settings.downloads.minutes")}
                  </SelectItem>
                  <SelectItem value="300">
                    5 {t("settings.downloads.minutes")}
                  </SelectItem>
                  <SelectItem value="600">
                    10 {t("settings.downloads.minutes")}
                  </SelectItem>
                  <SelectItem value="900">
                    15 {t("settings.downloads.minutes")}
                  </SelectItem>
                  <SelectItem value="1800">
                    30 {t("settings.downloads.minutes")}
                  </SelectItem>
                  <SelectItem value="3600">
                    60 {t("settings.downloads.minutes")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.downloads.downloadTimeoutDesc")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("settings.cache.title")}</CardTitle>
          <CardDescription>{t("settings.cache.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-3 text-left hover:bg-muted/50 -ml-2 px-2 py-1 rounded-md transition-colors"
              onClick={() => setShowCacheDialog(true)}
              disabled={cacheSize === 0}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <Label className="cursor-pointer">
                    {t("settings.cache.aiModels")}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("settings.cache.aiModelsDesc")}
                </p>
              </div>
              {cacheSize !== null && cacheSize > 0 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {cacheSize !== null
                  ? cacheSize > 0
                    ? formatSize(cacheSize)
                    : t("settings.cache.empty")
                  : t("settings.cache.calculating")}
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowClearConfirm(true)}
                disabled={isClearingCache || cacheSize === 0}
              >
                {isClearingCache ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("settings.cache.clear")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cache Details Dialog */}
      <Dialog open={showCacheDialog} onOpenChange={setShowCacheDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{t("settings.cache.title")}</span>
              <span className="text-sm font-normal text-muted-foreground">
                {formatSize(cacheSize || 0)}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto -mx-6 px-6">
            {cacheItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("settings.cache.empty")}
              </p>
            ) : (
              <div className="space-y-2">
                {cacheItems.map((item) => (
                  <div
                    key={item.url}
                    className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/50 group"
                  >
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        title={item.url}
                      >
                        {getDisplayName(item)}
                      </p>
                      <p
                        className="text-xs text-muted-foreground truncate"
                        title={item.cacheName}
                      >
                        {item.cacheName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {formatSize(item.size)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleDeleteCacheItem(item)}
                        disabled={isDeletingItem === item.url}
                      >
                        {isDeletingItem === item.url ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {cacheItems.length > 0 && (
            <div className="flex justify-end pt-4 border-t">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowClearConfirm(true)}
                disabled={isClearingCache}
              >
                {isClearingCache ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                {t("settings.cache.clear")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Clear Cache Confirmation */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.cache.clear")}</AlertDialogTitle>
            <AlertDialogDescription>
              {(cacheSize ?? 0) > 0
                ? t("settings.cache.clearConfirmDesc", {
                    size: formatSize(cacheSize ?? 0),
                  })
                : t("settings.cache.clearConfirmEmpty")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleClearCache}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t("settings.cache.clear")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("settings.updates.title")}</CardTitle>
              <CardDescription>
                {t("settings.updates.description")}
              </CardDescription>
            </div>
            {appVersion && <Badge variant="outline">v{appVersion}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="updateChannel">
              {t("settings.updates.channel")}
            </Label>
            <Select
              value={updateChannel}
              onValueChange={(value) =>
                handleChannelChange(value as UpdateChannel)
              }
            >
              <SelectTrigger id="updateChannel" className="w-[200px]">
                <SelectValue placeholder={t("settings.updates.channel")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    <span>{t("settings.updates.stable")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="nightly">
                  <div className="flex items-center gap-2">
                    <Rocket className="h-4 w-4" />
                    <span>{t("settings.updates.nightly")}</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {updateChannel === "stable"
                ? t("settings.updates.stableDesc")
                : t("settings.updates.nightlyDesc")}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="autoCheckUpdate">
                {t("settings.updates.autoCheck")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.updates.autoCheckDesc")}
              </p>
            </div>
            <Switch
              id="autoCheckUpdate"
              checked={autoCheckUpdate}
              onCheckedChange={handleAutoCheckUpdateChange}
            />
          </div>

          <div className="space-y-3">
            <Button
              variant="outline"
              onClick={handleCheckForUpdates}
              disabled={isCheckingUpdate || isDownloading}
            >
              {isCheckingUpdate ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("settings.updates.checking")}
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t("settings.updates.checkForUpdates")}
                </>
              )}
            </Button>

            {renderUpdateStatus()}
          </div>
        </CardContent>
      </Card>

      {/* Debug & Logs Section */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Debug & Logs</CardTitle>
          <CardDescription>
            View application logs for troubleshooting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Application logs are automatically saved to help diagnose issues.
              You can view the log file or open the logs directory.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (window.electronAPI) {
                    const logPath = await window.electronAPI.getLogFilePath();
                    navigator.clipboard.writeText(logPath);
                    toast({
                      title: "Log path copied",
                      description: "Log file path has been copied to clipboard",
                    });
                  }
                }}
              >
                <FileText className="mr-2 h-4 w-4" />
                Copy Log Path
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (window.electronAPI) {
                    await window.electronAPI.openLogDirectory();
                  }
                }}
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                Open Logs Folder
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Windows:{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                %APPDATA%\wavespeed-desktop\logs\main.log
              </code>
              <br />
              macOS:{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                ~/Library/Logs/wavespeed-desktop/main.log
              </code>
              <br />
              Linux:{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                ~/.config/wavespeed-desktop/logs/main.log
              </code>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("settings.about.title")}</CardTitle>
          <CardDescription>{t("settings.about.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("settings.about.aboutText")}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              window.open(
                "https://github.com/WaveSpeedAI/wavespeed-desktop",
                "_blank",
              )
            }
          >
            <Github className="mr-2 h-4 w-4" />
            {t("settings.about.viewOnGitHub")}
          </Button>
        </CardContent>
      </Card>

      {/* Cloud Sync Section */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Cloud Sync
          </CardTitle>
          <CardDescription>
            Sync your assets, folders, and tags across devices using Cloudflare D1
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Sync Status */}
          {syncStatus?.enabled && (
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="font-medium">Sync Enabled</span>
                </div>
                {syncStatus.isSyncing && (
                  <Badge variant="secondary" className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Syncing
                  </Badge>
                )}
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <div className="flex justify-between">
                  <span>Last sync:</span>
                  <span>{syncStatus.lastSync ? new Date(syncStatus.lastSync).toLocaleString() : "Never"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Pending changes:</span>
                  <span>{syncStatus.pending} items</span>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={handleStartSync}
                  disabled={isSyncing || syncStatus.isSyncing}
                >
                  {isSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync Now
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSyncCloudStorage}
                  disabled={isSyncingCloud}
                >
                  {isSyncingCloud ? "Syncing..." : "Sync Cloud Storage"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDisconnectSync}
                >
                  Disconnect
                </Button>
              </div>

              {/* Cloud Sync Progress */}
              {cloudSyncProgress && (
                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="font-medium">
                      {cloudSyncProgress.phase === "sync" ? "Syncing metadata..." :
                       cloudSyncProgress.phase === "upload" ? "Uploading to cloud..." :
                       "Syncing..."}
                    </span>
                    <span className="text-muted-foreground">
                      {cloudSyncProgress.total > 0 ? `${cloudSyncProgress.processed} / ${cloudSyncProgress.total}` : cloudSyncProgress.current}
                    </span>
                  </div>
                  {cloudSyncProgress.total > 0 && (
                    <Progress
                      value={(cloudSyncProgress.processed / cloudSyncProgress.total) * 100}
                      className="h-2"
                    />
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                    <span className="truncate max-w-[200px]" title={cloudSyncProgress.current}>
                      {cloudSyncProgress.current}
                    </span>
                    <span>
                      {cloudSyncProgress.uploaded} up, {cloudSyncProgress.skipped} skip, {cloudSyncProgress.failed} fail
                    </span>
                  </div>
                  {cloudSyncProgress.fileProgress && cloudSyncProgress.fileProgress.percentage < 100 && (
                    <div className="mt-2">
                      <div className="text-xs text-muted-foreground mb-1">
                        File: {Math.round(cloudSyncProgress.fileProgress.percentage)}%
                      </div>
                      <Progress
                        value={cloudSyncProgress.fileProgress.percentage}
                        className="h-1"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Sync Result */}
          {syncResult && (
            <div className={`rounded-lg border p-4 ${syncResult.success ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' : 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800'}`}>
              <div className="font-medium mb-2">{syncResult.success ? "Sync Complete" : "Sync Completed with Errors"}</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Uploaded: {syncResult.uploaded.assets} assets, {syncResult.uploaded.folders} folders</div>
                <div>Downloaded: {syncResult.downloaded.assets} assets, {syncResult.downloaded.folders} folders</div>
                {syncResult.deleted > 0 && <div>Deleted: {syncResult.deleted} items</div>}
                {syncResult.conflicts > 0 && <div>Conflicts: {syncResult.conflicts}</div>}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Duration: {Math.round(syncResult.duration / 1000)}s
              </div>
              {syncResult.errors.length > 0 && (
                <div className="mt-2 text-xs text-destructive">
                  Errors: {syncResult.errors.slice(0, 3).join(", ")}
                  {syncResult.errors.length > 3 && ` (+${syncResult.errors.length - 3} more)`}
                </div>
              )}
            </div>
          )}

          {/* Configuration Form */}
          {!syncStatus?.enabled && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="accountId">Account ID</Label>
                <Input
                  id="accountId"
                  placeholder="40e577fef68ec2ebea917d66c8f5b050"
                  value={syncConfig.accountId}
                  onChange={(e) => setSyncConfig({ ...syncConfig, accountId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="databaseId">Database ID</Label>
                <Input
                  id="databaseId"
                  placeholder="9f8f0c7b-94ad-454b-bfc4-974277d559f9"
                  value={syncConfig.databaseId}
                  onChange={(e) => setSyncConfig({ ...syncConfig, databaseId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiToken">API Token</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="apiToken"
                      type={showSyncToken ? "text" : "password"}
                      placeholder="cfat_..."
                      value={syncConfig.apiToken}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSyncConfig({ ...syncConfig, apiToken: value });
                        localStorage.setItem("wavespeed_sync_api_token", value);
                      }}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSyncToken(!showSyncToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSyncToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Create a token with D1 edit permissions at{" "}
                  <a
                    href="https://dash.cloudflare.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    Cloudflare Dashboard
                  </a>
                </p>
              </div>

              {/* R2 Storage Configuration */}
              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium text-sm mb-3">R2 Storage (for asset backup)</h4>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="bucket">Bucket Name</Label>
                    <Input
                      id="bucket"
                      placeholder="ai-playground"
                      value={syncConfig.bucket}
                      onChange={(e) => setSyncConfig({ ...syncConfig, bucket: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accessKeyId">Access Key ID</Label>
                    <Input
                      id="accessKeyId"
                      placeholder="R2 Access Key ID"
                      value={syncConfig.accessKeyId}
                      onChange={(e) => setSyncConfig({ ...syncConfig, accessKeyId: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="secretAccessKey">Secret Access Key</Label>
                    <Input
                      id="secretAccessKey"
                      type="password"
                      placeholder="R2 Secret Access Key"
                      value={syncConfig.secretAccessKey}
                      onChange={(e) => setSyncConfig({ ...syncConfig, secretAccessKey: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="publicUrl">Public R2 URL (optional, for faster downloads)</Label>
                    <Input
                      id="publicUrl"
                      placeholder="https://pub-xxx.r2.dev"
                      value={syncConfig.publicUrl}
                      onChange={(e) => setSyncConfig({ ...syncConfig, publicUrl: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      If bucket is public, downloads will be faster (no authentication required)
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleTestSyncConnection}
                  disabled={isTestingConnection || !isSyncConfigValid()}
                  variant="outline"
                >
                  {isTestingConnection ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    "Test Connection"
                  )}
                </Button>
                <Button
                  onClick={handleConfigureSync}
                  disabled={!isSyncConfigValid()}
                >
                  Configure Sync
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
