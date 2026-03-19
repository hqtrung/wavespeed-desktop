import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Folder, FolderOpen, Search, X } from "lucide-react";
import type { AssetFolder } from "@/types/asset";
import { NO_FOLDER_ID } from "@/types/asset";
import { FolderItem } from "./FolderItem";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FolderSidebarProps {
  folders: AssetFolder[];
  activeFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  onFolderCreate: () => void;
  onFolderUpdate: (folder: AssetFolder, updates: Partial<AssetFolder>) => void;
  onFolderDelete: (folder: AssetFolder) => void;
  onFolderExport?: (folder: AssetFolder) => void;
  onAssetsMove: (assetIds: string[], folderId: string | null) => void;
  getAssetCount: (folderId: string | null) => number;
  // Optional width for resizable panel
  width?: string;
  // Collapsed state (controlled by parent)
  isCollapsed?: boolean;
}

export function FolderSidebar({
  folders,
  activeFolderId,
  onFolderSelect,
  onFolderCreate,
  onFolderUpdate,
  onFolderDelete,
  onFolderExport,
  onAssetsMove,
  getAssetCount,
  width,
  isCollapsed = false,
}: FolderSidebarProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  // Memoize folder counts to avoid recalculation on every render
  const { allAssetsCount, noFolderCount, folderCounts } = useMemo(() => ({
    allAssetsCount: getAssetCount(null),
    noFolderCount: getAssetCount(NO_FOLDER_ID),
    folderCounts: new Map(
      folders.map((f) => [f.id, getAssetCount(f.id)]),
    ),
  }), [folders, getAssetCount]);

  // Filter folders based on search query
  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return folders;
    const query = searchQuery.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(query));
  }, [folders, searchQuery]);

  const handleDrop = (assetIds: string[], folderId: string) => {
    // Convert NO_FOLDER_ID to null when moving assets to "No Folder"
    onAssetsMove(assetIds, folderId === NO_FOLDER_ID ? null : folderId);
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full border-r border-border/70 bg-muted/30",
        isCollapsed ? "w-12" : width || "w-56",
      )}
    >
      {/* Header */}
      <div className="flex flex-col gap-2 px-3 py-3 border-b border-border/70">
        {!isCollapsed && (
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Folder className="h-4 w-4 text-muted-foreground" />
            {t("assets.folders.title", "Folders")}
          </h2>
        )}

        {/* Search input */}
        {!isCollapsed && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t("assets.searchFolders", "Search folders...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-7 pr-7 text-xs"
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Folder list */}
      <ScrollArea className="flex-1 w-full">
        <div className="p-2 space-y-1 w-full">
          {/* All Assets */}
          <FolderItem
            folder={null}
            isActive={activeFolderId === null}
            assetCount={allAssetsCount}
            onClick={() => onFolderSelect(null)}
            isCollapsed={isCollapsed}
          />

          {/* No Folder (unassigned assets) */}
          <FolderItem
            folder={{ id: NO_FOLDER_ID, name: "No Folder", color: "gray", createdAt: "" }}
            isActive={activeFolderId === NO_FOLDER_ID}
            assetCount={noFolderCount}
            onClick={() => onFolderSelect(NO_FOLDER_ID)}
            isCollapsed={isCollapsed}
            isNoFolder
          />

          {/* Custom folders */}
          {filteredFolders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              isActive={activeFolderId === folder.id}
              assetCount={folderCounts.get(folder.id) || 0}
              onClick={() => onFolderSelect(folder.id)}
              onRename={(f) => onFolderUpdate(f, {})}
              onDelete={onFolderDelete}
              onExport={onFolderExport}
              onDrop={(ids) => handleDrop(ids, folder.id)}
              isCollapsed={isCollapsed}
            />
          ))}

          {/* Empty state */}
          {!isCollapsed && filteredFolders.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground px-2">
              {folders.length === 0 ? (
                <>
                  <p>{t("assets.folders.noFolders")}</p>
                  <p className="text-xs mt-1">
                    {t("assets.folders.createFirstFolder")}
                  </p>
                </>
              ) : (
                <p>{t("assets.folders.noFoldersMatch", "No folders match your search")}</p>
              )}
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
