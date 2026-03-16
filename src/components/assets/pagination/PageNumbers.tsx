import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";

interface PageNumbersProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  maxVisible?: number;
}

/**
 * Generate page numbers with ellipsis for pagination
 * Returns array of numbers or -1 for ellipsis
 *
 * Examples:
 * - page 3 of 10: [1, 2, 3, 4, 5, -1, 10]
 * - page 7 of 15: [1, -1, 5, 6, 7, 8, 9, -1, 15]
 */
function generatePageNumbers(
  current: number,
  total: number,
  maxVisible = 7,
): Array<number | -1> {
  const pages: Array<number | -1> = [];

  if (total <= maxVisible) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  // Always include first page
  pages.push(1);

  // Calculate range around current page
  const sideCount = Math.floor((maxVisible - 3) / 2);
  let start = Math.max(2, current - sideCount);
  let end = Math.min(total - 1, current + sideCount);

  // Adjust if we're near the start
  if (current <= sideCount + 1) {
    end = Math.min(total - 1, maxVisible - 2);
  }

  // Adjust if we're near the end
  if (current >= total - sideCount) {
    start = Math.max(2, total - maxVisible + 3);
  }

  // Add ellipsis before range if needed
  if (start > 2) {
    pages.push(-1);
  }

  // Add range
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  // Add ellipsis after range if needed
  if (end < total - 1) {
    pages.push(-1);
  }

  // Always include last page
  if (total > 1) {
    pages.push(total);
  }

  return pages;
}

export function PageNumbers({
  currentPage,
  totalPages,
  onPageChange,
  maxVisible = 7,
}: PageNumbersProps) {
  const { t } = useTranslation();

  if (totalPages <= 1) {
    return null;
  }

  const pages = generatePageNumbers(currentPage, totalPages, maxVisible);

  return (
    <div className="flex items-center gap-1">
      {pages.map((page, idx) => {
        if (page === -1) {
          return (
            <span
              key={`ellipsis-${idx}`}
              className="flex items-center justify-center w-9 h-9 text-muted-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          );
        }

        const isActive = page === currentPage;
        return (
          <Button
            key={page}
            variant={isActive ? "default" : "ghost"}
            size="icon"
            className={cn(
              "h-9 w-9",
              isActive && "pointer-events-none",
            )}
            onClick={() => onPageChange(page)}
            aria-label={t("assets.pagination.page", "Page {{number}}", {
              number: page,
            })}
            aria-current={isActive ? "true" : undefined}
          >
            {page}
          </Button>
        );
      })}
    </div>
  );
}
