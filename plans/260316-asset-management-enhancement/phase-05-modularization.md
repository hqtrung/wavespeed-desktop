---
title: "Phase 05: Modularize AssetsPage"
description: "Extract components from 1200+ line AssetsPage into smaller, focused modules"
status: pending
priority: P2
effort: 1h
branch: main
tags: [assets, refactor, modularization]
created: 2026-03-16
---

## Overview

The current `AssetsPage.tsx` is ~1200 lines and difficult to maintain. Extract reusable components into separate modules following the project's 200-line file size guideline.

**Priority:** P2 (medium)
**Status:** pending

## Context Links

- Modifies: `src/pages/AssetsPage.tsx`
- Creates: Multiple component files in `src/components/assets/`

## Key Insights

1. **Already extracted**: `AssetCard` is already a separate memoized component
2. **Remaining monolithic sections**:
   - Header with toolbar (~300 lines)
   - Filter panel (~150 lines)
   - Asset grid section (~100 lines)
   - Preview dialog (~200 lines)
   - Tag dialog (~100 lines)
   - Delete confirmation (~50 lines)
3. **Extract incrementally**: Each component extracted and tested separately
4. **Maintain state lifting**: Keep complex state in AssetsPage, pass handlers down

## Requirements

### Functional
- Extract toolbar as separate component
- Extract filter panel as separate component
- Extract preview dialog as separate component
- Extract tag management dialog as separate component
- Maintain all existing functionality

### Non-Functional
- Each file under 200 lines
- Clear prop interfaces
- TypeScript strict mode

## Architecture

```
src/components/assets/
├── toolbar/
│   └── AssetsToolbar.tsx             # Search, sort, filters, selection toolbar
├── filters/
│   └── AssetsFilterPanel.tsx         # Type/source filter pills
├── dialogs/
│   ├── AssetPreviewDialog.tsx        # Full asset preview with nav
│   └── AssetTagDialog.tsx            # Single asset tag edit dialog
└── grid/
    └── AssetGrid.tsx                 # Grid container with empty state
```

## Related Code Files

### Files to Modify
- `src/pages/AssetsPage.tsx` - Reduce to ~400 lines (state + orchestration)

### Files to Create
- `src/components/assets/toolbar/AssetsToolbar.tsx`
- `src/components/assets/filters/AssetsFilterPanel.tsx`
- `src/components/assets/dialogs/AssetPreviewDialog.tsx`
- `src/components/assets/dialogs/AssetTagDialog.tsx`
- `src/components/assets/grid/AssetGrid.tsx`

## Implementation Steps

### Step 1: AssetsToolbar Component (20 min)

`src/components/assets/toolbar/AssetsToolbar.tsx`:

```tsx
interface AssetsToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortBy: AssetSortBy;
  onSortChange: (value: AssetSortBy) => void;
  modelFilter: string | null;
  onModelChange: (value: string) => void;
  favoritesOnly: boolean;
  onFavoritesToggle: () => void;
  showFilters: boolean;
  onFiltersToggle: () => void;
  loadPreviews: boolean;
  onPreviewsToggle: () => void;
  isSelectionMode: boolean;
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onSelectionExit: () => void;
  onSelectionDelete: () => void;
  onSelectionFavorite: (favorite: boolean) => void;
  onOpenFolder: () => void;
  allModels: string[];
}

// Extracts: search input, sort dropdown, model dropdown,
// preview/favorites/filter toggles, selection toolbar
```

### Step 2: AssetsFilterPanel Component (15 min)

`src/components/assets/filters/AssetsFilterPanel.tsx`:

```tsx
interface AssetsFilterPanelProps {
  show: boolean;
  types: AssetType[];
  sources: AssetSource[];
  onTypeToggle: (type: AssetType, checked: boolean) => void;
  onSourceToggle: (source: AssetSource) => void;
}

// Extracts: source tabs (Playground/Workflow/Free Tool/Z-Image),
// type filter pills
```

### Step 3: AssetGrid Component (10 min)

`src/components/assets/grid/AssetGrid.tsx`:

```tsx
interface AssetGridProps {
  assets: AssetMetadata[];
  loading: boolean;
  empty: boolean;
  loadPreviews: boolean;
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  // ... all asset card handlers
}

// Extracts: grid layout, empty state, AssetCard mapping
```

### Step 4: AssetPreviewDialog Component (20 min)

`src/components/assets/dialogs/AssetPreviewDialog.tsx`:

```tsx
interface AssetPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: AssetMetadata | null;
  assets: AssetMetadata[];
  onNavigate: (direction: "prev" | "next") => void;
  onCustomize: (asset: AssetMetadata) => void;
  onDownload: (asset: AssetMetadata) => void;
  onOpenLocation: (asset: AssetMetadata) => void;
  onToggleFavorite: (asset: AssetMetadata) => void;
  onManageTags: (asset: AssetMetadata) => void;
  onDelete: (asset: AssetMetadata) => void;
}

// Extracts: full dialog with media preview,
// navigation, action buttons
```

### Step 5: AssetTagDialog Component (10 min)

`src/components/assets/dialogs/AssetTagDialog.tsx`:

```tsx
interface AssetTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: AssetMetadata | null;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}

// Extracts: tag list, add/remove buttons, input
```

### Step 6: Update AssetsPage (20 min)

Refactor `src/pages/AssetsPage.tsx`:

```tsx
// Keep: state, hooks, store access, handler logic
// Replace JSX sections with extracted components

return (
  <div className="flex h-full flex-col pt-12 md:pt-0">
    <div className="page-header ...">
      <h1>{t("assets.title")}</h1>
      <AssetsToolbar {...toolbarProps} />
      <AssetsFilterPanel {...filterProps} />
    </div>
    <ScrollArea className="flex-1">
      <AssetGrid {...gridProps} />
    </ScrollArea>
    <AssetPagination {...paginationProps} />
    <AssetPreviewDialog {...previewProps} />
    <AssetTagDialog {...tagDialogProps} />
    {/* Bulk delete confirm - existing AlertDialog is fine */}
  </div>
);
```

### Step 7: Barrel Export (5 min)

`src/components/assets/index.ts`:

```typescript
// Toolbar
export { AssetsToolbar } from "./toolbar/AssetsToolbar";

// Filters
export { AssetsFilterPanel } from "./filters/AssetsFilterPanel";

// Grid
export { AssetGrid } from "./grid/AssetGrid";

// Dialogs
export { AssetPreviewDialog } from "./dialogs/AssetPreviewDialog";
export { AssetTagDialog } from "./dialogs/AssetTagDialog";

// Folder sidebar (from Phase 02)
export { FolderSidebar } from "./folder-sidebar/FolderSidebar";

// Tag management (from Phase 03)
export { TagChip } from "./tag-management/TagChip";
export { TagFilterChips } from "./tag-management/TagFilterChips";
export { BulkTagEditDialog } from "./tag-management/BulkTagEditDialog";
export { TagManageDialog } from "./tag-management/TagManageDialog";

// Pagination (from Phase 04)
export { AssetPagination } from "./pagination/AssetPagination";
```

## Todo List

- [ ] Create AssetsToolbar component
- [ ] Create AssetsFilterPanel component
- [ ] Create AssetGrid component
- [ ] Create AssetPreviewDialog component
- [ ] Create AssetTagDialog component
- [ ] Update AssetsPage imports and JSX
- [ ] Verify all functionality still works
- [ ] Create barrel export file
- [ ] Check file sizes (all <200 lines)
- [ ] Test all dialog interactions
- [ ] Test toolbar interactions
- [ ] Test selection mode

## Success Criteria

- [ ] AssetsPage.tsx reduced to ~400 lines
- [ ] All component files under 200 lines
- [ ] All existing functionality preserved
- [ ] No TypeScript errors
- [ ] Components clearly named and organized

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Prop drilling complexity | Medium | Use object props for related values |
| Breaking changes | Low | Incremental extraction, test each step |
| Re-render performance | Low | Use memo where needed |

## Security Considerations

- No new security concerns (refactor only)
- Maintain existing input validation

## Next Steps

- Implementation complete
- Testing and refinement
