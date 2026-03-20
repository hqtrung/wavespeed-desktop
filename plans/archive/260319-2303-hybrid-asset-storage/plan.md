# Hybrid Asset Storage Implementation Plan

**Goal:** Local-first asset access with cloud lazy-loading via Cloudflare R2.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Client App                           │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐│
│  │   Asset      │────▶│   Local      │     │    R2       ││
│  │   Request    │     │   Cache      │◀────│    Fallback ││
│  └──────────────┘     └──────────────┘     └─────────────┘│
│         │                    │                    │        │
│         ▼                    ▼                    ▼        │
│    Display              Instant Load        Lazy Load      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   D1 Database    │
                    │   (metadata)     │
                    └──────────────────┘
```

## Phases

### Phase 1: R2 Upload Foundation
- [ ] Implement R2 upload in `assets:save` flow
- [ ] Store `cloud_r2_key` in metadata after upload
- [ ] Handle upload failures gracefully
- [ ] Add retry logic for failed uploads

### Phase 2: Lazy Download
- [ ] Create `assets:get-file` IPC handler
- [ ] Check local file exists first
- [ ] If missing: generate presigned R2 URL → download → cache
- [ ] Return file path to renderer

### Phase 3: Background Sync
- [ ] Queue for assets without local files
- [ ] Background worker to download missing assets
- [ ] Progress reporting for sync status

### Phase 4: Cache Management
- [ ] LRU eviction for local storage
- [ ] Disk usage monitoring
- [ ] User preferences for cache size

## Implementation Steps

### Step 1: R2 Upload Integration

**Files:** `electron/assets/r2-client.ts` (extend existing)

```typescript
// Add to R2Client class
async uploadFile(
  key: string,
  filePath: string,
  contentType: string
): Promise<{ success: boolean; key?: string; error?: string }>

async generatePresignedUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string>
```

**Modify:** `electron/assets/ipc-handlers.ts`
- After `assets:insert`, upload to R2
- Update `cloud_r2_key` on success

### Step 2: Lazy Download Handler

**Add:** `electron/assets/ipc-handlers.ts`

```typescript
ipcMain.handle("assets:get-file", async (id: string) => {
  // 1. Get metadata from DB
  const asset = assetsRepo.getById(id);

  // 2. Check local file exists
  if (existsSync(asset.filePath)) {
    return asset.filePath;
  }

  // 3. Download from R2
  if (asset.cloudR2Key) {
    const url = await r2Client.generatePresignedUrl(asset.cloudR2Key);
    const downloadedPath = await downloadFile(url, asset.filePath);
    return downloadedPath;
  }

  throw new Error("File not available locally or in cloud");
});
```

### Step 3: Background Sync Queue

**Add:** `electron/assets/asset-sync-queue.ts`

```typescript
class AssetSyncQueue {
  queue: string[] = []; // asset IDs

  enqueue(assetId: string): void;
  processNext(): Promise<void>;
  getStats(): { pending: number; downloaded: number };
}
```

### Step 4: Cache Management

**Add:** `electron/assets/cache-manager.ts`

```typescript
class CacheManager {
  getMaxSizeBytes(): number; // from settings
  getCurrentSizeBytes(): number;
  evictLRU(bytesNeeded: number): void;
  getCacheStats(): { size: number; count: number };
}
```

## Configuration

**Settings Page additions:**
- Cache size limit (default: 5GB)
- Auto-download missing assets (toggle)
- Download on cellular (toggle)

## Database Schema Changes

**Already exists:** `cloud_r2_key` column in assets table ✅

**Add new table:**
```sql
CREATE TABLE asset_cache_state (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  locally_available INTEGER NOT NULL DEFAULT 1,
  last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
  cache_size_bytes INTEGER NOT NULL DEFAULT 0
);
```

## API Changes

**New IPC handlers:**
- `assets:get-file` - Get file path (lazy load if needed)
- `assets:download-to-cache` - Explicitly download asset
- `assets:clear-cache` - Clear local cache
- `assets:get-cache-stats` - Get cache usage

**Modified:**
- `assets:insert` - Upload to R2 after local save

## Success Criteria

- [ ] Assets load instantly from local cache
- [ ] Missing assets download automatically from R2
- [ ] Upload happens in background (non-blocking)
- [ ] Cache respects user-defined size limits
- [ ] Works offline for cached assets
