---
title: "Phase 04: Improved Pagination"
description: "Add page numbers, page size selector, jump to page, and keyboard navigation"
status: pending
priority: P2
effort: 1h
branch: main
tags: [assets, pagination, ui, keyboard]
created: 2026-03-16
---

## Overview

Replace simple prev/next pagination with full-featured pagination including page numbers, jump to page input, items per page selector, and keyboard navigation.

**Priority:** P2 (medium)
**Status:** pending

## Context Links

- Modifies component: `src/pages/AssetsPage.tsx` (pagination section)
- Creates component: `src/components/assets/pagination/AssetPagination.tsx`

## Key Insights

1. **Current state**: Only prev/next buttons with page info
2. **Goal**: Standard pagination with page numbers (1, 2, 3... ellipsis... last)
3. **Page sizes**: 20, 50, 100, 200 options
4. **Keyboard nav**: Arrow keys, Page Up/Down, Home/End
5. **Reusable**: Extract to separate component for reuse

## Requirements

### Functional
- Page number buttons with ellipsis for large page counts
- Jump to specific page input
- Items per page dropdown
- Page info display: "Showing 1-50 of 1234"
- Keyboard shortcuts (arrows, Page Up/Down)
- URL query param sync (optional v2)

### Non-Functional
- Accessible ARIA labels
- Keyboard focus management
- Responsive layout

## Architecture

```
src/components/assets/pagination/
├── AssetPagination.tsx              # Main pagination component
├── PageNumbers.tsx                  # Page number buttons with ellipsis
└── usePaginationKeyboard.ts         # Hook for keyboard navigation
```

## Related Code Files

### Files to Modify
- `src/pages/AssetsPage.tsx` - Replace pagination section

### Files to Create
- `src/components/assets/pagination/AssetPagination.tsx`
- `src/components/assets/pagination/PageNumbers.tsx`
- `src/components/assets/pagination/use-pagination-keyboard.ts`

## Implementation Steps

### Step 1: Page Numbers Algorithm (20 min)

`src/components/assets/pagination/PageNumbers.tsx`:

```tsx
interface PageNumbersProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  maxVisible?: number; // Default 7
}

// Algorithm for showing page numbers with ellipsis:
// - Always show first page
// - Always show last page
// - Show pages around current page
// - Use ellipsis (...) for gaps
//
// Example for page 7 of 15:
// [1] [2] ... [5] [6] [7] [8] [9] ... [15]
```

Ellipsis algorithm:
```typescript
function generatePageNumbers(current: number, total: number, maxVisible = 7): number[] {
  const pages: number[] = [];

  if (total <= maxVisible) {
    // Show all pages
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  // Always include first page
  pages.push(1);

  // Calculate range around current page
  const sideCount = Math.floor((maxVisible - 3) / 2); // -3 for first, last, ellipsis
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
    pages.push(-1); // -1 represents ellipsis
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
```

### Step 2: AssetPagination Component (25 min)

`src/components/assets/pagination/AssetPagination.tsx`:

```tsx
interface AssetPaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

// Features:
// - Page info: "Showing 1-50 of 1234"
// - Page size selector: [20, 50, 100, 200]
// - Prev/First buttons
// - PageNumbers component
// - Next/Last buttons
// - Jump to page input
// - All ARIA labeled
```

### Step 3: Keyboard Navigation Hook (15 min)

`src/components/assets/pagination/use-pagination-keyboard.ts`:

```typescript
interface UsePaginationKeyboardOptions {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  enabled?: boolean; // Only when AssetsPage is active
}

export function usePaginationKeyboard({
  currentPage,
  totalPages,
  onPageChange,
  enabled = true,
}: UsePaginationKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Ignore if in input
      if (e.target instanceof HTMLInputElement) return;

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
```

### Step 4: Update AssetsPage (20 min)

Modify `src/pages/AssetsPage.tsx`:

```tsx
// Replace current pagination state
const [pageSize, setPageSize] = useState(50);

// Update pagination when page size changes
useEffect(() => {
  setPage(1); // Reset to first page
}, [pageSize]);

// Replace pagination section with AssetPagination
<AssetPagination
  currentPage={page}
  totalPages={totalPages}
  totalItems={filteredAssets.length}
  pageSize={pageSize}
  onPageChange={setPage}
  onPageSizeChange={setPageSize}
/>

// Add keyboard hook
usePaginationKeyboard({
  currentPage: page,
  totalPages,
  onPageChange: setPage,
  enabled: isActive,
});
```

### Step 5: i18n Strings (5 min)

Add to `src/i18n/locales/en.json`:

```json
{
  "assets": {
    "pagination": {
      "showing": "Showing {{start}}-{{end}} of {{total}}",
      "itemsPerPage": "Items per page",
      "jumpToPage": "Jump to page",
      "go": "Go",
      "firstPage": "First page",
      "lastPage": "Last page",
      "page": "Page {{number}}"
    }
  }
}
```

## Todo List

- [ ] Create PageNumbers component with ellipsis algorithm
- [ ] Create AssetPagination component
- [ ] Create usePaginationKeyboard hook
- [ ] Add page size selector (20, 50, 100, 200)
- [ ] Add jump to page input
- [ ] Replace AssetsPage pagination section
- [ ] Add keyboard navigation hook
- [ ] Add ARIA labels for accessibility
- [ ] Test ellipsis rendering at various page counts
- [ ] Test keyboard shortcuts
- [ ] Test page size change resets to page 1
- [ ] Test responsive layout on mobile
- [ ] Add i18n strings

## Success Criteria

- [ ] Page numbers display correctly (1, 2, 3... 10)
- [ ] Ellipsis shows when many pages (1... 4 5 6 ... 10)
- [ ] Clicking page number navigates correctly
- [ ] Page size selector works (20/50/100/200)
- [ ] Jump to page input validates and navigates
- [ ] Keyboard shortcuts work: arrows, Page Up/Down, Home/End
- [ ] Layout responsive on mobile
- [ ] ARIA labels present for screen readers

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Edge cases in ellipsis | Low | Thorough testing with various page counts |
| Keyboard conflicts | Low | Check for input focus before handling |
| Performance with many items | Low | Pagination limits displayed items |

## Security Considerations

- Validate jump-to-page input (number, within range)
- Sanitize user input

## Next Steps

- Phase 05: Modularize AssetsPage into smaller components
