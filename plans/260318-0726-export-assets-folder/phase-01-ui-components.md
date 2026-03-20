---
title: "Phase 01: UI Components - Export Menu Item"
description: "Add Export option to FolderItem context menu"
priority: P2
status: pending
---

# Phase 01: UI Components - Export Menu Item

## Context
- **File**: `src/components/assets/folder-sidebar/FolderItem.tsx`
- **Existing pattern**: Context menu at lines 150-189 with Rename and Delete options

## Requirements

### 1. Add Export prop to FolderItem interface
```typescript
interface FolderItemProps {
  // ... existing props
  onExport?: (folder: AssetFolder) => void;
}
```

### 2. Add Download/Export icon import
```typescript
import { Folder, FolderOpen, MoreVertical, Trash2, Edit3, FolderMinus, Download } from "lucide-react";
```

### 3. Add Export menu item
Add between Rename and Delete (before the destructive item):
```tsx
<DropdownMenuItem onClick={(e) => e.stopPropagation()}>
  <Download className="mr-2 h-4 w-4" />
  {t("assets.folders.exportFolder")}
  <button
    className="ml-auto w-full h-full absolute left-0 top-0"
    onClick={(e) => {
      e.stopPropagation();
      onExport(folder);
    }}
  />
</DropdownMenuItem>
```

### 4. Update FolderSidebar to pass onExport prop
**File**: `src/components/assets/folder-sidebar/FolderSidebar.tsx`

```typescript
interface FolderSidebarProps {
  // ... existing props
  onFolderExport?: (folder: AssetFolder) => void;
}
```

```tsx
// In FolderItem component for custom folders
<FolderItem
  // ... existing props
  onExport={onFolderExport}
/>
```

### 5. Update AssetsPage to handle export
**File**: `src/pages/AssetsPage.tsx`

Add handler that will delegate to store:
```typescript
const handleFolderExport = (folder: AssetFolder) => {
  // TODO: Will call exportFolder from store in Phase 03
  console.log("Export folder:", folder.name);
};
```

Pass to FolderSidebar:
```tsx
<FolderSidebar
  // ... existing props
  onFolderExport={handleFolderExport}
/>
```

## Implementation Steps
1. Modify `FolderItem.tsx` interface and component
2. Modify `FolderSidebar.tsx` interface and component
3. Modify `AssetsPage.tsx` to add stub handler
4. Test: Export menu item appears on right-click for custom folders only

## Success Criteria
- [ ] Export menu item appears in folder context menu
- [ ] Only shows for custom folders (not "All Assets" or "No Folder")
- [ ] Clicking the item calls the onExport callback
- [ ] Icon (Download) is visible
