---
title: "Phase 01: Type Extensions and Store Updates"
description: "Extend asset types and update store for folders and enhanced tags"
status: pending
priority: P2
effort: 1.5h
branch: main
tags: [assets, types, store]
created: 2026-03-16
---

## Overview

Extend TypeScript types for folders and enhanced tags, then update the assetsStore with new CRUD operations.

**Priority:** P2 (medium)
**Status:** pending

## Context Links

- Related types: `src/types/asset.ts`
- Related store: `src/stores/assetsStore.ts`
- Related page: `src/pages/AssetsPage.tsx`

## Key Insights

1. **Folder metadata needs**: id, name, color, icon, createdAt, optional parentId (for nesting later)
2. **Tag categories**: Optional category per tag with predefined colors
3. **Storage**: Use same pattern as assets - electron-store with localStorage fallback
4. **Migration**: Existing assets without folderId go to "All Assets" (null folderId)

## Requirements

### Functional
- Folder type definition
- Tag category type definition with color palette
- Store methods for folder CRUD
- Store methods for tag category management
- Asset update for folder assignment

### Non-Functional
- Type safety throughout
- Backward compatibility with existing assets

## Architecture

```
src/types/asset.ts (additions)
├── AssetFolder (interface)
├── TagCategory (interface)
└── predefined tag colors

src/stores/assetsStore.ts (additions)
├── folders: AssetFolder[]
├── tagCategories: TagCategory[]
├── createFolder()
├── updateFolder()
├── deleteFolder()
├── moveAssetsToFolder()
├── createTagCategory()
├── updateTagCategory()
└── deleteTagCategory()
```

## Related Code Files

### Files to Modify
- `src/types/asset.ts` - Add new types
- `src/stores/assetsStore.ts` - Add folder/tag category state and methods

### Files to Create
- None

## Implementation Steps

### Step 1: Extend Types (15 min)

Add to `src/types/asset.ts`:

```typescript
export interface AssetFolder {
  id: string;
  name: string;
  color: string; // Hex color or preset name
  icon?: string; // Lucide icon name (optional)
  createdAt: string;
  assetCount?: number; // Computed, not persisted
}

export type TagColor =
  | "default"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink";

export interface TagCategory {
  id: string;
  name: string;
  color: TagColor;
  tags: string[]; // Tags in this category
  createdAt: string;
}

// Extend AssetMetadata
export interface AssetMetadata {
  // ... existing fields
  folderId?: string; // Optional folder assignment
}
```

### Step 2: Update Store State (20 min)

Add to `AssetsState` interface in `assetsStore.ts`:

```typescript
interface AssetsState {
  // ... existing
  folders: AssetFolder[];
  tagCategories: TagCategory[];

  // Folder operations
  loadFolders: () => Promise<void>;
  createFolder: (name: string, color: string) => Promise<AssetFolder>;
  updateFolder: (id: string, updates: Partial<Pick<AssetFolder, 'name' | 'color' | 'icon'>>) => Promise<void>;
  deleteFolder: (id: string, moveAssetsTo?: string | null) => Promise<void>;
  moveAssetsToFolder: (assetIds: string[], folderId: string | null) => Promise<void>;

  // Tag category operations
  loadTagCategories: () => Promise<void>;
  createTagCategory: (name: string, color: TagColor, tags?: string[]) => Promise<TagCategory>;
  updateTagCategory: (id: string, updates: Partial<Pick<TagCategory, 'name' | 'color' | 'tags'>>) => Promise<void>;
  deleteTagCategory: (id: string) => Promise<void>;

  // Enhanced filtering
  getFilteredAssets: (filter: AssetsFilter) => AssetMetadata[];
  getAllTags: () => string[];
  getAllTagsWithCategories: () => Map<string, TagCategory | null>;
}
```

### Step 3: Implement Store Methods (45 min)

Add storage keys and implement methods:

```typescript
const FOLDERS_STORAGE_KEY = "wavespeed_assets_folders";
const TAG_CATEGORIES_STORAGE_KEY = "wavespeed_assets_tag_categories";

// In state initializer:
folders: [],
tagCategories: [],

// Load folders (sync with assets)
loadFolders: async () => {
  if (window.electronAPI?.getAssetsFolders) {
    const folders = await window.electronAPI.getAssetsFolders();
    set({ folders });
  } else {
    const stored = localStorage.getItem(FOLDERS_STORAGE_KEY);
    set({ folders: stored ? JSON.parse(stored) : [] });
  }
},

// Create folder
createFolder: async (name, color) => {
  const folder: AssetFolder = {
    id: generateId(),
    name,
    color,
    createdAt: new Date().toISOString(),
  };
  set((state) => {
    const newFolders = [...state.folders, folder];
    if (window.electronAPI?.saveAssetsFolders) {
      window.electronAPI.saveAssetsFolders(newFolders);
    } else {
      localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(newFolders));
    }
    return { folders: newFolders };
  });
  return folder;
},

// Similar for updateFolder, deleteFolder, moveAssetsToFolder
// Tag category methods follow same pattern
```

### Step 4: Update Filter Logic (15 min)

Modify `getFilteredAssets` to support folder filtering:

```typescript
getFilteredAssets: (filter) => {
  let filtered = [...assets];

  // ... existing filters

  // Filter by folder
  if (filter.folderId !== undefined) {
    filtered = filtered.filter(a => a.folderId === filter.folderId);
  }

  return filtered;
}
```

## Todo List

- [ ] Add AssetFolder type to asset.ts
- [ ] Add TagCategory and TagColor types to asset.ts
- [ ] Add folderId to AssetMetadata (optional)
- [ ] Extend AssetsState interface with folder/tag state
- [ ] Add storage key constants
- [ ] Implement loadFolders/createFolder/updateFolder/deleteFolder
- [ ] Implement moveAssetsToFolder
- [ ] Implement loadTagCategories/createTagCategory/updateTagCategory/deleteTagCategory
- [ ] Update getFilteredAssets for folder filtering
- [ ] Update getAllTags to return Map with categories
- [ ] Test store methods work correctly

## Success Criteria

- [ ] All types compile without errors
- [ ] Store methods work in both Electron and browser modes
- [ ] Existing assets without folderId handled correctly
- [ ] Folder state persists across reloads

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing assets | Medium | Make folderId optional, null = "All Assets" |
| localStorage size limit | Low | Folders/categories small, unlikely to hit limit |

## Security Considerations

- Validate folder names to prevent XSS (sanitize in UI)
- Tag/category names user input - same validation

## Next Steps

- Phase 02: Build folder UI components (sidebar, drag-drop)
- Phase 03: Enhanced tag UI with color chips
