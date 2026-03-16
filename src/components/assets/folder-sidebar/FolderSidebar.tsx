import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ChevronRight, ChevronLeft, Folder } from "lucide-react";
import type { AssetFolder } from "@/types/asset";
import { FolderItem } from "./FolderItem";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface FolderSidebarProps {
  folders: AssetFolder[];
  activeFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  onFolderCreate: () => void;
  onFolderUpdate: (folder: AssetFolder, updates: Partial<AssetFolder>) => void;
  onFolderDelete: (folder: AssetFolder) => void;
  onAssetsMove: (assetIds: string[], folderId: string | null) => void;
  getAssetCount: (folderId: string | null) => number;
}

export function FolderSidebar({
  folders,
  activeFolderId,
  onFolderSelect,
  onFolderCreate,
  onFolderUpdate,
  onFolderDelete,
  onAssetsMove,
  getAssetCount,
}: FolderSidebarProps) {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const allAssetsCount = getAssetCount(null);
  const folderCounts = new Map(
    folders.map((f) => [f.id, getAssetCount(f.id)]),
  );

  const handleDrop = (assetIds: string[], folderId: string) => {
    onAssetsMove(assetIds, folderId);
  };

  return (
    <div
      className={cn(
        "flex flex-col border-r border-border/70 bg-muted/30",
        isCollapsed ? "w-12" : "w-56",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border/70">
        {!isCollapsed && (
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Folder className="h-4 w-4 text-muted-foreground" />
            {t("assets.folders.title", "Folders")}
          </h2>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Folder list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* All Assets */}
          <FolderItem
            folder={null}
            isActive={activeFolderId === null}
            assetCount={allAssetsCount}
            onClick={() => onFolderSelect(null)}
            isCollapsed={isCollapsed}
          />

          {/* Custom folders */}
          {folders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              isActive={activeFolderId === folder.id}
              assetCount={folderCounts.get(folder.id) || 0}
              onClick={() => onFolderSelect(folder.id)}
              onRename={(f) => onFolderUpdate(f, {})}
              onDelete={onFolderDelete}
              onDrop={(ids) => handleDrop(ids, folder.id)}
              isCollapsed={isCollapsed}
            />
          ))}

          {/* Empty state */}
          {!isCollapsed && folders.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground px-2">
              <p>{t("assets.folders.noFolders")}</p>
              <p className="text-xs mt-1">
                {t("assets.folders.createFirstFolder")}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Create folder button */}
      <div className="p-2 border-t border-border/70">
        <Button
          variant={isCollapsed ? "ghost" : "outline"}
          size={isCollapsed ? "icon" : "sm"}
          className={cn(
            "w-full",
            isCollapsed && "h-8 w-8 mx-auto",
          )}
          onClick={onFolderCreate}
        >
          {isCollapsed ? (
            <Plus className="h-4 w-4" />
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              {t("assets.folders.createFolder")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
