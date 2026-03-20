---
title: "Phase 04: Progress Dialog - UI Feedback"
description: "Add progress dialog component and integrate with AssetsPage"
priority: P2
status: pending
---

# Phase 04: Progress Dialog - UI Feedback

## Context
- **Components**: Create new or reuse existing dialog components
- **Existing pattern**: ProcessingProgress at `src/components/shared/ProcessingProgress.tsx`

## Requirements

### 1. Create ExportProgressDialog component
**File**: `src/components/assets/ExportProgressDialog.tsx`

```tsx
import { useTranslation } from "react-i18next";
import { FolderOpen, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ExportProgressDialogProps {
  isOpen: boolean;
  progress: number;
  current: number;
  total: number;
  fileName?: string;
  onComplete: () => void;
}

export function ExportProgressDialog({
  isOpen,
  progress,
  current,
  total,
  fileName,
  onComplete,
}: ExportProgressDialogProps) {
  const { t } = useTranslation();
  const isComplete = progress >= 100;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onComplete()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            {t("assets.folders.exportingFolder", "Exporting Folder...")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Progress bar */}
          <Progress value={progress} className="h-2" />

          {/* Status text */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {isComplete
                ? t("assets.folders.exportComplete", "Export complete")
                : t("assets.folders.exporting", "Exporting...")}
            </span>
            <span className="font-medium">
              {current} / {total}
            </span>
          </div>

          {/* Current file */}
          {fileName && !isComplete && (
            <p className="text-xs text-muted-foreground truncate">
              {fileName}
            </p>
          )}
        </div>

        {/* Close button - only enabled when complete */}
        <div className="flex justify-end">
          <Button
            onClick={onComplete}
            disabled={!isComplete}
            size="sm"
          >
            {isComplete
              ? t("common.close", "Close")
              : t("assets.folders.canceling", "Canceling...")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 2. Update AssetsPage to show dialog
**File**: `src/pages/AssetsPage.tsx`

```typescript
import { ExportProgressDialog } from "@/components/assets/ExportProgressDialog";

// In component
const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);

const handleFolderExport = async (folder: AssetFolder) => {
  setIsExportDialogOpen(true);
  try {
    const result = await exportFolder(folder.id);
    // Show success toast
    toast({
      title: t("assets.folders.exportComplete"),
      description: t("assets.folders.exportCompleteDesc", {
        count: result.exportedCount,
        path: result.destinationPath,
      }),
    });
  } catch (error) {
    // Show error toast
    toast({
      variant: "destructive",
      title: t("assets.folders.exportFailed"),
      description: (error as Error).message,
    });
  } finally {
    setIsExportDialogOpen(false);
  }
};

// In render
<ExportProgressDialog
  isOpen={isExportDialogOpen}
  progress={exportProgress?.progress || 0}
  current={exportProgress?.current || 0}
  total={exportProgress?.total || 0}
  fileName={exportProgress?.fileName}
  onComplete={() => setIsExportDialogOpen(false)}
/>
```

### 3. Add preload API
**File**: `electron/preload.ts`

```typescript
// In electronAPI
exportAssetsFolder: (
  folderId: string,
  destinationPath: string,
): Promise<{
  success: boolean;
  error?: string;
  exportedCount?: number;
  destinationPath?: string;
}> => ipcRenderer.invoke("export-assets-folder", folderId, destinationPath),

onAssetsFolderExportProgress: (
  callback: (data: {
    progress: number;
    current: number;
    total: number;
    fileName: string;
  }) => void,
): (() => void) => {
  const handler = (_: unknown, data: unknown) =>
    callback(data as { progress: number; current: number; total: number; fileName: string });
  ipcRenderer.on("assets-folder-export-progress", handler);
  return () => ipcRenderer.removeListener("assets-folder-export-progress", handler);
},
```

## Implementation Steps
1. Create ExportProgressDialog component
2. Add preload API functions
3. Update AssetsPage to handle export with dialog
4. Add toast notifications for success/error
5. Test: Dialog shows during export, closes on completion

## Success Criteria
- [ ] ExportProgressDialog component created
- [ ] Dialog opens when export starts
- [ ] Progress bar updates during copy
- [ ] Shows current/total count
- [ ] Shows current file name
- [ ] Close button enables at 100%
- [ ] Toast notifications appear on complete/error
