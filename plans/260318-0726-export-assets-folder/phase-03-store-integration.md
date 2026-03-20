---
title: "Phase 03: Store Integration - Export Function"
description: "Add exportFolder function to assetsStore with progress tracking"
priority: P2
status: pending
---

# Phase 03: Store Integration - Export Function

## Context
- **File**: `src/stores/assetsStore.ts`
- **Existing patterns**: Folder operations at lines 829-925

## Requirements

### 1. Add export state to AssetsState interface
```typescript
interface AssetsState {
  // ... existing state
  exportProgress: {
    isActive: boolean;
    progress: number;
    current: number;
    total: number;
    fileName?: string;
  } | null;
}
```

### 2. Add exportFolder action
```typescript
exportFolder: async (folderId: string) => Promise<void>;
```

### 3. Implement exportFolder function
```typescript
exportFolder: async (folderId) => {
  const folder = get().folders.find(f => f.id === folderId);
  if (!folder) {
    throw new Error("Folder not found");
  }

  // Open directory picker
  if (!window.electronAPI?.selectDirectory) {
    throw new Error("Export not available in browser mode");
  }

  const result = await window.electronAPI.selectDirectory();
  if (!result.success || result.canceled || !result.path) {
    return; // User canceled
  }

  const destinationPath = result.path;

  // Set up progress tracking
  set({
    exportProgress: {
      isActive: true,
      progress: 0,
      current: 0,
      total: 0,
    },
  });

  // Listen to progress events
  const unsubscribe = window.electronAPI.onAssetsFolderExportProgress?.(
    (progress) => {
      set({
        exportProgress: {
          isActive: true,
          progress: progress.progress,
          current: progress.current,
          total: progress.total,
          fileName: progress.fileName,
        },
      });
    }
  );

  try {
    // Call main process
    const exportResult = await window.electronAPI.exportAssetsFolder!(
      folderId,
      destinationPath,
    );

    if (!exportResult.success) {
      throw new Error(exportResult.error || "Export failed");
    }

    // Reset progress
    set({ exportProgress: null });

    return exportResult;
  } finally {
    unsubscribe?.();
  }
},
```

## Implementation Steps
1. Add exportProgress state to AssetsState
2. Add exportFolder to state interface
3. Implement exportFolder function with progress tracking
4. Initialize state in create() call

## Success Criteria
- [ ] exportFolder function validates folder exists
- [ ] Opens system directory picker dialog
- [ ] Tracks progress during export
- [ ] Returns export result (count, destination path)
- [ ] Handles cancellation gracefully
- [ ] Cleans up progress listener on completion/error
