/**
 * Sync service for merging localStorage prediction inputs with history cache.
 * Reads from localStorage `wavespeed_prediction_inputs` and updates the cache database.
 */

import { net } from "electron";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, statSync } from "fs";
import { app } from "electron";
import type { ReferenceImage } from "@/types/history-cache";
import * as predictionRepo from "../db/prediction-repo";

interface LocalStorageEntry {
  predictionId: string;
  modelId: string;
  modelName: string;
  inputs: Record<string, unknown>;
  createdAt: string;
}

interface SyncProgress {
  stage: "reading" | "downloading" | "updating" | "complete";
  current: number;
  total: number;
  percentage: number;
}

type ProgressListener = (progress: SyncProgress) => void;

class LocalStorageSyncService {
  private progressListeners: Set<ProgressListener> = new Set();
  private isSyncing = false;
  private historyImagesDir: string;

  constructor() {
    const userDataPath = app.getPath("userData");
    this.historyImagesDir = join(userDataPath, "history-images");

    // Ensure directory exists
    if (!existsSync(this.historyImagesDir)) {
      mkdirSync(this.historyImagesDir, { recursive: true });
    }
  }

  onProgress(callback: ProgressListener): () => void {
    this.progressListeners.add(callback);
    return () => this.progressListeners.delete(callback);
  }

  private emitProgress(progress: SyncProgress): void {
    this.progressListeners.forEach((cb) => cb(progress));
  }

  /**
   * Parse localStorage data and sync to history cache.
   * @param localStorageData The JSON string from localStorage
   */
  async syncFromLocalStorage(
    localStorageData: string,
  ): Promise<{ success: boolean; count: number; errors: string[] }> {
    if (this.isSyncing) {
      console.log("[LocalStorage Sync] Already syncing, skipping");
      return { success: false, count: 0, errors: ["Already syncing"] };
    }

    this.isSyncing = true;
    const errors: string[] = [];

    try {
      // Stage 1: Parse and validate data
      console.log("[LocalStorage Sync] Reading localStorage data...");
      this.emitProgress({
        stage: "reading",
        current: 0,
        total: 100,
        percentage: 0,
      });

      let entries: LocalStorageEntry[];
      try {
        entries = JSON.parse(localStorageData) as LocalStorageEntry[];
        if (!Array.isArray(entries)) {
          throw new Error("Invalid data format: expected array");
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error("[LocalStorage Sync] Failed to parse data:", error);
        return { success: false, count: 0, errors: [error] };
      }

      console.log(`[LocalStorage Sync] Found ${entries.length} entries`);

      // Stage 2: Extract image URLs from inputs
      console.log("[LocalStorage Sync] Extracting image URLs...");
      this.emitProgress({
        stage: "reading",
        current: entries.length,
        total: entries.length * 3,
        percentage: Math.round((1 / 3) * 100),
      });

      const itemsWithImages: Array<{ predictionId: string; urls: string[] }> = [];

      for (const entry of entries) {
        // Extract image URLs from inputs
        const urls = this.extractImageUrls(entry.inputs);

        if (urls.length > 0) {
          itemsWithImages.push({ predictionId: entry.predictionId, urls });
        }

        // Update database with input details (without images first)
        try {
          const existing = predictionRepo.getPredictionById(entry.predictionId);
          if (existing) {
            // Update existing prediction with input details
            predictionRepo.updatePredictionInputDetails(
              entry.predictionId,
              entry.inputs,
              [], // Will be filled after download
            );
          } else {
            // Create new prediction entry from localStorage data
            predictionRepo.upsertPrediction({
              id: entry.predictionId,
              model: entry.modelId,
              status: "completed", // Assume completed if in localStorage
              outputs: [],
              inputs: entry.inputs,
              input_details: entry.inputs,
              reference_images: [],
              created_at: entry.createdAt,
              updated_at: entry.createdAt,
              execution_time: undefined,
              has_nsfw_contents: undefined,
              error: undefined,
              synced_at: new Date().toISOString(),
            });
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.error(
            `[LocalStorage Sync] Failed to update prediction ${entry.predictionId}:`,
            error,
          );
          errors.push(`${entry.predictionId}: ${error}`);
        }

        this.emitProgress({
          stage: "reading",
          current: entries.length + itemsWithImages.length,
          total: entries.length * 3,
          percentage: Math.round(((entries.length + itemsWithImages.length) / (entries.length * 3)) * 100),
        });
      }

      // Stage 3: Download images
      if (itemsWithImages.length > 0) {
        const totalImages = itemsWithImages.reduce((sum, item) => sum + item.urls.length, 0);
        console.log(`[LocalStorage Sync] Downloading ${totalImages} images...`);
        this.emitProgress({
          stage: "downloading",
          current: 0,
          total: totalImages,
          percentage: 0,
        });

        const downloadedImages = await this.downloadImages(itemsWithImages);

        // Stage 4: Update database with downloaded image paths
        console.log("[LocalStorage Sync] Updating database with image paths...");
        this.emitProgress({
          stage: "updating",
          current: 0,
          total: downloadedImages.size,
          percentage: 0,
        });

        let updated = 0;
        for (const [predictionId, refImages] of downloadedImages) {
          try {
            const prediction = predictionRepo.getPredictionById(predictionId);
            if (prediction) {
              predictionRepo.updatePredictionInputDetails(
                predictionId,
                prediction.input_details || {},
                refImages,
              );
              updated++;
            }
          } catch (err) {
            console.error(`[LocalStorage Sync] Failed to update prediction ${predictionId}:`, err);
          }

          this.emitProgress({
            stage: "updating",
            current: updated,
            total: downloadedImages.size,
            percentage: Math.round((updated / downloadedImages.size) * 100),
          });
        }
      }

      this.emitProgress({
        stage: "complete",
        current: entries.length,
        total: entries.length,
        percentage: 100,
      });

      console.log("[LocalStorage Sync] Sync completed");
      return { success: true, count: entries.length, errors };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error("[LocalStorage Sync] Sync failed:", error);
      errors.push(error);
      return { success: false, count: 0, errors };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Extract image URLs from prediction inputs.
   * Reuses logic from sync-service.ts.
   */
  private extractImageUrls(inputs: Record<string, unknown>): string[] {
    const urls: string[] = [];

    for (const [key, value] of Object.entries(inputs)) {
      // Check if key suggests an image field
      if (
        key.endsWith("_image") ||
        key.endsWith("_url") ||
        key.includes("image")
      ) {
        // Handle string URLs
        if (typeof value === "string" && this.isValidImageUrl(value)) {
          urls.push(value);
        }
        // Handle arrays of URLs
        else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string" && this.isValidImageUrl(item)) {
              urls.push(item);
            }
          }
        }
      }
    }

    return urls;
  }

  /**
   * Basic validation for image URLs.
   */
  private isValidImageUrl(url: string): boolean {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return false;
    }

    // Check for image extensions or CDN patterns
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    const lowerUrl = url.toLowerCase();

    return (
      imageExtensions.some((ext) => lowerUrl.includes(ext)) ||
      lowerUrl.includes("imgur") ||
      lowerUrl.includes("cloudinary") ||
      lowerUrl.includes("cloudflare")
    );
  }

  /**
   * Get file extension from URL.
   */
  private getExtensionFromUrl(url: string): string {
    const urlLower = url.toLowerCase();
    const exts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

    for (const ext of exts) {
      if (urlLower.includes(ext)) {
        // Find the extension in the URL and extract it
        const index = urlLower.indexOf(ext);
        return url.substring(index, index + ext.length);
      }
    }

    return ".png"; // Default fallback
  }

  /**
   * Download a single image with retry logic.
   */
  private async downloadImage(
    url: string,
    destPath: string,
  ): Promise<{ success: true; localPath: string } | { success: false; error: string }> {
    const tempPath = destPath + ".download";

    try {
      const response = await net.fetch(url);
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(tempPath, buffer);
      renameSync(tempPath, destPath);

      const stats = statSync(destPath);
      console.log(`[LocalStorage Sync] Downloaded image: ${url} -> ${destPath} (${stats.size} bytes)`);

      return { success: true, localPath: destPath };
    } catch (err) {
      const error = err as Error;
      console.error(`[LocalStorage Sync] Failed to download ${url}:`, error.message);

      // Clean up temp file
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {}

      return { success: false, error: error.message };
    }
  }

  /**
   * Download multiple images with concurrency limit.
   */
  private async downloadImages(
    items: Array<{ predictionId: string; urls: string[] }>,
    concurrency = 5,
  ): Promise<Map<string, ReferenceImage[]>> {
    const results = new Map<string, ReferenceImage[]>();
    const queue: Array<{
      predictionId: string;
      url: string;
      index: number;
    }> = [];

    // Build queue
    for (const { predictionId, urls } of items) {
      urls.forEach((url, index) => {
        queue.push({ predictionId, url, index });
      });
    }

    let completed = 0;
    const total = queue.length;

    // Process queue with concurrency limit
    const processBatch = async (): Promise<void> => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        const { predictionId, url, index } = item;
        const ext = this.getExtensionFromUrl(url);
        const filename = `${predictionId}_ref_${index}${ext}`;
        const destPath = join(this.historyImagesDir, filename);

        // Check if already exists
        if (existsSync(destPath)) {
          if (!results.has(predictionId)) {
            results.set(predictionId, []);
          }
          results.get(predictionId)!.push({ url, localPath: destPath });
          completed++;
          this.emitProgress({
            stage: "downloading",
            current: completed,
            total,
            percentage: Math.round((completed / total) * 100),
          });
          continue;
        }

        // Download
        const result = await this.downloadImage(url, destPath);
        if (result.success) {
          if (!results.has(predictionId)) {
            results.set(predictionId, []);
          }
          results.get(predictionId)!.push({
            url,
            localPath: result.localPath,
          });
        }

        completed++;
        this.emitProgress({
          stage: "downloading",
          current: completed,
          total,
          percentage: Math.round((completed / total) * 100),
        });
      }
    };

    // Launch concurrent workers
    const workers = Array.from({ length: concurrency }, () => processBatch());
    await Promise.all(workers);

    return results;
  }

  isCurrentlySyncing(): boolean {
    return this.isSyncing;
  }
}

// Singleton instance
let syncServiceInstance: LocalStorageSyncService | null = null;

export function getLocalStorageSyncService(): LocalStorageSyncService {
  if (!syncServiceInstance) {
    syncServiceInstance = new LocalStorageSyncService();
  }
  return syncServiceInstance;
}
