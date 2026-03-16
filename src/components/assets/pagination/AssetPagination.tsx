import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PageNumbers } from "./PageNumbers";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AssetPaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

export function AssetPagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: AssetPaginationProps) {
  const { t } = useTranslation();
  const [jumpInput, setJumpInput] = useState("");
  const [jumpError, setJumpError] = useState(false);

  // Reset jump input when page changes
  useEffect(() => {
    setJumpInput("");
    setJumpError(false);
  }, [currentPage]);

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const handleJumpToPage = useCallback(() => {
    const page = parseInt(jumpInput, 10);
    if (isNaN(page) || page < 1 || page > totalPages) {
      setJumpError(true);
      return;
    }
    setJumpError(false);
    onPageChange(page);
  }, [jumpInput, totalPages, onPageChange]);

  const handleJumpKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleJumpToPage();
      }
    },
    [handleJumpToPage],
  );

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-border/70">
      {/* Page info */}
      <div className="text-sm text-muted-foreground">
        {t("assets.pagination.showing", "Showing {{start}}-{{end}} of {{total}}", {
          start: startItem,
          end: endItem,
          total: totalItems,
        })}
      </div>

      {/* Pagination controls */}
      <div className="flex items-center gap-2">
        {/* Page size selector */}
        <div className="hidden md:flex items-center gap-2 mr-2">
          <span className="text-sm text-muted-foreground">
            {t("assets.pagination.itemsPerPage", "Items per page")}
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="h-9 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* First/Prev buttons */}
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          aria-label={t("assets.pagination.firstPage", "First page")}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label={t("assets.pagination.previousPage", "Previous page")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* Page numbers */}
        <PageNumbers
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />

        {/* Next/Last buttons */}
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label={t("assets.pagination.nextPage", "Next page")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          aria-label={t("assets.pagination.lastPage", "Last page")}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>

        {/* Jump to page input */}
        <div className="hidden lg:flex items-center gap-2 ml-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {t("assets.pagination.jumpToPage", "Jump to")}
          </span>
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={jumpInput}
            onChange={(e) => {
              setJumpInput(e.target.value);
              setJumpError(false);
            }}
            onKeyDown={handleJumpKeyDown}
            onBlur={handleJumpToPage}
            className={cn(
              "h-9 w-16 text-center",
              jumpError && "border-destructive",
            )}
            placeholder={String(currentPage)}
          />
        </div>
      </div>
    </div>
  );
}
