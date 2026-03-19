import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, FolderOpen, MoreVertical, Trash2, Edit3, FolderMinus, Download } from "lucide-react";
import type { AssetFolder } from "@/types/asset";
import { getFolderColorClass } from "./folder-colors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FolderItemProps {
  folder: AssetFolder | null; // null = "All Assets"
  isActive: boolean;
  assetCount: number;
  onClick: () => void;
  onRename?: (folder: AssetFolder) => void;
  onDelete?: (folder: AssetFolder) => void;
  onExport?: (folder: AssetFolder) => void;
  onDrop?: (assetIds: string[]) => void;
  isCollapsed?: boolean;
  isNoFolder?: boolean; // Special "No Folder" item for unassigned assets
}

export function FolderItem({
  folder,
  isActive,
  assetCount,
  onClick,
  onRename,
  onDelete,
  onExport,
  onDrop,
  isCollapsed = false,
  isNoFolder = false,
}: FolderItemProps) {
  const { t } = useTranslation();
  const dragCounter = useRef(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const isAllAssets = folder === null;
  const folderName = isAllAssets
    ? t("assets.folders.allAssets")
    : isNoFolder
      ? t("assets.folders.noFolder", "No Folder")
      : folder.name;
  const colorClass = isAllAssets
    ? "bg-slate-500"
    : isNoFolder
      ? "bg-dashed border border-dashed border-muted-foreground/50"
      : getFolderColorClass(folder.color);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (onDrop && !isAllAssets) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = onDrop && !isAllAssets ? "move" : "none";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOver(false);

    if (onDrop && !isAllAssets) {
      try {
        const data = e.dataTransfer.getData("asset-ids");
        if (data) {
          const assetIds = JSON.parse(data) as string[];
          onDrop(assetIds);
        }
      } catch {
        // Invalid data, ignore
      }
    }
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
        isActive && "bg-accent",
        !isActive && "hover:bg-accent/50",
        isDraggingOver && "ring-2 ring-primary",
        isNoFolder && "border border-dashed border-muted-foreground/30",
      )}
      onClick={onClick}
      onDragEnter={onDrop ? handleDragEnter : undefined}
      onDragLeave={onDrop ? handleDragLeave : undefined}
      onDragOver={onDrop ? handleDragOver : undefined}
      onDrop={onDrop ? handleDrop : undefined}
    >
      {/* Color indicator */}
      {isNoFolder ? (
        <div className="h-3 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
      ) : (
        <div className={cn("h-3 w-1 shrink-0 rounded-full", colorClass)} />
      )}

      {/* Folder icon */}
      {isNoFolder ? (
        <FolderMinus className="h-4 w-4 shrink-0 text-muted-foreground/60" />
      ) : isActive ? (
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}

      {/* Folder name */}
      {!isCollapsed && (
        <span
          className={cn(
            "truncate flex-1 min-w-0",
            isNoFolder && "text-muted-foreground/70",
          )}
        >
          {folderName}
        </span>
      )}

      {/* Asset count */}
      {!isCollapsed && (
        <span
          className={cn(
            "text-xs shrink-0",
            isActive ? "text-foreground" : "text-muted-foreground",
            isNoFolder && "text-muted-foreground/60",
          )}
        >
          {assetCount}
        </span>
      )}

      {/* Context menu for custom folders only (not for No Folder) */}
      {!isAllAssets && !isNoFolder && folder && onRename && onDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100",
                isCollapsed && "mx-auto",
              )}
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
              <Edit3 className="mr-2 h-4 w-4" />
              {t("assets.folders.renameFolder")}
              <button
                className="ml-auto w-full h-full absolute left-0 top-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(folder);
                }}
              />
            </DropdownMenuItem>
            {onExport && (
              <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                <Download className="mr-2 h-4 w-4" />
                {t("assets.folders.exportFolder", "Export")}
                <button
                  className="ml-auto w-full h-full absolute left-0 top-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExport(folder);
                  }}
                />
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive"
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("assets.folders.deleteFolder")}
              <button
                className="ml-auto w-full h-full absolute left-0 top-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(folder);
                }}
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Drag over indicator */}
      {isDraggingOver && (
        <div className="absolute inset-0 bg-primary/10 rounded-lg pointer-events-none" />
      )}
    </div>
  );
}
