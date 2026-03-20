---
title: "Phase 07: Testing & Validation"
description: "Comprehensive testing for database migration, sync, and conflict resolution"
status: pending
priority: P1
effort: 5h
tags: [testing, validation, migration]
created: 2026-03-18
---

# Phase 07: Testing & Validation

## Context Links
- Parent: [plan.md](./plan.md)
- All previous phases required

## Overview

Comprehensive testing to ensure:
- Migration works without data loss
- Local database operations work correctly
- Cloud sync functions properly
- Conflict resolution behaves as expected
- Performance meets requirements

## Test Categories

### 1. Migration Tests

```typescript
// tests/migration.test.ts

import { migrateJsonToSqlite, rollbackMigration } from "../electron/assets/migrations/migrate-v1-to-v2";
import { openDatabase, closeDatabase } from "../electron/assets/db";
import { assetsRepo } from "../electron/assets/db/assets.repo";
import { foldersRepo } from "../electron/assets/db/folders.repo";
import { tagsRepo } from "../electron/assets/db/tags.repo";

describe("Migration: JSON to SQLite", () => {
  beforeAll(async () => {
    // Set up test JSON files
    setupTestData();
  });

  afterAll(() => {
    closeDatabase();
    cleanupTestData();
  });

  it("should migrate all assets", async () => {
    const result = await migrateJsonToSqlite();

    expect(result.success).toBe(true);
    expect(result.assetsMigrated).toBe(100); // Test data count
    expect(result.errors).toHaveLength(0);
  });

  it("should preserve asset metadata", async () => {
    await openDatabase();
    const assets = assetsRepo.getFiltered({});

    expect(assets).toHaveLength(100);

    // Spot check specific asset
    const asset = assetsRepo.getById("test-asset-1");
    expect(asset).toBeDefined();
    expect(asset?.fileName).toBe("wavespeed-ai_flux-schnell_abc123_0.png");
    expect(asset?.tags).toEqual(["generated", "portrait"]);
    expect(asset?.favorite).toBe(true);
  });

  it("should migrate folders", async () => {
    const result = await migrateJsonToSqlite();

    expect(result.foldersMigrated).toBe(5);

    const folders = foldersRepo.getAll();
    expect(folders).toHaveLength(5);

    const folder = folders.find((f) => f.name === "Portraits");
    expect(folder).toBeDefined();
    expect(folder?.color).toBe("blue");
  });

  it("should migrate tag categories", async () => {
    const result = await migrateJsonToSqlite();

    expect(result.tagCategoriesMigrated).toBe(3);

    const categories = tagsRepo.getAllCategories();
    expect(categories).toHaveLength(3);
  });

  it("should preserve folder relationships", async () => {
    await openDatabase();
    const assets = assetsRepo.getFiltered({ folderId: "folder-1" });

    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((a) => a.folderId === "folder-1")).toBe(true);
  });

  it("should preserve deleted assets registry", async () => {
    // Deleted assets should not appear in queries
    const assets = assetsRepo.getFiltered({});
    const deleted = assets.find((a) => a.id === "deleted-asset-1");

    expect(deleted).toBeUndefined();
  });

  it("should be idempotent", async () => {
    const result1 = await migrateJsonToSqlite();
    const result2 = await migrateJsonToSqlite();

    expect(result1.assetsMigrated).toBe(result2.assetsMigrated);
  });

  it("should rollback on failure", async () => {
    // Simulate corrupted data
    setupCorruptedData();

    const result = await migrateJsonToSqlite();
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    // Rollback should restore original
    const restored = rollbackMigration();
    expect(restored).toBe(true);
  });
});
```

### 2. Database Operation Tests

```typescript
// tests/database.test.ts

describe("Database Operations", () => {
  beforeEach(async () => {
    await openDatabase();
    // Clear test data
    transaction((db) => db.run("DELETE FROM assets"));
  });

  afterEach(() => {
    persistDatabase();
  });

  it("should insert asset with tags", () => {
    const id = assetsRepo.insert({
      id: "test-1",
      filePath: "/test/path.png",
      fileName: "test.png",
      type: "image",
      modelId: "test/model",
      createdAt: new Date().toISOString(),
      fileSize: 1024,
      favorite: false,
      tags: ["tag1", "tag2"],
    });

    const asset = assetsRepo.getById(id);
    expect(asset).toBeDefined();
    expect(asset?.tags).toEqual(["tag1", "tag2"]);
  });

  it("should update asset tags", () => {
    const id = assetsRepo.insert({
      id: "test-1",
      filePath: "/test/path.png",
      fileName: "test.png",
      type: "image",
      modelId: "test/model",
      createdAt: new Date().toISOString(),
      fileSize: 1024,
      favorite: false,
      tags: ["tag1"],
    });

    assetsRepo.update(id, { tags: ["tag1", "tag2", "tag3"] });

    const asset = assetsRepo.getById(id);
    expect(asset?.tags).toEqual(["tag1", "tag2", "tag3"]);
  });

  it("should filter by multiple criteria", () => {
    // Insert test data
    for (let i = 0; i < 10; i++) {
      assetsRepo.insert({
        id: `test-${i}`,
        filePath: `/test/path${i}.png`,
        fileName: `test${i}.png`,
        type: i % 2 === 0 ? "image" : "video",
        modelId: i < 5 ? "model/a" : "model/b",
        createdAt: new Date(Date.now() - i * 1000000).toISOString(),
        fileSize: 1024 * (i + 1),
        favorite: i % 3 === 0,
        tags: [],
      });
    }

    const results = assetsRepo.getFiltered({
      types: ["image"],
      models: ["model/a"],
      favoritesOnly: true,
    });

    expect(results.length).toBe(1); // Only test-0 matches all
  });

  it("should handle pagination", () => {
    for (let i = 0; i < 25; i++) {
      assetsRepo.insert({
        id: `test-${i}`,
        filePath: `/test/path${i}.png`,
        fileName: `test${i}.png`,
        type: "image",
        modelId: "test/model",
        createdAt: new Date().toISOString(),
        fileSize: 1024,
        favorite: false,
        tags: [],
      });
    }

    const page1 = assetsRepo.getFiltered({ limit: 10, offset: 0 });
    const page2 = assetsRepo.getFiltered({ limit: 10, offset: 10 });
    const page3 = assetsRepo.getFiltered({ limit: 10, offset: 20 });

    expect(page1.length).toBe(10);
    expect(page2.length).toBe(10);
    expect(page3.length).toBe(5);
  });

  it("should soft delete asset", () => {
    const id = assetsRepo.insert({
      id: "test-1",
      filePath: "/test/path.png",
      fileName: "test.png",
      type: "image",
      modelId: "test/model",
      createdAt: new Date().toISOString(),
      fileSize: 1024,
      favorite: false,
      tags: [],
    });

    assetsRepo.delete(id);

    const asset = assetsRepo.getById(id);
    expect(asset).toBeNull(); // Soft deleted assets not returned
  });

  it("should handle folder operations", () => {
    const id = foldersRepo.create({
      name: "Test Folder",
      color: "red",
    });

    const folders = foldersRepo.getAll();
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("Test Folder");

    foldersRepo.update(id, { name: "Updated Folder" });
    const updated = foldersRepo.getAll();
    expect(updated[0].name).toBe("Updated Folder");
  });
});
```

### 3. Sync Tests (with mock D1)

```typescript
// tests/sync.test.ts

import { SyncManager } from "../electron/assets/sync/sync-manager";
import type { SyncConfig } from "../electron/assets/sync/sync-manager";

// Mock D1 client
jest.mock("../electron/assets/sync/d1-client");

describe("Sync Manager", () => {
  let syncManager: SyncManager;
  let mockD1: jest.Mocked<D1Client>;

  const config: SyncConfig = {
    accountId: "test-account",
    databaseId: "test-db",
    apiToken: "test-token",
    deviceId: "test-device",
    autoSync: false,
    syncIntervalMinutes: 15,
  };

  beforeEach(async () => {
    await openDatabase();
    // Clear database
    transaction((db) => {
      db.run("DELETE FROM assets");
      db.run("DELETE FROM folders");
      db.run("DELETE FROM sync_state");
    });

    mockD1 = new D1Client(config) as jest.Mocked<D1Client>;
    mockD1.ping.mockResolvedValue(true);
    mockD1.query.mockResolvedValue({ success: true, results: [] });

    syncManager = new SyncManager({ ...config, autoSync: false, syncIntervalMinutes: 15 });
    // Inject mock
    (syncManager as any).d1 = mockD1;
  });

  it("should connect to D1", async () => {
    const connected = await syncManager.ping();
    expect(connected).toBe(true);
    expect(mockD1.ping).toHaveBeenCalled();
  });

  it("should upload pending assets", async () => {
    // Create test asset
    assetsRepo.insert({
      id: "test-asset",
      filePath: "/test/path.png",
      fileName: "test.png",
      type: "image",
      modelId: "test/model",
      createdAt: new Date().toISOString(),
      fileSize: 1024,
      favorite: false,
      tags: [],
    });

    mockD1.query.mockResolvedValue({ success: true, results: [] });

    const result = await syncManager.sync();

    expect(result.success).toBe(true);
    expect(result.uploaded.assets).toBe(1);
  });

  it("should handle sync conflicts", async () => {
    // Create local asset
    assetsRepo.insert({
      id: "conflict-asset",
      filePath: "/local/path.png",
      fileName: "local.png",
      type: "image",
      modelId: "test/model",
      createdAt: "2024-01-01T00:00:00Z",
      fileSize: 1024,
      favorite: false,
      tags: [],
    });

    // Mock remote asset with same ID but different content
    mockD1.query.mockImplementation((sql) => {
      if (sql.includes("SELECT") && sql.includes("WHERE id = ?")) {
        return Promise.resolve({
          success: true,
          results: [{
            id: "conflict-asset",
            file_path: "/remote/path.png",
            version: 2,
            updated_at: "2024-01-02T00:00:00Z",
          }],
        });
      }
      return Promise.resolve({ success: true, results: [] });
    });

    const result = await syncManager.sync();

    expect(result.success).toBe(true);
    // Conflict should be resolved (remote wins due to newer timestamp)
  });

  it("should download remote changes", async () => {
    // Mock remote assets
    mockD1.query.mockImplementation((sql) => {
      if (sql.includes("SELECT * FROM assets WHERE updated_at >")) {
        return Promise.resolve({
          success: true,
          results: [{
            id: "remote-asset",
            file_path: "/remote/path.png",
            file_name: "remote.png",
            type: "image",
            model_id: "test/model",
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            file_size: 1024,
            favorite: 0,
          }],
        });
      }
      return Promise.resolve({ success: true, results: [] });
    });

    const result = await syncManager.sync();

    expect(result.downloaded.assets).toBe(1);

    const downloaded = assetsRepo.getById("remote-asset");
    expect(downloaded).toBeDefined();
  });

  it("should emit sync events", async () => {
    const events: SyncEvent[] = [];
    syncManager.onEvent((event) => events.push(event));

    await syncManager.sync();

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });
});
```

### 4. Performance Tests

```typescript
// tests/performance.test.ts

describe("Performance Tests", () => {
  it("should query 1000 assets in <100ms", async () => {
    await openDatabase();

    // Insert 1000 assets
    for (let i = 0; i < 1000; i++) {
      assetsRepo.insert({
        id: `perf-${i}`,
        filePath: `/test/path${i}.png`,
        fileName: `test${i}.png`,
        type: "image",
        modelId: "test/model",
        createdAt: new Date().toISOString(),
        fileSize: 1024,
        favorite: false,
        tags: [],
      });
    }

    const start = performance.now();
    const results = assetsRepo.getFiltered({});
    const duration = performance.now() - start;

    expect(results).toHaveLength(1000);
    expect(duration).toBeLessThan(100);
  });

  it("should filter with tags in <50ms", async () => {
    await openDatabase();

    // Insert assets with various tags
    const tags = ["portrait", "landscape", "abstract", "realistic"];
    for (let i = 0; i < 500; i++) {
      assetsRepo.insert({
        id: `perf-tag-${i}`,
        filePath: `/test/path${i}.png`,
        fileName: `test${i}.png`,
        type: "image",
        modelId: "test/model",
        createdAt: new Date().toISOString(),
        fileSize: 1024,
        favorite: false,
        tags: [tags[i % tags.length]],
      });
    }

    const start = performance.now();
    const results = assetsRepo.getFiltered({ tags: ["portrait"] });
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(50);
    expect(results.length).toBe(125); // 500 / 4
  });

  it("should handle batch updates efficiently", async () => {
    await openDatabase();

    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = assetsRepo.insert({
        id: `batch-${i}`,
        filePath: `/test/path${i}.png`,
        fileName: `test${i}.png`,
        type: "image",
        modelId: "test/model",
        createdAt: new Date().toISOString(),
        fileSize: 1024,
        favorite: false,
        tags: [],
      });
      ids.push(id);
    }

    const start = performance.now();
    for (const id of ids) {
      assetsRepo.update(id, { favorite: true });
    }
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500); // 5ms per update average
  });
});
```

### 5. Integration Tests

```typescript
// tests/integration.test.ts

describe("Integration Tests", () => {
  it("should handle full workflow: migrate -> query -> update -> sync", async () => {
    // 1. Set up JSON data
    setupTestJsonData();

    // 2. Migrate
    const migrationResult = await migrateJsonToSqlite();
    expect(migrationResult.success).toBe(true);

    // 3. Query
    const assets = assetsRepo.getFiltered({ types: ["image"] });
    expect(assets.length).toBeGreaterThan(0);

    // 4. Update
    const asset = assets[0];
    assetsRepo.update(asset.id, { favorite: true });

    // 5. Sync (mocked)
    const syncResult = await syncManager.sync();
    expect(syncResult.success).toBe(true);
    expect(syncResult.uploaded.assets).toBe(1);
  });

  it("should handle offline -> online transition", async () => {
    // Start with sync disabled
    const config = { ...baseConfig, autoSync: false };
    const manager = new SyncManager(config);

    // Make changes while "offline"
    assetsRepo.insert({
      id: "offline-asset",
      filePath: "/offline/path.png",
      fileName: "offline.png",
      type: "image",
      modelId: "test/model",
      createdAt: new Date().toISOString(),
      fileSize: 1024,
      favorite: false,
      tags: [],
    });

    // Verify pending
    const pending = syncRepo.getPendingItems();
    expect(pending.assets).toContain("offline-asset");

    // Go "online" and sync
    mockD1.query.mockResolvedValue({ success: true, results: [] });
    const result = await manager.sync();

    expect(result.uploaded.assets).toBe(1);
  });
});
```

## Manual Testing Checklist

### Migration
- [ ] Backup created before migration
- [ ] All assets appear after migration
- [ ] Tags preserved correctly
- [ ] Folder assignments preserved
- [ ] Deleted assets stay deleted
- [ ] Favorites preserved
- [ ] File paths still valid

### Sync
- [ ] Manual sync button works
- [ ] Auto-sync runs on interval
- [ ] Upload pending changes works
- [ ] Download remote changes works
- [ ] Sync status indicator accurate
- [ ] Conflicts detected and shown

### Performance
- [ ] Assets page loads quickly (<500ms)
- [ ] Filtering responsive
- [ ] Pagination smooth
- [ ] Large file uploads don't block UI

### Edge Cases
- [ ] Empty asset list
- [ ] Very long tag names
- [ ] Special characters in filenames
- [ ] Network interruption during sync
- [ ] Corrupt database recovery

## Success Criteria

1. All automated tests pass
2. Migration completes without data loss
3. Query performance meets targets (<100ms for 1000 assets)
4. Sync works bidirectionally
5. Conflicts resolved correctly
6. No regressions in existing functionality

## Implementation Steps

1. [ ] Set up test framework (Jest/Vitest)
2. [ ] Implement migration tests
3. [ ] Implement database operation tests
4. [ ] Implement sync tests (with mocks)
5. [ ] Implement performance tests
6. [ ] Run manual testing checklist
7. [ ] Fix any discovered issues
8. [ ] Document test results

## Next Steps

After testing passes:
1. Update documentation
2. Create release notes
3. Plan deployment
