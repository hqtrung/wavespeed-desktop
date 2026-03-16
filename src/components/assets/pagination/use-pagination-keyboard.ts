import { useEffect } from "react";

interface UsePaginationKeyboardOptions {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  enabled?: boolean;
}

/**
 * Keyboard navigation for pagination
 * - Arrow Left/Right: Previous/Next page
 * - Page Up/Down: Previous/Next page
 * - Home: First page
 * - End: Last page
 */
export function usePaginationKeyboard({
  currentPage,
  totalPages,
  onPageChange,
  enabled = true,
}: UsePaginationKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Ignore if in input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (currentPage > 1) onPageChange(currentPage - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (currentPage < totalPages) onPageChange(currentPage + 1);
          break;
        case "PageUp":
          e.preventDefault();
          if (currentPage > 1) onPageChange(currentPage - 1);
          break;
        case "PageDown":
          e.preventDefault();
          if (currentPage < totalPages) onPageChange(currentPage + 1);
          break;
        case "Home":
          e.preventDefault();
          onPageChange(1);
          break;
        case "End":
          e.preventDefault();
          onPageChange(totalPages);
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentPage, totalPages, onPageChange, enabled]);
}
