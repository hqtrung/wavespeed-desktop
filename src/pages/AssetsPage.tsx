import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAssetsStore } from "@/stores/assetsStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { useModelsStore } from "@/stores/modelsStore";
import { usePredictionInputsStore } from "@/stores/predictionInputsStore";
import { apiClient } from "@/api/client";
import { usePageActive } from "@/hooks/usePageActive";
import { useDeferredClose } from "@/hooks/useDeferredClose";
import { normalizeApiInputsToFormValues } from "@/lib/schemaToForm";
import { formatBytes } from "@/types/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  Search,
  Loader2,
  Image,
  Video,
  Music,
  FileText,
  Star,
  MoreVertical,
  Trash2,
  FolderOpen,
  FolderMinus,
  Download,
  Eye,
  EyeOff,
  Tag,
  X,
  SlidersHorizontal,
  CheckSquare,
  Square,
  Plus,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  FolderHeart,
  GitBranch,
  Wrench,
  Cpu,
} from "lucide-react";
import type {
  AssetMetadata,
  AssetType,
  AssetSortBy,
  AssetsFilter,
  AssetFolder,
} from "@/types/asset";
import { NO_FOLDER_ID } from "@/types/asset";
import {
  FolderSidebar,
  FolderCreateDialog,
  AssetCard,
  AssetTypeIcon,
  getAssetUrl,
  formatDate,
  TagFilterChips,
  BulkTagEditDialog,
  AssetPagination,
  usePaginationKeyboard,
  isDesktopMode,
} from "@/components/assets";
import { getFolderColorClass } from "@/components/assets/folder-sidebar";

export function AssetsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isActive = usePageActive("/assets");
  const { createTab, findFormValuesByPredictionId } = usePlaygroundStore();
  const { fetchModels, getModelById } = useModelsStore();
  const {
    get: getLocalInputs,
    load: loadPredictionInputs,
    isLoaded: inputsLoaded,
  } = usePredictionInputsStore();
  const {
    assets,
    isLoaded,
    isLoading,
    loadAssets,
    deleteAsset,
    deleteAssets,
    updateAsset,
    getFilteredAssets,
    getAllTags,
    getAllModels,
    folders,
    loadFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    moveAssetsToFolder,
    openAssetLocation,
  } = useAssetsStore();
  const [isOpeningPlayground, setIsOpeningPlayground] = useState(false);

  // Filter state
  const [filter, setFilter] = useState<AssetsFilter>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // URL search params for filtering by predictionId
  const [searchParams] = useSearchParams();
  const predictionIdFilter = searchParams.get("predictionId");

  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(240); // Default width in px
  const [isResizing, setIsResizing] = useState(false);
  const MIN_SIDEBAR_WIDTH = 180;
  const MAX_SIDEBAR_WIDTH = 600; // Increased from 400
  const [isCollapsed, setIsCollapsed] = useState(false); // Collapsible folder panel

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Dialog state
  const [previewAsset, setPreviewAsset] = useState<AssetMetadata | null>(null);
  const deferredPreviewAsset = useDeferredClose(previewAsset);
  const [deleteConfirmAsset, setDeleteConfirmAsset] =
    useState<AssetMetadata | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [tagDialogAsset, setTagDialogAsset] = useState<AssetMetadata | null>(
    null,
  );
  const [showBulkTagEdit, setShowBulkTagEdit] = useState(false);
  const [showBulkFolderMove, setShowBulkFolderMove] = useState(false);
  const [newTag, setNewTag] = useState("");

  // Loading state
  const [isDeleting, setIsDeleting] = useState(false);
  const [isProcessingTags, setIsProcessingTags] = useState(false);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Preview toggle
  const [loadPreviews, setLoadPreviews] = useState(true);

  // Folder state
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState<"create" | "edit">(
    "create",
  );
  const [editingFolder, setEditingFolder] = useState<AssetFolder | null>(null);

  const markPreviewLoaded = useCallback((_key: string) => {
    // Placeholder — cards track their own visibility via useInView
  }, []);

  // Load assets on mount
  useEffect(() => {
    loadAssets();
    loadFolders();
  }, [loadAssets, loadFolders]);

  // Sync folderId with filter
  useEffect(() => {
    setFilter((f) => ({ ...f, folderId: activeFolderId }));
  }, [activeFolderId]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter((f) => ({ ...f, search: searchQuery }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset page when filter or page size changes
  useEffect(() => {
    setPage(1);
  }, [filter, pageSize]);

  // Get filtered assets
  const filteredAssets = useMemo(() => {
    let filtered = getFilteredAssets(filter);
    // Apply predictionId filter from URL
    if (predictionIdFilter) {
      filtered = filtered.filter(
        (a) => a.predictionId === predictionIdFilter,
      );
    }
    return filtered;
  }, [getFilteredAssets, filter, assets, predictionIdFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredAssets.length / pageSize);
  const paginatedAssets = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAssets.slice(start, start + pageSize);
  }, [filteredAssets, page, pageSize]);

  // Keyboard shortcut: Cmd+M to toggle selection mode
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+M or Ctrl+M
      if ((e.metaKey || e.ctrlKey) && e.key === "m") {
        e.preventDefault();
        setIsSelectionMode((prev) => {
          const newValue = !prev;
          // Clear selection when exiting mode
          if (!newValue) {
            setSelectedIds(new Set());
          }
          return newValue;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive]);

  // Sidebar resize handlers
  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = e.clientX;
      if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
        setSidebarWidth(newWidth);
      }
    },
    [isResizing],
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", handleResize);
      window.addEventListener("mouseup", handleResizeEnd);
      // Prevent text selection during resize
      document.body.style.userSelect = "none";
      return () => {
        window.removeEventListener("mousemove", handleResize);
        window.removeEventListener("mouseup", handleResizeEnd);
        document.body.style.userSelect = "";
      };
    }
  }, [isResizing, handleResize, handleResizeEnd]);

  const toggleSidebarCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  // Keyboard navigation for pagination (moved after totalPages is defined)
  usePaginationKeyboard({
    currentPage: page,
    totalPages,
    onPageChange: setPage,
    enabled: isActive,
  });

  // Get all tags and models for filters
  const allTags = useMemo(() => getAllTags(), [getAllTags, assets]);
  const allModels = useMemo(() => getAllModels(), [getAllModels, assets]);

  // Handlers
  const handleTypeFilterChange = useCallback(
    (type: AssetType, checked: boolean) => {
      setFilter((f) => {
        const currentTypes = f.types || [];
        if (checked) {
          return { ...f, types: [...currentTypes, type] };
        }
        return { ...f, types: currentTypes.filter((t) => t !== type) };
      });
    },
    [],
  );

  const handleModelFilterChange = useCallback((modelId: string) => {
    setFilter((f) => ({
      ...f,
      models: modelId === "all" ? undefined : [modelId],
    }));
  }, []);

  const handleFavoritesFilterChange = useCallback((checked: boolean) => {
    setFilter((f) => ({ ...f, favoritesOnly: checked }));
  }, []);

  const handleToggleFavorite = useCallback(
    async (asset: AssetMetadata) => {
      await updateAsset(asset.id, { favorite: !asset.favorite });
    },
    [updateAsset],
  );

  const handleDelete = useCallback(
    async (asset: AssetMetadata) => {
      setIsDeleting(true);
      try {
        await deleteAsset(asset.id);
        toast({
          title: t("assets.deleted"),
          description: t("assets.deletedDesc", { name: asset.fileName }),
        });
      } catch {
        toast({
          title: t("common.error"),
          description: t("assets.deleteFailed"),
          variant: "destructive",
        });
      } finally {
        setIsDeleting(false);
        setDeleteConfirmAsset(null);
      }
    },
    [deleteAsset, t],
  );

  const handleBulkDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      const count = await deleteAssets(Array.from(selectedIds));
      toast({
        title: t("assets.deletedBulk"),
        description: t("assets.deletedBulkDesc", { count }),
      });
      setSelectedIds(new Set());
      setIsSelectionMode(false);
    } catch {
      toast({
        title: t("common.error"),
        description: t("assets.deleteFailed"),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowBulkDeleteConfirm(false);
    }
  }, [deleteAssets, selectedIds, t]);

  const handleBulkFavorite = useCallback(
    async (favorite: boolean) => {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await updateAsset(id, { favorite });
      }
      toast({
        title: favorite
          ? t("assets.addedToFavorites")
          : t("assets.removedFromFavorites"),
        description: t("assets.bulkFavoriteDesc", { count: ids.length }),
      });
    },
    [selectedIds, updateAsset, t],
  );

  const handleOpenLocation = useCallback(
    async (asset: AssetMetadata) => {
      await openAssetLocation(asset.id);
    },
    [openAssetLocation],
  );

  const handleDownload = useCallback(
    (asset: AssetMetadata) => {
      // For local files, open in file explorer instead of downloading
      if (asset.filePath) {
        openAssetLocation(asset.id);
        return;
      }

      const url = asset.originalUrl;
      if (!url) return;

      // Create a temporary link and trigger download for remote URLs
      const link = document.createElement("a");
      link.href = url;
      link.download = asset.fileName;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    [openAssetLocation],
  );

  // Load prediction inputs on mount
  useEffect(() => {
    if (!inputsLoaded) loadPredictionInputs();
  }, [inputsLoaded, loadPredictionInputs]);

  // Fetch models to ensure customize button works
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleCustomize = useCallback(
    async (asset: AssetMetadata) => {
      const model = getModelById(asset.modelId);
      if (!model) {
        console.error("[AssetsPage] Model not found for asset:", {
          assetId: asset.id,
          modelId: asset.modelId,
          fileName: asset.fileName,
          allModelIds: useModelsStore.getState().models.map((m) => m.model_id).slice(0, 10),
        });
        toast({
          title: t("common.error"),
          description: t(
            "history.modelNotAvailable",
            `Model not found: ${asset.modelId}`,
          ),
          variant: "destructive",
        });
        return;
      }

      // Build output from asset URL for display in Playground
      const assetUrl =
        asset.originalUrl ||
        (asset.filePath
          ? `local-asset://${encodeURIComponent(asset.filePath)}`
          : "");
      const initialOutputs = assetUrl ? [assetUrl] : [];
      const predictionResult = assetUrl
        ? {
            id: asset.predictionId || asset.id,
            model: asset.modelId,
            status: "completed" as const,
            outputs: initialOutputs,
          }
        : null;

      // Try local storage first
      if (asset.predictionId) {
        const localEntry = getLocalInputs(asset.predictionId);
        if (localEntry?.inputs && Object.keys(localEntry.inputs).length > 0) {
          createTab(model, localEntry.inputs, initialOutputs, predictionResult);
          setPreviewAsset(null);
          navigate(`/playground/${encodeURIComponent(asset.modelId)}`);
          return;
        }

        // Check Playground tabs' generationHistory
        const historyFormValues = findFormValuesByPredictionId(
          asset.predictionId,
        );
        if (historyFormValues) {
          createTab(model, historyFormValues, initialOutputs, predictionResult);
          setPreviewAsset(null);
          navigate(`/playground/${encodeURIComponent(asset.modelId)}`);
          return;
        }
      }

      // Fallback: try API
      if (asset.predictionId) {
        setIsOpeningPlayground(true);
        try {
          const details = await apiClient.getPredictionDetails(
            asset.predictionId,
          );
          const apiInput =
            (details as any).input || (details as any).inputs || {};
          // Use API outputs if available, otherwise use asset URL
          const apiOutputs =
            details.outputs && details.outputs.length > 0
              ? details.outputs
              : initialOutputs;
          createTab(
            model,
            Object.keys(apiInput).length > 0
              ? normalizeApiInputsToFormValues(apiInput)
              : undefined,
            apiOutputs,
            predictionResult,
          );
          setPreviewAsset(null);
          navigate(`/playground/${encodeURIComponent(asset.modelId)}`);
        } catch {
          createTab(model, undefined, initialOutputs, predictionResult);
          setPreviewAsset(null);
          navigate(`/playground/${encodeURIComponent(asset.modelId)}`);
        } finally {
          setIsOpeningPlayground(false);
        }
      } else {
        createTab(model, undefined, initialOutputs, predictionResult);
        setPreviewAsset(null);
        navigate(`/playground/${encodeURIComponent(asset.modelId)}`);
      }
    },
    [
      getModelById,
      getLocalInputs,
      findFormValuesByPredictionId,
      createTab,
      navigate,
      t,
    ],
  );

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredAssets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAssets.map((a) => a.id)));
    }
  }, [filteredAssets, selectedIds.size]);

  const handleToggleSelect = useCallback((assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }, []);

  const handleAddTag = useCallback(async () => {
    if (!tagDialogAsset || !newTag.trim()) return;
    const currentTags = tagDialogAsset.tags || [];
    if (!currentTags.includes(newTag.trim())) {
      await updateAsset(tagDialogAsset.id, {
        tags: [...currentTags, newTag.trim()],
      });
    }
    setNewTag("");
  }, [tagDialogAsset, newTag, updateAsset]);

  const handleRemoveTag = useCallback(
    async (asset: AssetMetadata, tag: string) => {
      await updateAsset(asset.id, {
        tags: asset.tags.filter((t) => t !== tag),
      });
    },
    [updateAsset],
  );

  // Bulk tag handlers
  const handleBulkAddTag = useCallback(
    async (tag: string) => {
      setIsProcessingTags(true);
      try {
        const updates = Array.from(selectedIds).map((id) =>
          updateAsset(id, {
            tags: [
              ...(assets.find((a) => a.id === id)?.tags || []),
              tag,
            ],
          }),
        );
        await Promise.all(updates);
        toast({
          title: t("assets.addTag"),
          description: t("assets.bulkFavoriteDesc", { count: selectedIds.size }),
        });
      } finally {
        setIsProcessingTags(false);
      }
    },
    [selectedIds, assets, updateAsset, t],
  );

  const handleBulkRemoveTag = useCallback(
    async (tag: string) => {
      setIsProcessingTags(true);
      try {
        const updates = Array.from(selectedIds).map((id) =>
          updateAsset(id, {
            tags: (assets.find((a) => a.id === id)?.tags || []).filter(
              (t) => t !== tag,
            ),
          }),
        );
        await Promise.all(updates);
        toast({
          title: t("assets.removeTagFromAll"),
          description: t("assets.bulkFavoriteDesc", { count: selectedIds.size }),
        });
      } finally {
        setIsProcessingTags(false);
      }
    },
    [selectedIds, assets, updateAsset, t],
  );

  const handleBulkReplaceTag = useCallback(
    async (oldTag: string, newTag: string) => {
      setIsProcessingTags(true);
      try {
        const updates = Array.from(selectedIds).map((id) => {
          const asset = assets.find((a) => a.id === id);
          const tags = asset?.tags || [];
          return updateAsset(id, {
            tags: tags.map((t) => (t === oldTag ? newTag : t)),
          });
        });
        await Promise.all(updates);
        toast({
          title: t("assets.replaceTag"),
          description: t("assets.bulkFavoriteDesc", { count: selectedIds.size }),
        });
      } finally {
        setIsProcessingTags(false);
      }
    },
    [selectedIds, assets, updateAsset, t],
  );

  const handleTagFilterToggle = useCallback(
    (tag: string) => {
      setFilter((f) => {
        const current = f.tags || [];
        if (current.includes(tag)) {
          return { ...f, tags: current.filter((t) => t !== tag) };
        }
        return { ...f, tags: [...current, tag] };
      });
    },
    [],
  );

  const handleClearTagFilters = useCallback(() => {
    setFilter((f) => ({ ...f, tags: [] }));
  }, []);


  const handleOpenAssetsFolder = useCallback(async () => {
    if (window.electronAPI?.openAssetsFolder) {
      await window.electronAPI.openAssetsFolder();
    }
  }, []);

  // Folder handlers
  const handleGetFolderAssetCount = useCallback(
    (folderId: string | null) => {
      if (folderId === null) {
        return assets.length;
      }
      if (folderId === NO_FOLDER_ID) {
        return assets.filter((a) => !a.folderId).length;
      }
      return assets.filter((a) => a.folderId === folderId).length;
    },
    [assets],
  );

  const handleFolderCreate = useCallback(async () => {
    setFolderDialogMode("create");
    setEditingFolder(null);
    setShowFolderDialog(true);
  }, []);

  const handleFolderEdit = useCallback(
    async (folder: AssetFolder) => {
      setFolderDialogMode("edit");
      setEditingFolder(folder);
      setShowFolderDialog(true);
    },
    [],
  );

  const handleFolderSubmit = useCallback(
    async (data: { name: string; color: string }) => {
      if (folderDialogMode === "create") {
        await createFolder(data.name, data.color);
        toast({
          title: t("assets.folders.folderCreated", "Folder created"),
          description: t("assets.folders.folderCreatedDesc", '"{{name}}" has been created', {
            name: data.name,
          }),
        });
      } else if (editingFolder) {
        await updateFolder(editingFolder.id, data);
        toast({
          title: t("assets.folders.folderUpdated", "Folder updated"),
          description: t("assets.folders.folderUpdatedDesc", '"{{name}}" has been updated', {
            name: data.name,
          }),
        });
      }
    },
    [folderDialogMode, editingFolder, createFolder, updateFolder, t],
  );

  const handleFolderDelete = useCallback(
    async (folder: AssetFolder) => {
      await deleteFolder(folder.id, null);
      // If we're viewing the deleted folder, switch to All Assets
      if (activeFolderId === folder.id) {
        setActiveFolderId(null);
      }
      toast({
        title: t("assets.folders.folderDeleted", "Folder deleted"),
        description: t("assets.folders.folderDeletedDesc", '"{{name}}" has been deleted', {
          name: folder.name,
        }),
      });
    },
    [activeFolderId, deleteFolder, t],
  );

  const handleAssetsMove = useCallback(
    async (assetIds: string[], folderId: string | null) => {
      await moveAssetsToFolder(assetIds, folderId);
      // Clear selection after move
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      toast({
        title: t("assets.folders.assetsMoved", "Assets moved"),
        description: t("assets.folders.assetsMovedDesc", "{{count}} asset(s) moved to folder", {
          count: assetIds.length,
        }),
      });
    },
    [moveAssetsToFolder, t],
  );

  // Navigate to previous/next asset in preview (with loop support)
  const navigateAsset = useCallback(
    (direction: "prev" | "next") => {
      if (!previewAsset || paginatedAssets.length <= 1) return;
      const currentIdx = paginatedAssets.findIndex(
        (a) => a.id === previewAsset.id,
      );
      if (currentIdx === -1) return;
      let newIdx: number;
      if (direction === "prev") {
        newIdx = currentIdx === 0 ? paginatedAssets.length - 1 : currentIdx - 1;
      } else {
        newIdx = currentIdx === paginatedAssets.length - 1 ? 0 : currentIdx + 1;
      }
      setPreviewAsset(paginatedAssets[newIdx]);
    },
    [previewAsset, paginatedAssets],
  );

  // Keyboard navigation for preview dialog
  useEffect(() => {
    if (!previewAsset || !isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateAsset("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateAsset("next");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, previewAsset, navigateAsset]);

  if (isLoading || !isLoaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full pt-12 md:pt-0">
      {/* Folder Sidebar */}
      {!isCollapsed && (
        <div style={{ width: `${sidebarWidth}px`, minWidth: `${MIN_SIDEBAR_WIDTH}px`, maxWidth: `${MAX_SIDEBAR_WIDTH}px` }} className="flex-shrink-0 relative">
          {/* Collapse button */}
          <button
            className="absolute top-2 right-2 z-10 p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            onClick={toggleSidebarCollapse}
            title={t("assets.collapseFolderPanel", "Collapse")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <FolderSidebar
            folders={folders}
            activeFolderId={activeFolderId}
            onFolderSelect={setActiveFolderId}
            onFolderCreate={handleFolderCreate}
            onFolderUpdate={(f, updates) => {
              if (updates.name || updates.color) {
                handleFolderEdit(f);
              }
            }}
            onFolderDelete={handleFolderDelete}
            onAssetsMove={handleAssetsMove}
            getAssetCount={handleGetFolderAssetCount}
          />
        </div>
      )}

      {/* Resize Handle / Expand Button when collapsed */}
      {isCollapsed ? (
        <button
          className="w-1 bg-border/50 hover:bg-primary/50 cursor-pointer flex-shrink-0 transition-colors flex items-center justify-center group"
          onClick={toggleSidebarCollapse}
          title={t("assets.expandFolderPanel", "Expand")}
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      ) : (
        <div
          className={cn(
            "w-1 bg-border/50 hover:bg-primary/50 cursor-col-resize flex-shrink-0 transition-colors relative z-50",
            isResizing && "bg-primary cursor-col-resizing",
          )}
          style={{ cursor: isResizing ? "col-resize" : "col-resize" }}
          onMouseDown={handleResizeStart}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="page-header px-4 md:px-6 py-4 border-b border-border/70 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
        <div className="flex flex-col gap-1.5 md:flex-row md:items-baseline md:gap-3 mb-4">
          <h1 className="flex items-center gap-2 text-xl md:text-2xl font-bold tracking-tight">
            <FolderHeart className="h-5 w-5 text-primary" />
            {t("assets.title")}
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            {t("assets.subtitle", { count: assets.length })}
          </p>
        </div>

        {/* Prediction ID Filter Banner */}
        {predictionIdFilter && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 mb-3">
            <span className="text-sm text-primary">
              {t("assets.filteredByPrediction", "Filtered by prediction:")} {predictionIdFilter.slice(0, 8)}...
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-primary hover:bg-primary/20"
              onClick={() => navigate("/assets")}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("assets.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-lg border-border/80 bg-background pl-9"
            />
          </div>
          <Select
            value={filter.sortBy || "date-desc"}
            onValueChange={(value) =>
              setFilter((f) => ({ ...f, sortBy: value as AssetSortBy }))
            }
          >
            <SelectTrigger className="h-9 w-full rounded-lg border-border/80 bg-background sm:w-[170px]">
              <ArrowUpDown className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date-desc">
                {t("assets.sort.dateNewest")}
              </SelectItem>
              <SelectItem value="date-asc">
                {t("assets.sort.dateOldest")}
              </SelectItem>
              <SelectItem value="name-asc">
                {t("assets.sort.nameAZ")}
              </SelectItem>
              <SelectItem value="name-desc">
                {t("assets.sort.nameZA")}
              </SelectItem>
              <SelectItem value="size-desc">
                {t("assets.sort.sizeLargest")}
              </SelectItem>
              <SelectItem value="size-asc">
                {t("assets.sort.sizeSmallest")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={(filter.models && filter.models[0]) || "all"}
            onValueChange={handleModelFilterChange}
          >
            <SelectTrigger className="h-9 w-full rounded-lg border-border/80 bg-background sm:w-[170px]">
              <SelectValue placeholder={t("assets.allModels")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("assets.allModels")}</SelectItem>
              {allModels.map((modelId) => (
                <SelectItem key={modelId} value={modelId}>
                  {modelId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={loadPreviews ? "default" : "outline"}
            size="icon"
            onClick={() => setLoadPreviews(!loadPreviews)}
            title={
              loadPreviews
                ? t("assets.disablePreviews")
                : t("assets.loadPreviews")
            }
            className="h-9 w-9 rounded-lg"
          >
            {loadPreviews ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant={filter.favoritesOnly ? "default" : "outline"}
            size="icon"
            onClick={() => handleFavoritesFilterChange(!filter.favoritesOnly)}
            title={t("assets.showFavoritesOnly")}
            className="h-9 w-9 rounded-lg"
          >
            <Star
              className={cn("h-4 w-4", filter.favoritesOnly && "fill-current")}
            />
          </Button>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="icon"
            onClick={() => setShowFilters(!showFilters)}
            className="h-9 w-9 rounded-lg"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
          <div className="flex-1" />
          {isSelectionMode ? (
            <>
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                {selectedIds.size === filteredAssets.length ? (
                  <>
                    <Square className="mr-2 h-4 w-4" />
                    {t("assets.deselectAll")}
                  </>
                ) : (
                  <>
                    <CheckSquare className="mr-2 h-4 w-4" />
                    {t("assets.selectAll")}
                  </>
                )}
              </Button>
              {selectedIds.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkFavorite(true)}
                  >
                    <Star className="mr-2 h-4 w-4" />
                    {t("assets.addToFavorites")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkFavorite(false)}
                  >
                    <Star className="mr-2 h-4 w-4" />
                    {t("assets.removeFromFavorites")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowBulkTagEdit(true)}
                  >
                    <Tag className="mr-2 h-4 w-4" />
                    {t("assets.manageTags")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowBulkFolderMove(true)}
                  >
                    <FolderHeart className="mr-2 h-4 w-4" />
                    {t("assets.moveToFolder")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowBulkDeleteConfirm(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("assets.deleteSelected", { count: selectedIds.size })}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedIds(new Set());
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsSelectionMode(true)}
              >
                <CheckSquare className="mr-2 h-4 w-4" />
                {t("assets.select")}
              </Button>
              {isDesktopMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenAssetsFolder}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  {t("assets.openFolder")}
                </Button>
              )}
            </>
          )}
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-3 space-y-2">
            {/* Source tabs */}
            <div className="flex items-end gap-0.5">
              {[
                {
                  value: "playground" as const,
                  label: "Playground",
                  icon: Sparkles,
                },
                {
                  value: "workflow" as const,
                  label: "Workflow",
                  icon: GitBranch,
                },
                {
                  value: "free-tool" as const,
                  label: "Free Tool",
                  icon: Wrench,
                },
                { value: "z-image" as const, label: "Z-Image", icon: Cpu },
              ].map(({ value, label, icon: Icon }) => {
                const isActive = (filter.sources || []).includes(value);
                return (
                  <button
                    key={value}
                    onClick={() => {
                      setFilter((f) => {
                        const current = f.sources || [];
                        return {
                          ...f,
                          sources: isActive
                            ? current.filter((s) => s !== value)
                            : [...current, value],
                        };
                      });
                    }}
                    className={cn(
                      "relative inline-flex items-center gap-1.5 px-3 pb-2 text-[13px] font-medium transition-colors",
                      "cursor-pointer select-none",
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground/60 hover:text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                    <span
                      className={cn(
                        "absolute bottom-0 left-[6%] right-[6%] h-[2.5px] rounded-full transition-colors",
                        isActive ? "bg-primary" : "bg-muted-foreground/25",
                      )}
                    />
                  </button>
                );
              })}
            </div>

            {/* Type pills */}
            <div className="flex flex-wrap items-center gap-1.5 pl-3">
              {(["image", "video", "audio", "text"] as AssetType[]).map(
                (type) => {
                  const isActive = (filter.types || []).includes(type);
                  return (
                    <button
                      key={type}
                      onClick={() => handleTypeFilterChange(type, !isActive)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all",
                        "cursor-pointer select-none",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <AssetTypeIcon type={type} className="h-3.5 w-3.5" />
                      {t(`assets.typesPlural.${type}`)}
                    </button>
                  );
                },
              )}
            </div>

            {/* Tag filter chips */}
            <div className="pl-3">
              <TagFilterChips
                allTags={allTags}
                activeTags={filter.tags || []}
                onTagToggle={handleTagFilterToggle}
                onClearAll={handleClearTagFilters}
              />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">
              {t("assets.noAssets")}
            </h2>
            <p className="text-muted-foreground mb-4 max-w-md">
              {assets.length === 0
                ? t("assets.noAssetsDesc")
                : t("assets.noMatchingAssets")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {paginatedAssets.map((asset, index) => {
              return (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  assetKey={asset.filePath || asset.originalUrl || asset.id}
                  index={index}
                  loadPreviews={loadPreviews}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedIds.has(asset.id)}
                  selectedIds={selectedIds}
                  onToggleSelect={handleToggleSelect}
                  onSelect={setPreviewAsset}
                  onOpenLocation={handleOpenLocation}
                  onDownload={handleDownload}
                  onToggleFavorite={handleToggleFavorite}
                  onManageTags={setTagDialogAsset}
                  onDelete={setDeleteConfirmAsset}
                  onPreviewLoaded={markPreviewLoaded}
                  onCustomize={handleCustomize}
                />
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Pagination */}
      {totalPages > 0 && (
        <AssetPagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={filteredAssets.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      {/* Preview Dialog */}
      <Dialog open={!!previewAsset} onOpenChange={() => setPreviewAsset(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {deferredPreviewAsset?.fileName}
              {paginatedAssets.length > 1 && deferredPreviewAsset && (
                <span className="text-sm font-normal text-muted-foreground">
                  (
                  {paginatedAssets.findIndex(
                    (a) => a.id === deferredPreviewAsset.id,
                  ) + 1}
                  /{paginatedAssets.length})
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {deferredPreviewAsset?.modelId} ·{" "}
              {deferredPreviewAsset &&
                formatDate(deferredPreviewAsset.createdAt)}
              {deferredPreviewAsset?.source === "workflow" &&
                deferredPreviewAsset?.workflowName && (
                  <>
                    {" "}
                    · <GitBranch className="inline h-3 w-3" />{" "}
                    {deferredPreviewAsset.workflowName}
                  </>
                )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto relative">
            {/* Navigation buttons */}
            {paginatedAssets.length > 1 && (
              <>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => navigateAsset("prev")}
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full opacity-80 hover:opacity-100"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => navigateAsset("next")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full opacity-80 hover:opacity-100"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </>
            )}
            {deferredPreviewAsset?.type === "image" && (
              <img
                src={getAssetUrl(deferredPreviewAsset)}
                alt={deferredPreviewAsset.fileName}
                className="max-w-full max-h-[60vh] mx-auto object-contain"
              />
            )}
            {deferredPreviewAsset?.type === "video" && (
              <video
                src={getAssetUrl(deferredPreviewAsset)}
                controls
                className="max-w-full max-h-[60vh] mx-auto"
              />
            )}
            {deferredPreviewAsset?.type === "audio" && (
              <div className="flex items-center justify-center p-8">
                <audio
                  src={getAssetUrl(deferredPreviewAsset)}
                  controls
                  className="w-full max-w-md"
                />
              </div>
            )}
            {(deferredPreviewAsset?.type === "text" ||
              deferredPreviewAsset?.type === "json") && (
              <div className="p-4 bg-muted rounded-lg text-sm">
                <p className="text-muted-foreground">
                  {t("assets.textPreviewUnavailable")}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            {deferredPreviewAsset?.modelId && (
              <Button
                variant="default"
                onClick={() =>
                  deferredPreviewAsset && handleCustomize(deferredPreviewAsset)
                }
                disabled={isOpeningPlayground}
              >
                {isOpeningPlayground ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {t("common.customize", "Customize")}
              </Button>
            )}
            {isDesktopMode ? (
              <Button
                variant="outline"
                onClick={() =>
                  deferredPreviewAsset &&
                  handleOpenLocation(deferredPreviewAsset)
                }
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                {t("assets.openLocation")}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() =>
                  deferredPreviewAsset && handleDownload(deferredPreviewAsset)
                }
              >
                <Download className="mr-2 h-4 w-4" />
                {t("common.download")}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                deferredPreviewAsset &&
                handleToggleFavorite(deferredPreviewAsset)
              }
            >
              <Star
                className={cn(
                  "mr-2 h-4 w-4",
                  deferredPreviewAsset?.favorite && "fill-yellow-400",
                )}
              />
              {deferredPreviewAsset?.favorite
                ? t("assets.unfavorite")
                : t("assets.favorite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteConfirmAsset}
        onOpenChange={() => setDeleteConfirmAsset(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("assets.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("assets.deleteConfirmDesc", {
                name: deleteConfirmAsset?.fileName,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteConfirmAsset && handleDelete(deleteConfirmAsset)
              }
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog
        open={showBulkDeleteConfirm}
        onOpenChange={setShowBulkDeleteConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("assets.bulkDeleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("assets.bulkDeleteConfirmDesc", { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t("assets.deleteSelected", { count: selectedIds.size })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tag Management Dialog */}
      <Dialog
        open={!!tagDialogAsset}
        onOpenChange={() => setTagDialogAsset(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("assets.manageTags")}</DialogTitle>
            <DialogDescription>
              {t("assets.manageTagsDesc", { name: tagDialogAsset?.fileName })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Current tags */}
            <div className="space-y-2">
              <Label>{t("assets.currentTags")}</Label>
              <div className="flex flex-wrap gap-2">
                {tagDialogAsset?.tags.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("assets.noTags")}
                  </p>
                )}
                {tagDialogAsset?.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="flex items-center gap-1"
                  >
                    {tag}
                    <button
                      onClick={() =>
                        tagDialogAsset && handleRemoveTag(tagDialogAsset, tag)
                      }
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            {/* Add new tag */}
            <div className="space-y-2">
              <Label>{t("assets.addTag")}</Label>
              <div className="flex gap-2">
                <Input
                  placeholder={t("assets.tagPlaceholder")}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  list="tag-suggestions"
                />
                <datalist id="tag-suggestions">
                  {allTags
                    .filter((t) => !tagDialogAsset?.tags.includes(t))
                    .map((tag) => (
                      <option key={tag} value={tag} />
                    ))}
                </datalist>
                <Button onClick={handleAddTag} disabled={!newTag.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagDialogAsset(null)}>
              {t("common.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Tag Edit Dialog */}
      <BulkTagEditDialog
        open={showBulkTagEdit}
        onOpenChange={setShowBulkTagEdit}
        selectedCount={selectedIds.size}
        availableTags={allTags}
        onAddTag={handleBulkAddTag}
        onRemoveTag={handleBulkRemoveTag}
        onReplaceTag={handleBulkReplaceTag}
        isProcessing={isProcessingTags}
      />

      {/* Bulk Folder Move Dialog */}
      <Dialog open={showBulkFolderMove} onOpenChange={setShowBulkFolderMove}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("assets.moveToFolder", "Move to Folder")}
            </DialogTitle>
            <DialogDescription>
              {t("assets.moveToFolderDescription", {
                count: selectedIds.size,
              })}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 py-4 pr-4">
              {/* "No Folder" option */}
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  moveAssetsToFolder(Array.from(selectedIds), null);
                  setShowBulkFolderMove(false);
                  setSelectedIds(new Set());
                  setIsSelectionMode(false);
                }}
              >
                <FolderMinus className="mr-2 h-4 w-4" />
                {t("assets.folders.noFolder", "No Folder")}
              </Button>
              {/* Folder list */}
              {folders.map((folder) => (
                <Button
                  key={folder.id}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    moveAssetsToFolder(Array.from(selectedIds), folder.id);
                    setShowBulkFolderMove(false);
                    setSelectedIds(new Set());
                    setIsSelectionMode(false);
                  }}
                >
                  <div
                    className={cn(
                      "h-3 w-1 rounded-full mr-2",
                      getFolderColorClass(folder.color),
                    )}
                  />
                  {folder.name}
                </Button>
              ))}
              {folders.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("assets.folders.noFolders", "No folders yet")}
                </p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkFolderMove(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Create/Edit Dialog */}
      <FolderCreateDialog
        open={showFolderDialog}
        onOpenChange={setShowFolderDialog}
        mode={folderDialogMode}
        folder={editingFolder ?? undefined}
        existingFolders={folders}
        onSubmit={handleFolderSubmit}
      />
    </div>
    {/* End main content */}
    </div>
  );
}
