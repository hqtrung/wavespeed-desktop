# Assets UI Improvements Plan

**Status:** Completed

**Goal:** Enhance asset list/detail views to show folder membership and cloud sync status.

## Changes

### 1. List View - Show Folder Instead of Model
**Status:** ✅ Completed

**File:** `src/components/assets/AssetCard.tsx`
- Replaced model/workflow display with folder badge
- Added `folders` prop to `AssetCardProps`
- Imported `getFolderName`, `getFolderColor`, `getFolderColorClass` from folder-sidebar
- Shows color dot + folder name, or "No Folder" for unassigned assets

### 2. Detail View - Cloud Sync Status
**Status:** ✅ Completed

**File:** `src/pages/AssetsPage.tsx`
- Added `Cloud` and `HardDrive` icon imports
- Added sync status badge in preview dialog footer
- Shows "Synced to R2" (outline badge) or "Local only" (secondary badge)

### 3. Detail View - R2 URL Link
**Status:** ✅ Completed

**File:** `src/pages/AssetsPage.tsx`
- Added `r2PublicUrl` state and effect to fetch R2 config
- Added `getR2Url` helper function
- Added "Open in R2" button in dialog footer when asset is synced

## Database Schema

Already exists:
- `cloud_r2_key TEXT` - R2 storage key
- `folderId TEXT` - Folder assignment

## Files Modified

1. `src/components/assets/AssetCard.tsx` - List view folder badge
2. `src/components/assets/folder-sidebar/folder-colors.ts` - Added `getFolderName` and `getFolderColor` helpers
3. `src/components/assets/folder-sidebar/index.ts` - Exported new helpers
4. `src/pages/AssetsPage.tsx` - Sync status badge, R2 URL button, folders prop to AssetCard

## Success Criteria

- [x] List view shows folder badge with color dot
- [x] Detail view shows sync status badge
- [x] R2 URL button appears when synced (desktop mode)
- [x] No regression in existing functionality (build passes)
