import { useRef, useState, useEffect, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  Image,
  Video,
  Music,
  FileText,
  Star,
  MoreVertical,
  Trash2,
  FolderOpen,
  Download,
  Tag,
  GitBranch,
  Sparkles,
} from "lucide-react";
import type { AssetMetadata, AssetType, AssetFolder } from "@/types/asset";
import { getFolderName, getFolderColor, getFolderColorClass } from "@/components/assets/folder-sidebar";
import { formatBytes } from "@/types/progress";
import { useInView } from "@/hooks/useInView";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Check if running in desktop mode
export const isDesktopMode = !!window.electronAPI?.saveAsset;

// Get asset URL for preview (local-asset:// in desktop for proper video/audio support)
export function getAssetUrl(asset: AssetMetadata): string {
  // Use local file if available
  if (asset.locallyAvailable && asset.filePath) {
    return `local-asset://${encodeURIComponent(asset.filePath)}`;
  }
  // Fall back to original URL (R2 or remote)
  return asset.originalUrl || "";
}

// Format date
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Video preview component - shows first frame, plays on hover
export function VideoPreview({ src, enabled }: { src: string; enabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleMouseEnter = () => {
    if (videoRef.current && isLoaded && enabled) {
      videoRef.current.play().catch(() => {
        // Ignore autoplay errors
      });
    }
  };

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  if (!enabled || hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Video className="h-12 w-12 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="w-full h-full relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
          <Video className="h-12 w-12 text-muted-foreground" />
        </div>
      )}
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
      />
    </div>
  );
}

// Asset type icon component
export function AssetTypeIcon({
  type,
  className,
}: {
  type: AssetType;
  className?: string;
}) {
  switch (type) {
    case "image":
      return <Image className={className} />;
    case "video":
      return <Video className={className} />;
    case "audio":
      return <Music className={className} />;
    case "text":
    case "json":
      return <FileText className={className} />;
  }
}

export interface AssetCardProps {
  asset: AssetMetadata;
  assetKey: string;
  index: number;
  loadPreviews: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  selectedIds: Set<string>;
  folders: AssetFolder[];
  onToggleSelect: (id: string) => void;
  onSelect: (asset: AssetMetadata) => void;
  onOpenLocation: (asset: AssetMetadata) => void;
  onDownload: (asset: AssetMetadata) => void;
  onToggleFavorite: (asset: AssetMetadata) => void;
  onManageTags: (asset: AssetMetadata) => void;
  onDelete: (asset: AssetMetadata) => void;
  onPreviewLoaded: (key: string) => void;
  onCustomize: (asset: AssetMetadata) => void;
}

export const AssetCard = memo(function AssetCard({
  asset,
  assetKey,
  index,
  loadPreviews,
  isSelectionMode,
  isSelected,
  selectedIds,
  folders,
  onToggleSelect,
  onSelect,
  onOpenLocation,
  onDownload,
  onToggleFavorite,
  onManageTags,
  onDelete,
  onPreviewLoaded,
  onCustomize,
}: AssetCardProps) {
  const { t } = useTranslation();
  const { ref, isInView } = useInView<HTMLDivElement>();
  const assetUrl = getAssetUrl(asset);
  const shouldLoad = loadPreviews && isInView;

  useEffect(() => {
    if (!loadPreviews || !isInView || !assetUrl) return;
    onPreviewLoaded(assetKey);
  }, [assetKey, assetUrl, isInView, loadPreviews, onPreviewLoaded]);

  const handleDragStart = (e: React.DragEvent) => {
    const assetIds = isSelected && selectedIds.size > 1
      ? Array.from(selectedIds)
      : [asset.id];

    e.dataTransfer.setData("asset-ids", JSON.stringify(assetIds));
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.classList.add("opacity-50");
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove("opacity-50");
  };

  return (
    <div
      draggable
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/70 bg-card/85 shadow-sm transition-all hover:shadow-md animate-in fade-in slide-in-from-bottom-2 fill-mode-both cursor-grab active:cursor-grabbing",
        isSelected && "ring-2 ring-primary",
      )}
      style={{ animationDelay: `${Math.min(index, 19) * 30}ms` }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* Thumbnail */}
      <div
        ref={ref}
        className="aspect-square bg-muted flex items-center justify-center cursor-pointer"
        onClick={() =>
          isSelectionMode ? onToggleSelect(asset.id) : onSelect(asset)
        }
      >
        {asset.type === "image" && shouldLoad && assetUrl ? (
          <img
            src={assetUrl}
            alt={asset.fileName}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : asset.type === "video" && shouldLoad && assetUrl ? (
          <VideoPreview src={assetUrl} enabled={shouldLoad} />
        ) : (
          <AssetTypeIcon
            type={asset.type}
            className="h-12 w-12 text-muted-foreground"
          />
        )}

        {/* Selection checkbox overlay */}
        {isSelectionMode && (
          <div
            className="absolute top-2 left-2"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(asset.id)}
              className="bg-background"
            />
          </div>
        )}

        {/* Type badge */}
        {!isSelectionMode && (
          <Badge variant="secondary" className="absolute top-2 left-2 text-xs">
            <AssetTypeIcon type={asset.type} className="h-3 w-3 mr-1" />
            {t(`assets.types.${asset.type}`)}
          </Badge>
        )}
        {/* Quick actions — top right */}
        {!isSelectionMode && (
          <div className="absolute top-2 right-2 flex gap-1.5 z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(asset);
              }}
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded-md backdrop-blur-sm transition-colors",
                asset.favorite
                  ? "bg-yellow-500/80 text-white hover:bg-yellow-500"
                  : "bg-black/60 text-white hover:bg-black/80",
              )}
              title={
                asset.favorite ? t("assets.unfavorite") : t("assets.favorite")
              }
            >
              <Star
                className={cn("h-3 w-3", asset.favorite && "fill-current")}
              />
            </button>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate" title={asset.fileName}>
              {asset.fileName}
            </p>
            {/* Folder badge or "No Folder" */}
            {(() => {
              const folderName = asset.folderId
                ? getFolderName(asset.folderId, folders)
                : undefined;
              const folderColor = asset.folderId
                ? getFolderColor(asset.folderId, folders)
                : undefined;

              return asset.folderId && folderName ? (
                <div className="flex items-center gap-1">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      getFolderColorClass(folderColor),
                    )}
                  />
                  <span
                    className="text-xs text-muted-foreground truncate"
                    title={folderName}
                  >
                    {folderName}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("assets.noFolder", "No Folder")}
                </span>
              );
            })()}
            <p className="text-xs text-muted-foreground">
              {formatDate(asset.createdAt)} · {formatBytes(asset.fileSize)}
            </p>
          </div>

          {/* Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onCustomize(asset)}>
                <Sparkles className="mr-2 h-4 w-4" />
                {t("common.customize", "Customize")}
              </DropdownMenuItem>
              {isDesktopMode ? (
                <DropdownMenuItem onClick={() => onOpenLocation(asset)}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  {t("assets.openLocation")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onDownload(asset)}>
                  <Download className="mr-2 h-4 w-4" />
                  {t("common.download")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onToggleFavorite(asset)}>
                <Star
                  className={cn(
                    "mr-2 h-4 w-4",
                    asset.favorite && "fill-yellow-400",
                  )}
                />
                {asset.favorite ? t("assets.unfavorite") : t("assets.favorite")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onManageTags(asset)}>
                <Tag className="mr-2 h-4 w-4" />
                {t("assets.manageTags")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(asset)}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Tags */}
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {asset.tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="rounded-md border-border/70 bg-background text-xs"
              >
                {tag}
              </Badge>
            ))}
            {asset.tags.length > 3 && (
              <Badge
                variant="outline"
                className="rounded-md border-border/70 bg-background text-xs"
              >
                +{asset.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
