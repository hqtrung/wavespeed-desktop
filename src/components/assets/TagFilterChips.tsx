import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tag, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TagFilterChipsProps {
  allTags: string[];
  activeTags: string[];
  onTagToggle: (tag: string) => void;
  onClearAll: () => void;
  maxShown?: number;
}

export function TagFilterChips({
  allTags,
  activeTags,
  onTagToggle,
  onClearAll,
  maxShown = 10,
}: TagFilterChipsProps) {
  const { t } = useTranslation();

  // Show most popular tags first (by count, would need count data)
  // For now, show alphabetically, with active tags first
  const sortedTags = useMemo(() => {
    const active = allTags.filter((tag) => activeTags.includes(tag));
    const inactive = allTags.filter((tag) => !activeTags.includes(tag));
    return [...active, ...inactive].slice(0, maxShown);
  }, [allTags, activeTags, maxShown]);

  if (allTags.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-muted-foreground flex items-center gap-1">
        <Tag className="h-3.5 w-3.5" />
        {t("assets.tags", "Tags")}:
      </span>
      <div className="flex flex-wrap gap-1.5">
        {sortedTags.map((tag) => {
          const isActive = activeTags.includes(tag);
          return (
            <Badge
              key={tag}
              variant={isActive ? "default" : "outline"}
              className={cn(
                "cursor-pointer transition-colors rounded-md",
                !isActive && "hover:bg-accent",
              )}
              onClick={() => onTagToggle(tag)}
            >
              {tag}
              {isActive && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagToggle(tag);
                  }}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          );
        })}
        {allTags.length > maxShown && (
          <Badge variant="outline" className="rounded-md text-muted-foreground">
            +{allTags.length - maxShown}
          </Badge>
        )}
      </div>
      {activeTags.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onClearAll}
        >
          {t("common.clear", "Clear")}
        </Button>
      )}
    </div>
  );
}
