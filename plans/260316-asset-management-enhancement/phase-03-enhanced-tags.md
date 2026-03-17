---
title: "Phase 03: Enhanced Tags System"
description: "Add tag categories with colors, bulk editing, and tag management UI"
status: pending
priority: P2
effort: 2h
branch: main
tags: [assets, tags, colors, bulk-edit]
created: 2026-03-16
---

## Overview

Enhance the tag system with color-coded categories, bulk tag editing for selected assets, tag suggestions/autocomplete, and a tag management dialog.

**Priority:** P2 (medium)
**Status:** pending

## Context Links

- Uses types from: Phase 01 (`TagCategory`, `TagColor`)
- Uses store methods from: `src/stores/assetsStore.ts`
- Modifies page: `src/pages/AssetsPage.tsx`

## Key Insights

1. **Tag categories group related tags**: e.g., "Style" category with "anime", "realistic", "abstract" tags
2. **Color-coded chips**: Tags inherit their category's color for visual scanning
3. **Bulk editing**: Select multiple assets → add/remove tags from all at once
4. **Tag management**: Central dialog to create, rename, merge, and delete tags
5. **Backward compatible**: Existing uncategorized tags use default color

## Requirements

### Functional
- Tag chips display with category colors
- Quick tag filter chips below search bar
- Bulk tag editing dialog (select assets → add/remove tags)
- Tag management dialog (CRUD + merge tags)
- Tag autocomplete in search and tag dialogs
- Tag suggestions based on frequency

### Non-Functional
- Performance with many tags (100+)
- Touch-friendly tag selection

## Architecture

```
src/components/assets/tag-management/
├── TagChip.tsx                     # Single colored tag display
├── TagFilterChips.tsx              # Quick filter chips row
├── BulkTagEditDialog.tsx           # Edit tags for selected assets
└── TagManageDialog.tsx             # Full tag/category management
```

## Related Code Files

### Files to Modify
- `src/pages/AssetsPage.tsx` - Integrate tag components
- `src/stores/assetsStore.ts` - Use from Phase 01

### Files to Create
- `src/components/assets/tag-management/TagChip.tsx`
- `src/components/assets/tag-management/TagFilterChips.tsx`
- `src/components/assets/tag-management/BulkTagEditDialog.tsx`
- `src/components/assets/tag-management/TagManageDialog.tsx`

## Implementation Steps

### Step 1: Tag Colors Constants (10 min)

`src/components/assets/tag-management/tag-colors.ts`:

```typescript
import type { TagColor } from "@/types/asset";

export const TAG_COLORS: Record<TagColor, string> = {
  default: "bg-gray-100 text-gray-700 hover:bg-gray-200",
  red: "bg-red-100 text-red-700 hover:bg-red-200",
  orange: "bg-orange-100 text-orange-700 hover:bg-orange-200",
  yellow: "bg-yellow-100 text-yellow-700 hover:bg-yellow-200",
  green: "bg-green-100 text-green-700 hover:bg-green-200",
  blue: "bg-blue-100 text-blue-700 hover:bg-blue-200",
  purple: "bg-purple-100 text-purple-700 hover:bg-purple-200",
  pink: "bg-pink-100 text-pink-700 hover:bg-pink-200",
};

export const TAG_COLOR_BORDER: Record<TagColor, string> = {
  default: "border-gray-200",
  red: "border-red-200",
  // ... etc
};
```

### Step 2: TagChip Component (20 min)

`src/components/assets/tag-management/TagChip.tsx`:

```tsx
interface TagChipProps {
  tag: string;
  category?: TagCategory | null;
  onClick?: () => void;
  onRemove?: () => void;
  removable?: boolean;
  size?: "sm" | "md";
}

// Features:
// - Color from category or default
// - Optional remove X button
// - Hover effect
// - Click to filter
// - Size variants
```

### Step 3: TagFilterChips Component (20 min)

`src/components/assets/tag-management/TagFilterChips.tsx`:

```tsx
interface TagFilterChipsProps {
  allTags: Map<string, TagCategory | null>;
  activeTags: Set<string>;
  onToggleTag: (tag: string) => void;
  onClearAll: () => void;
  maxShow?: number; // Default 8, rest in dropdown
}

// Features:
// - Shows most frequently used tags first
// - Active tags highlighted
// - "Show more" dropdown for overflow
// - Clear all button when any active
```

### Step 4: BulkTagEditDialog Component (30 min)

`src/components/assets/tag-management/BulkTagEditDialog.tsx`:

```tsx
interface BulkTagEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedAssetIds: string[];
  existingTags: Map<string, TagCategory | null>;
  onUpdate: (assetIds: string[], tags: string[]) => void;
}

// Features:
// - Shows count of selected assets
// - Add tag: autocomplete dropdown
// - Current tags list with remove
// - Preview: "N assets will have these tags"
// - Apply button
```

### Step 5: TagManageDialog Component (40 min)

`src/components/assets/tag-management/TagManageDialog.tsx`:

```tsx
interface TagManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: TagCategory[];
  onCreateCategory: (name: string, color: TagColor) => void;
  onUpdateCategory: (id: string, updates: Partial<TagCategory>) => void;
  onDeleteCategory: (id: string, moveTagsTo?: string) => void;
  onMergeTags: (sourceTag: string, targetTag: string) => void;
  onRenameTag: (oldName: string, newName: string) => void;
  onDeleteTag: (tag: string) => void;
}

// Features:
// - Two tabs: Categories, Tags
// - Categories tab: list with color, name, tag count
// - Tags tab: all tags with category, usage count
// - Merge tags: select source, select target
// - Drag tags to categories (optional v2)
```

### Step 6: Update AssetsPage (30 min)

Add to `src/pages/AssetsPage.tsx`:

```tsx
// Add state
const [showBulkTagDialog, setShowBulkTagDialog] = useState(false);
const [showTagManageDialog, setShowTagManageDialog] = useState(false);
const [activeTagFilters, setActiveTagFilters] = useState<Set<string>>(new Set());

// Get tags with categories
const tagsWithCategories = useAssetsStore(state => state.getAllTagsWithCategories());

// Add bulk tag action in selection toolbar
{selectedIds.size > 0 && (
  <Button variant="outline" size="sm" onClick={() => setShowBulkTagDialog(true)}>
    <Tag className="mr-2 h-4 w-4" />
    {t("assets.bulkEditTags")}
  </Button>
)}

// Add TagFilterChips below search
<TagFilterChips
  allTags={tagsWithCategories}
  activeTags={activeTagFilters}
  onToggleTag={(tag) => {
    const next = new Set(activeTagFilters);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    setActiveTagFilters(next);
    setFilter(f => ({ ...f, tags: Array.from(next) }));
  }}
  onClearAll={() => {
    setActiveTagFilters(new Set());
    setFilter(f => ({ ...f, tags: undefined }));
  }}
/>

// Add "Manage Tags" button in toolbar
<Button variant="outline" size="sm" onClick={() => setShowTagManageDialog(true)}>
  <Tag className="mr-2 h-4 w-4" />
  {t("assets.manageTagsAll")}
</Button>
```

### Step 7: Update AssetCard Tag Display (15 min)

Replace current tag badges with `TagChip`:

```tsx
// In AssetCard, replace tag badges section
{asset.tags.length > 0 && (
  <div className="flex flex-wrap gap-1 mt-2">
    {asset.tags.slice(0, 3).map((tag) => {
      const category = tagsWithCategories.get(tag);
      return (
        <TagChip
          key={tag}
          tag={tag}
          category={category}
          size="sm"
          onClick={() => {
            // Quick filter by this tag
            setActiveTagFilters(new Set([tag]));
            setFilter(f => ({ ...f, tags: [tag] }));
          }}
        />
      );
    })}
    {/* +N overflow */}
  </div>
)}
```

### Step 8: i18n Strings (10 min)

Add to `src/i18n/locales/en.json`:

```json
{
  "assets": {
    "tags": {
      "filterByTags": "Filter by tags",
      "clearAllTags": "Clear all",
      "showMoreTags": "+{{count}} more",
      "bulkEditTags": "Edit Tags",
      "manageTagsAll": "Manage All Tags",
      "bulkTagDialogTitle": "Edit tags for {{count}} asset(s)",
      "bulkTagDialogDesc": "Add or remove tags from selected assets",
      "addTags": "Add tags",
      "tagSearchPlaceholder": "Search tags...",
      "noTagsFound": "No tags found",
      "previewChanges": "{{count}} assets will be updated",
      "tagManageDialogTitle": "Manage Tags",
      "tagManageDialogDesc": "Create categories and organize your tags",
      "categoriesTab": "Categories",
      "tagsTab": "Tags",
      "createCategory": "New Category",
      "categoryName": "Category name",
      "mergeTags": "Merge Tags",
      "mergeTagsDesc": "Combine tags - all assets with '{{source}}' will get '{{target}}'",
      "renameTag": "Rename tag",
      "deleteTag": "Delete tag",
      "deleteTagConfirm": "Remove '{{tag}}' from all assets?"
    }
  }
}
```

## Todo List

- [ ] Create tag-colors.ts constants
- [ ] Build TagChip component with category colors
- [ ] Build TagFilterChips with frequency sorting
- [ ] Build BulkTagEditDialog with autocomplete
- [ ] Build TagManageDialog with categories/tags tabs
- [ ] Add bulk tag action to selection toolbar
- [ ] Add TagFilterChips below search bar
- [ ] Add "Manage Tags" button to toolbar
- [ ] Update AssetCard to use TagChip
- [ ] Implement tag frequency calculation
- [ ] Add i18n strings
- [ ] Test bulk tag editing
- [ ] Test tag filtering with chips
- [ ] Test tag management (create/edit/delete/merge)

## Success Criteria

- [ ] Tags display with correct category colors
- [ ] Clicking tag chip filters by that tag
- [ ] Bulk tag edit updates all selected assets
- [ ] Tag management dialog can create/delete categories
- [ ] Tag merge works correctly
- [ ] Tag autocomplete shows matching tags
- [ ] Performance acceptable with 100+ tags

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Too many tag chips | Low | Limit displayed chips, show overflow dropdown |
| Tag name conflicts | Low | Validation on create/rename |
| Category deletion | Medium | Prompt to move tags to another category |

## Security Considerations

- Sanitize tag names (prevent XSS)
- Validate tag names aren't empty

## Next Steps

- Phase 04: Improved pagination UI
- Phase 05: Modularize AssetsPage components
