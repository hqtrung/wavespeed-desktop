---
title: "Export Assets Folder Feature"
description: "Add export functionality to copy asset folders to external directories with progress tracking"
status: pending
priority: P2
effort: 3h
branch: main
tags: [assets, folders, export, ipc]
created: 2025-03-18
---

# Export Assets Folder Feature

## Overview
Add "Export" option to folder context menu in AssetsPage, allowing users to copy an entire folder's contents to a selected directory while preserving the subdirectory structure (images/, videos/, audio/, text/).

## Phases

| Phase | Description | Status |
|-------|-------------|--------|
| [Phase 01](./phase-01-ui-components.md) | Add Export menu item to FolderItem context menu | pending |
| [Phase 02](./phase-02-ipc-handler.md) | Implement main process IPC handler with file copying | pending |
| [Phase 03](./phase-03-store-integration.md) | Add exportFolder function to assetsStore with progress tracking | pending |
| [Phase 04](./phase-04-progress-dialog.md) | Add progress dialog component with toast notification | pending |
| [Phase 05](./phase-05-translations.md) | Add i18n translations for all UI strings | pending |

## Technical Context

### Existing Patterns to Follow
- **FolderItem.tsx**: Context menu with Rename/Delete options (lines 161-187)
- **select-directory IPC**: Already exists in main.ts (lines 660-674)
- **Multi-phase progress**: ProcessingProgress component at `src/components/shared/ProcessingProgress.tsx`
- **File operations**: `copyFileSync` imported in main.ts (line 21)
- **Progress IPC pattern**: See sd-progress emission (line 1805) for renderer communication

### Files to Modify
1. `src/components/assets/folder-sidebar/FolderItem.tsx` - Add Export menu item
2. `src/stores/assetsStore.ts` - Add exportFolder function
3. `electron/preload.ts` - Add exportAssetsFolder API
4. `electron/main.ts` - Add IPC handler with progress reporting
5. `src/i18n/locales/en.json` - Add translations (also other locale files)

### Data Flow
```
User clicks Export → FolderItem → FolderSidebar → AssetsPage
→ assetsStore.exportFolder() → window.electronAPI.exportAssetsFolder()
→ main.ts IPC handler → dialog.showOpenDialog() → copyFileSync with progress
→ IPC events → renderer → ProcessingProgress dialog → toast notification
```

## Success Criteria
- Export option appears in folder context menu (not for "All Assets" or "No Folder")
- System directory picker dialog opens on click
- Subfolder named after folder is created at destination
- All assets are copied preserving type-based subdirectories
- Progress is shown during copy operation
- Success/error toast notifications appear
- Translations work for all supported languages

## Unresolved Questions
- Should empty folders be exported? (decision: yes, create empty subdirectory)
- Should metadata JSON be included in export? (decision: no, only actual files)
