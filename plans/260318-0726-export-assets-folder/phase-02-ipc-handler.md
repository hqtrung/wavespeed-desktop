---
title: "Phase 02: IPC Handler - Main Process Export Logic"
description: "Implement main process IPC handler for folder export with progress reporting"
priority: P2
status: pending
---

# Phase 02: IPC Handler - Main Process Export Logic

## Context
- **File**: `electron/main.ts`
- **Existing patterns**:
  - `select-directory` handler (lines 660-674) for directory picker
  - `copyFileSync` imported (line 21)
  - Progress emission pattern via `event.sender.send()` (line 1805)
  - `get-assets-metadata` / `save-assets-metadata` for metadata access

## Requirements

### 1. Add TypeScript types (if not already present)
```typescript
interface ExportAssetsFolderResult {
  success: boolean;
  error?: string;
  exportedCount?: number;
  destinationPath?: string;
}
```

### 2. Add IPC handler in main.ts
```typescript
ipcMain.handle(
  "export-assets-folder",
  async (event, folderId: string, destinationPath: string) => {
    try {
      // Load metadata to get all assets in folder
      const allMetadata = loadAssetsMetadata();
      const folderAssets = allMetadata.filter(a => a.folderId === folderId);

      if (folderAssets.length === 0) {
        return { success: true, exportedCount: 0, destinationPath };
      }

      // Get folder name from metadata (need to load folders)
      // For now, use a default or passed folder name
      const folderName = folderId; // Will be improved to use actual folder name

      const exportBaseDir = join(destinationPath, folderName);

      // Create subdirectories
      const subDirs = ["images", "videos", "audio", "text"];
      for (const subDir of subDirs) {
        const dirPath = join(exportBaseDir, subDir);
        if (!existsSync(dirPath)) {
          mkdirSync(dirPath, { recursive: true });
        }
      }

      // Copy files with progress
      let copiedCount = 0;
      for (const asset of folderAssets) {
        // Check if source file exists
        if (!existsSync(asset.filePath)) {
          console.warn("Source file not found:", asset.filePath);
          continue;
        }

        // Determine target subdirectory
        const subDir = asset.type === "json" ? "text" : asset.type + "s";
        const targetDir = join(exportBaseDir, subDir);
        const targetPath = join(targetDir, asset.fileName);

        // Copy file
        copyFileSync(asset.filePath, targetPath);
        copiedCount++;

        // Send progress
        event.sender.send("assets-folder-export-progress", {
          progress: (copiedCount / folderAssets.length) * 100,
          current: copiedCount,
          total: folderAssets.length,
          fileName: asset.fileName,
        });
      }

      return { success: true, exportedCount: copiedCount, destinationPath: exportBaseDir };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);
```

### 3. Add helper to load folders (for folder name)
```typescript
function loadAssetFolders(): AssetFolder[] {
  const foldersPath = join(userDataPath, "assets-folders.json");
  try {
    if (existsSync(foldersPath)) {
      const data = readFileSync(foldersPath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to load folders:", error);
  }
  return [];
}
```

## Implementation Steps
1. Define ExportAssetsFolderResult interface
2. Add `loadAssetFolders()` helper function if needed
3. Add `export-assets-folder` IPC handler
4. Implement file copy loop with progress emission
5. Test: Export works with sample folder

## Success Criteria
- [ ] IPC handler receives folderId and destination path
- [ ] Creates folder subdirectory at destination
- [ ] Creates type-based subdirectories (images/, videos/, audio/, text/)
- [ ] Copies all files from folder
- [ ] Sends progress events during copy
- [ ] Returns success/failure result
- [ ] Handles missing source files gracefully
