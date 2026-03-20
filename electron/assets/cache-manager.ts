/**
 * Cache manager for local asset storage with LRU eviction.
 * Manages disk space usage and provides cache statistics.
 */

import { existsSync, statSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { getDatabase } from "./db/connection";

export interface CacheStats {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
  usagePercentage: number;
  oldestAccess?: string;
}

export interface CacheEntry {
  assetId: string;
  filePath: string;
  lastAccessed: string;
  fileSize: number;
}

// Default cache size: 5GB
const DEFAULT_CACHE_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

export class CacheManager {
  private maxBytes: number;
  private assetsDir: string;

  constructor(maxBytes: number = DEFAULT_CACHE_SIZE_BYTES, assetsDir?: string) {
    this.maxBytes = maxBytes;
    this.assetsDir = assetsDir || this.getDefaultAssetsDir();
  }

  /**
   * Get the maximum cache size in bytes.
   */
  getMaxSizeBytes(): number {
    return this.maxBytes;
  }

  /**
   * Set the maximum cache size.
   */
  setMaxSizeBytes(bytes: number): void {
    this.maxBytes = bytes;
  }

  /**
   * Get current cache statistics.
   */
  getCacheStats(): CacheStats {
    try {
      const db = getDatabase();
      const result = db.exec(`
        SELECT
          COUNT(*) as count,
          SUM(file_size) as total_bytes,
          MIN(created_at) as oldest_access
        FROM assets
        WHERE sync_status != 'deleted'
      `);

      if (result.length > 0 && result[0].values.length > 0) {
        const row = result[0].values[0];
        return {
          totalFiles: (row[0] as number) || 0,
          totalBytes: (row[1] as number) || 0,
          maxBytes: this.maxBytes,
          usagePercentage: this.maxBytes > 0
            ? Math.round((((row[1] as number) || 0) / this.maxBytes) * 100)
            : 0,
          oldestAccess: (row[2] as string) || undefined,
        };
      }
    } catch (error) {
      console.error("[CacheManager] Failed to get cache stats:", error);
    }

    return {
      totalBytes: 0,
      totalFiles: 0,
      maxBytes: this.maxBytes,
      usagePercentage: 0,
    };
  }

  /**
   * Evict least recently used assets to free up space.
   * Returns number of bytes freed.
   */
  evictLRU(bytesNeeded: number): number {
    const stats = this.getCacheStats();
    const availableSpace = this.maxBytes - stats.totalBytes;

    if (availableSpace >= bytesNeeded) {
      return 0; // No eviction needed
    }

    const toFree = bytesNeeded - availableSpace;
    let freed = 0;

    try {
      const db = getDatabase();

      // Get assets ordered by creation date (oldest first as LRU proxy)
      const result = db.exec(`
        SELECT id, file_path, file_size
        FROM assets
        WHERE sync_status != 'deleted'
        ORDER BY created_at ASC
      `);

      if (result.length > 0) {
        for (const row of result[0].values) {
          if (freed >= toFree) break;

          const assetId = row[0] as string;
          const filePath = row[1] as string;
          const fileSize = row[2] as number;

          // Delete file from disk (unlink throws if not exists, which we catch)
          try {
            unlinkSync(filePath);
            freed += fileSize;
          } catch (err) {
            // File may not exist or other error - continue
            console.error(`[CacheManager] Failed to delete file ${filePath}:`, err);
          }

          // Note: We keep the DB record but can add a flag for locally_available
          // This will be implemented as part of the cache state table
        }
      }

      console.log(`[CacheManager] Evicted ${freed} bytes to free space`);
    } catch (error) {
      console.error("[CacheManager] Failed to evict LRU:", error);
    }

    return freed;
  }

  /**
   * Check if a file exists locally.
   */
  fileExists(filePath: string): boolean {
    return existsSync(filePath);
  }

  /**
   * Get file size in bytes.
   */
  getFileSize(filePath: string): number {
    try {
      return statSync(filePath).size;
    } catch {
      return 0;
    }
  }

  /**
   * Clear all cached files (metadata remains in DB).
   */
  clearCache(): { deleted: number; freed: number } {
    let deleted = 0;
    let freed = 0;

    try {
      const db = getDatabase();
      const result = db.exec("SELECT file_path, file_size FROM assets WHERE sync_status != 'deleted'");

      if (result.length > 0) {
        for (const row of result[0].values) {
          const filePath = row[0] as string;
          const fileSize = row[1] as number;

          try {
            unlinkSync(filePath);
            deleted++;
            freed += fileSize;
          } catch (err) {
            // File may not exist or other error - continue
            console.error(`[CacheManager] Failed to delete ${filePath}:`, err);
          }
        }
      }

      console.log(`[CacheManager] Cleared cache: ${deleted} files, ${freed} bytes freed`);
    } catch (error) {
      console.error("[CacheManager] Failed to clear cache:", error);
    }

    return { deleted, freed };
  }

  /**
   * Ensure enough space is available before downloading a file.
   * Returns true if space is available or was made available.
   */
  ensureSpace(fileSize: number): boolean {
    const stats = this.getCacheStats();
    const availableSpace = this.maxBytes - stats.totalBytes;

    if (availableSpace >= fileSize) {
      return true;
    }

    // Try to evict enough space
    const freed = this.evictLRU(fileSize);
    return (availableSpace + freed) >= fileSize;
  }

  /**
   * Update last accessed time for an asset (for LRU tracking).
   */
  updateAccessTime(assetId: string): void {
    try {
      const db = getDatabase();
      db.run("UPDATE assets SET updated_at = ? WHERE id = ?", [new Date().toISOString(), assetId]);
    } catch (error) {
      console.error("[CacheManager] Failed to update access time:", error);
    }
  }

  /**
   * Get default assets directory from app data.
   */
  private getDefaultAssetsDir(): string {
    const { app } = require("electron");
    const { join } = require("path");

    return join(app.getPath("documents"), "WaveSpeed");
  }
}

// Singleton instance
let cacheManagerInstance: CacheManager | null = null;

export function getCacheManager(): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager();
  }
  return cacheManagerInstance;
}

export function setCacheManager(manager: CacheManager): void {
  cacheManagerInstance = manager;
}
