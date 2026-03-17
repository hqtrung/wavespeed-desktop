# Asset Management Enhancement - Plan Summary

**Date:** 2026-03-16
**Type:** Implementation Plan
**Status:** Ready for Implementation
**Total Effort:** 8 hours

## Overview

Comprehensive plan to enhance the Assets Management feature in WaveSpeed Desktop with:
1. **Folder/Collections** - Organize assets into folders with sidebar navigation
2. **Enhanced Tags** - Color-coded categories, bulk editing, management dialog
3. **Improved Pagination** - Page numbers, size selector, keyboard navigation
4. **Modularization** - Reduce AssetsPage.tsx from ~1200 to ~400 lines

## Plan Structure

```
plans/260316-asset-management-enhancement/
├── plan.md                              # Overview with all phases
├── phase-01-type-extensions-and-store-updates.md  # Type definitions & store (1.5h)
├── phase-02-folder-system.md            # Folder UI sidebar & drag-drop (2.5h)
├── phase-03-enhanced-tags.md            # Tag categories & bulk editing (2h)
├── phase-04-improved-pagination.md       # Page numbers & keyboard nav (1h)
└── phase-05-modularization.md           # Component extraction (1h)
```

## Key Design Decisions

### Folders
- One folder per asset (optional, null = "All Assets")
- Folder metadata: id, name, color, icon, createdAt
- Sidebar navigation with asset count badges
- Drag-drop assets to folders
- Folder delete moves assets to "All Assets"

### Tags
- Tag categories group related tags with colors
- Tag chips display category colors
- Quick filter chips below search bar
- Bulk tag edit for selected assets
- Tag management dialog with merge functionality
- Backward compatible: uncategorized tags use default color

### Pagination
- Page numbers with ellipsis for large page counts
- Page size selector: 20, 50, 100, 200
- Jump to page input
- Keyboard: arrows, Page Up/Down, Home/End
- ARIA labeled for accessibility

### Modularization
- AssetsToolbar - Search, sort, filters, selection
- AssetsFilterPanel - Type/source filter pills
- AssetGrid - Grid with empty state
- AssetPreviewDialog - Full preview with navigation
- AssetTagDialog - Single asset tag edit
- Existing components: FolderSidebar, TagFilterChips, etc.

## Implementation Order

Phases can be implemented independently but recommended order:
1. **Phase 01** - Foundation (types, store)
2. **Phase 02** - Folder system (uses Phase 01)
3. **Phase 03** - Enhanced tags (uses Phase 01)
4. **Phase 04** - Pagination (independent)
5. **Phase 05** - Modularization (cleanup)

## File Structure After Implementation

```
src/
├── types/asset.ts                       # Extended with AssetFolder, TagCategory
├── stores/assetsStore.ts                # Extended with folder/tag methods
├── pages/AssetsPage.tsx                 # Reduced to ~400 lines
└── components/assets/
    ├── toolbar/AssetsToolbar.tsx
    ├── filters/AssetsFilterPanel.tsx
    ├── grid/AssetGrid.tsx
    ├── dialogs/
    │   ├── AssetPreviewDialog.tsx
    │   └── AssetTagDialog.tsx
    ├── folder-sidebar/
    │   ├── FolderSidebar.tsx
    │   ├── FolderItem.tsx
    │   └── FolderCreateDialog.tsx
    ├── tag-management/
    │   ├── TagChip.tsx
    │   ├── TagFilterChips.tsx
    │   ├── BulkTagEditDialog.tsx
    │   └── TagManageDialog.tsx
    ├── pagination/
    │   ├── AssetPagination.tsx
    │   ├── PageNumbers.tsx
    │   └── use-pagination-keyboard.ts
    └── index.ts                         # Barrel exports
```

## Unresolved Questions

None at planning stage. Questions may arise during implementation:
- Folder icon set selection (Lucide has ~50 folder-related icons)
- Tag color palette final selection
- Whether to persist expanded folder state

## Next Steps

1. Review plan with stakeholder
2. Start Phase 01 implementation
3. Create git branch: `feat/asset-management-enhancement`
