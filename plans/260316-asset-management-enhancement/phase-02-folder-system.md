---
title: "Phase 02: Folder System UI"
description: "Build folder sidebar navigation and drag-drop UI for asset organization"
status: pending
priority: P2
effort: 2.5h
branch: main
tags: [assets, folders, ui, drag-drop]
created: 2026-03-16
---

## Overview

Build the folder system UI including sidebar navigation, folder management dialog, and drag-drop functionality for moving assets between folders.

**Priority:** P2 (medium)
**Status:** pending

## Context Links

- Uses types from: Phase 01
- Uses store methods from: `src/stores/assetsStore.ts`
- Modifies page: `src/pages/AssetsPage.tsx`

## Key Insights

1. **Sidebar layout**: Similar to VS Code file explorer - collapsible, tree-like
2. **"All Assets" as root**: Always shown, shows everything (folderId = undefined/null)
3. **Color coding**: Folders show color indicator, hover shows full folder name
4. **Drag-drop**: Use HTML5 drag-drop API or dnd-kit library
5. **Asset count badges**: Show number of assets per folder

## Requirements

### Functional
- Folder sidebar with "All Assets" and custom folders
- Folder CRUD dialog (create, rename, delete, color picker)
- Drag assets from grid to folders
- Move assets via context menu
- Folder selection filters the asset grid
- Empty folder state

### Non-Functional
- Smooth animations for expand/collapse
- Accessible keyboard navigation
- Touch-friendly for mobile

## Architecture

```
src/components/assets/ (new directory)
├── folder-sidebar/
│   ├── FolderSidebar.tsx           # Main sidebar container
│   ├── FolderItem.tsx              # Single folder item with drag-drop zone
│   ├── FolderCreateDialog.tsx      # Create/rename folder dialog
│   └── folder-colors.ts            # Color palette constants
├── asset-grid/
│   ├── AssetGrid.tsx               # Extracted grid from AssetsPage
│   └── AssetCard.tsx               # Existing component, add drag handle
└── index.ts                        # Barrel exports
```

## Related Code Files

### Files to Modify
- `src/pages/AssetsPage.tsx` - Add sidebar, integrate folder state

### Files to Create
- `src/components/assets/folder-sidebar/FolderSidebar.tsx`
- `src/components/assets/folder-sidebar/FolderItem.tsx`
- `src/components/assets/folder-sidebar/FolderCreateDialog.tsx`
- `src/components/assets/folder-sidebar/folder-colors.ts`

## Implementation Steps

### Step 1: Create Color Palette (10 min)

`src/components/assets/folder-sidebar/folder-colors.ts`:

```typescript
export const FOLDER_COLORS = [
  { name: "Slate", value: "#64748b" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Green", value: "#22c55e" },
  { name: "Emerald", value: "#10b981" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
] as const;

export const DEFAULT_FOLDER_COLOR = FOLDER_COLORS[7].value; // Blue
```

### Step 2: FolderItem Component (30 min)

`src/components/assets/folder-sidebar/FolderItem.tsx`:

```tsx
interface FolderItemProps {
  folder: AssetFolder | null; // null = "All Assets"
  isActive: boolean;
  assetCount: number;
  onClick: () => void;
  onRename?: (folder: AssetFolder) => void;
  onDelete?: (folder: AssetFolder) => void;
  onDrop?: (assetIds: string[]) => void;
}

// Features:
// - Color dot indicator
// - Folder name with truncate
// - Asset count badge
// - Active state styling
// - Drop zone highlight on drag over
// - Context menu for rename/delete
```

### Step 3: FolderSidebar Component (30 min)

`src/components/assets/folder-sidebar/FolderSidebar.tsx`:

```tsx
interface FolderSidebarProps {
  folders: AssetFolder[];
  activeFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  onFolderCreate: () => void;
  onFolderUpdate: (folder: AssetFolder, updates: Partial<AssetFolder>) => void;
  onFolderDelete: (folder: AssetFolder) => void;
  onAssetsMove: (assetIds: string[], folderId: string | null) => void;
  getAssetCount: (folderId: string | null) => number;
}

// Features:
// - "All Assets" always first
// - Scrollable folder list
// - "Create Folder" button at bottom
// - Collapse/expand toggle
```

### Step 4: FolderCreateDialog Component (30 min)

`src/components/assets/folder-sidebar/FolderCreateDialog.tsx`:

```tsx
interface FolderCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  folder?: AssetFolder;
  onSubmit: (data: { name: string; color: string; icon?: string }) => void;
}

// Features:
// - Name input with character limit
// - Color picker grid (12 colors)
// - Icon selector (optional - 6-8 common folder icons)
// - Validation: name required, unique
```

### Step 5: Integrate into AssetsPage (45 min)

Modify `src/pages/AssetsPage.tsx`:

```tsx
// Add state
const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
const [showFolderDialog, setShowFolderDialog] = useState(false);
const [folderDialogMode, setFolderDialogMode] = useState<"create" | "edit">("create");
const [editingFolder, setEditingFolder] = useState<AssetFolder | null>(null);

// Add to filter
useEffect(() => {
  setFilter(f => ({ ...f, folderId: activeFolderId }));
}, [activeFolderId]);

// Add sidebar to layout
return (
  <div className="flex h-full">
    <FolderSidebar {...sidebarProps} />
    <div className="flex-1 flex flex-col">
      {/* Existing header and grid */}
    </div>
  </div>
);
```

### Step 6: Add Drag-Drop to AssetCard (20 min)

Modify existing `AssetCard` component:

```tsx
// Add draggable attribute
draggable={isSelectionMode || !!activeFolderId}

// Add drag event handlers
onDragStart={(e) => {
  if (isSelectionMode && selectedIds.size > 0) {
    e.dataTransfer.setData("asset-ids", JSON.stringify(Array.from(selectedIds)));
  } else {
    e.dataTransfer.setData("asset-ids", JSON.stringify([asset.id]));
  }
}}

// Add visual feedback
className={cn(..., isDragging && "opacity-50")}
```

### Step 7: i18n Strings (10 min)

Add to `src/i18n/locales/en.json`:

```json
{
  "assets": {
    "folders": {
      "allAssets": "All Assets",
      "createFolder": "New Folder",
      "renameFolder": "Rename Folder",
      "deleteFolder": "Delete Folder",
      "folderName": "Folder Name",
      "folderColor": "Color",
      "folderNameRequired": "Folder name is required",
      "folderExists": "Folder with this name already exists",
      "deleteFolderConfirm": "Delete folder \"{{name}}\"?",
      "deleteFolderConfirmDesc": "Assets in this folder will be moved to All Assets.",
      "moveToFolder": "Move to folder",
      "noFolders": "No folders yet",
      "createFirstFolder": "Create a folder to organize your assets"
    }
  }
}
```

## Todo List

- [ ] Create folder-colors.ts with color palette
- [ ] Build FolderItem component with drag-drop zone
- [ ] Build FolderSidebar container component
- [ ] Build FolderCreateDialog with color picker
- [ ] Add drag attributes to AssetCard
- [ ] Integrate sidebar into AssetsPage layout
- [ ] Add folder state management to AssetsPage
- [ ] Add i18n strings for folders
- [ ] Test folder creation/rename/delete
- [ ] Test drag-drop assets to folders
- [ ] Test folder filtering
- [ ] Test responsive layout on mobile

## Success Criteria

- [ ] Sidebar displays all folders with correct asset counts
- [ ] "All Assets" shows everything
- [ ] Clicking folder filters grid correctly
- [ ] Create folder dialog works with color selection
- [ ] Rename/delete operations work correctly
- [ ] Drag-drop moves assets to folders
- [ ] Assets move when folder is deleted
- [ ] Layout collapses gracefully on mobile
- [ ] Keyboard navigation works (arrow keys, Enter)

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Drag-drop on mobile | Medium | Add "Move to" menu option for touch |
| Many folders clutter | Low | Add scroll to sidebar, limit initial height |
| Folder name collisions | Low | Validation prevents duplicates |

## Security Considerations

- Sanitize folder names (prevent HTML injection)
- Validate folder ID is user-owned before operations

## Next Steps

- Phase 03: Enhanced tags with color categories
- Phase 04: Improved pagination UI
