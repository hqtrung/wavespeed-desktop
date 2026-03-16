import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { AssetFolder } from "@/types/asset";
import { FOLDER_COLORS, DEFAULT_FOLDER_COLOR } from "./folder-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FolderCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  folder?: AssetFolder;
  existingFolders?: AssetFolder[];
  onSubmit: (data: { name: string; color: string }) => void;
}

export function FolderCreateDialog({
  open,
  onOpenChange,
  mode,
  folder,
  existingFolders = [],
  onSubmit,
}: FolderCreateDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_FOLDER_COLOR);
  const [nameError, setNameError] = useState<string>("");

  // Reset form when dialog opens or mode changes
  useEffect(() => {
    if (open) {
      if (mode === "edit" && folder) {
        setName(folder.name);
        setColor(folder.color);
      } else {
        setName("");
        setColor(DEFAULT_FOLDER_COLOR);
      }
      setNameError("");
    }
  }, [open, mode, folder]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate name
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError(t("assets.folders.folderNameRequired"));
      return;
    }

    // Check for duplicate names (excluding current folder when editing)
    const duplicate = existingFolders.find(
      (f) => f.name.toLowerCase() === trimmedName.toLowerCase() && f.id !== folder?.id,
    );
    if (duplicate) {
      setNameError(t("assets.folders.folderExists"));
      return;
    }

    onSubmit({ name: trimmedName, color });
    onOpenChange(false);
  };

  const title = mode === "create"
    ? t("assets.folders.createFolder")
    : t("assets.folders.renameFolder");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? t("assets.folders.createFolderDesc", "Create a new folder to organize your assets")
              : t("assets.folders.renameFolderDesc", "Rename this folder")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name input */}
          <div className="space-y-2">
            <Label htmlFor="folder-name">
              {t("assets.folders.folderName")}
            </Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError("");
              }}
              placeholder={t("assets.folders.folderNamePlaceholder", "My Folder")}
              maxLength={50}
              className={cn(nameError && "border-destructive")}
              autoFocus
            />
            {nameError && (
              <p className="text-sm text-destructive">{nameError}</p>
            )}
          </div>

          {/* Color picker */}
          <div className="space-y-2">
            <Label>{t("assets.folders.folderColor")}</Label>
            <div className="grid grid-cols-6 gap-2">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={cn(
                    "h-10 rounded-lg border-2 transition-all hover:scale-105",
                    color === c.value
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: c.value }}
                  onClick={() => setColor(c.value)}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit">
              {mode === "create" ? t("common.create") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
