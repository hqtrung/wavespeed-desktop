import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag, Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface BulkTagEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  availableTags: string[];
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  onReplaceTag: (oldTag: string, newTag: string) => Promise<void>;
  isProcessing?: boolean;
}

export function BulkTagEditDialog({
  open,
  onOpenChange,
  selectedCount,
  availableTags,
  onAddTag,
  onRemoveTag,
  onReplaceTag,
  isProcessing = false,
}: BulkTagEditDialogProps) {
  const { t } = useTranslation();
  const [newTag, setNewTag] = useState("");
  const [replaceFromTag, setReplaceFromTag] = useState("");
  const [replaceToTag, setReplaceToTag] = useState("");

  const handleAddTag = async () => {
    if (!newTag.trim()) return;
    await onAddTag(newTag.trim());
    setNewTag("");
  };

  const handleReplaceTag = async () => {
    if (!replaceFromTag.trim() || !replaceToTag.trim()) return;
    await onReplaceTag(replaceFromTag.trim(), replaceToTag.trim());
    setReplaceFromTag("");
    setReplaceToTag("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("assets.bulkEditTags", "Bulk Edit Tags")}</DialogTitle>
          <DialogDescription>
            {t("assets.bulkEditTagsDesc", "{{count}} assets selected", {
              count: selectedCount,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Add tag to all selected */}
          <div className="space-y-2">
            <Label>{t("assets.addTagToAll", "Add tag to all selected")}</Label>
            <div className="flex gap-2">
              <Input
                placeholder={t("assets.tagPlaceholder", "Enter tag name")}
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                list="bulk-tag-suggestions"
                disabled={isProcessing}
              />
              <datalist id="bulk-tag-suggestions">
                {availableTags.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
              <Button
                onClick={handleAddTag}
                disabled={!newTag.trim() || isProcessing}
                size="icon"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Remove tag from all selected */}
          <div className="space-y-2">
            <Label>{t("assets.removeTagFromAll", "Remove tag from all selected")}</Label>
            <div className="flex flex-wrap gap-2">
              {availableTags.slice(0, 8).map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className={cn(
                    "cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors",
                    isProcessing && "opacity-50 cursor-not-allowed",
                  )}
                  onClick={() => !isProcessing && onRemoveTag(tag)}
                >
                  <X className="h-3 w-3 mr-1" />
                  {tag}
                </Badge>
              ))}
              {availableTags.length > 8 && (
                <Badge variant="outline" className="rounded-md text-muted-foreground">
                  +{availableTags.length - 8} more
                </Badge>
              )}
            </div>
          </div>

          {/* Replace tag */}
          <div className="space-y-2">
            <Label>{t("assets.replaceTag", "Replace tag in all selected")}</Label>
            <div className="flex gap-2 items-center">
              <Input
                placeholder={t("assets.oldTag", "Old tag")}
                value={replaceFromTag}
                onChange={(e) => setReplaceFromTag(e.target.value)}
                list="bulk-tag-suggestions"
                disabled={isProcessing}
              />
              <span className="text-muted-foreground">→</span>
              <Input
                placeholder={t("assets.newTag", "New tag")}
                value={replaceToTag}
                onChange={(e) => setReplaceToTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleReplaceTag()}
                disabled={isProcessing}
              />
              <Button
                onClick={handleReplaceTag}
                disabled={!replaceFromTag.trim() || !replaceToTag.trim() || isProcessing}
                size="sm"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Tag className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            {t("common.done", "Done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
