/**
 * Enhanced history sync service with reference image downloads.
 * Downloads and caches reference images from prediction inputs.
 */

import { net } from "electron";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, renameSync, statSync, unlinkSync } from "fs";
import { app } from "electron";
import type { HistoryItem } from "@/types/prediction";
import type { ReferenceImage } from "@/types/history-cache";
import * as predictionRepo from "./db/prediction-repo";

interface SyncProgress {
  stage: "fetching" | "downloading" | "complete";
  current: number;
  total: number;
  percentage: number;
}

type ProgressListener = (progress: SyncProgress) => void;

class HistorySyncService {
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
   * Extract image URLs from prediction inputs.
   * Looks for fields ending with _image, _url, or containing "image" in the value.
   */
  private extractImageUrls(
    inputs: Record<string, unknown>,
  ): string[] {
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
   * Accepts http/https URLs with common image extensions or from known CDNs.
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
      console.log(`[History Sync] Downloaded image: ${url} -> ${destPath} (${stats.size} bytes)`);

      return { success: true, localPath: destPath };
    } catch (err) {
      const error = err as Error;
      console.error(`[History Sync] Failed to download ${url}:`, error.message);

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

  /**
   * Enhanced sync: fetch history, download images, update database.
   */
  async syncHistoryWithImages(
    fetchHistory: () => Promise<HistoryItem[]>,
    fetchDetails: (predictionId: string) => Promise<{
      input?: Record<string, unknown>;
    }>,
  ): Promise<{ success: boolean; count: number; errors: string[] }> {
    if (this.isSyncing) {
      console.log("[History Sync] Already syncing, skipping");
      return { success: false, count: 0, errors: ["Already syncing"] };
    }

    this.isSyncing = true;
    const errors: string[] = [];

    try {
      // Stage 1: Fetch history
      console.log("[History Sync] Fetching history...");
      this.emitProgress({
        stage: "fetching",
        current: 0,
        total: 100,
        percentage: 0,
      });

      const items = await fetchHistory();
      console.log(`[History Sync] Fetched ${items.length} items`);

      // Bulk upsert basic prediction data
      predictionRepo.upsertPredictions(items);

      this.emitProgress({
        stage: "fetching",
        current: items.length,
        total: items.length * 2, // Approximate for progress calc
        percentage: 25,
      });

      // Stage 2: Fetch details and extract images
      console.log("[History Sync] Fetching details and extracting images...");
      const itemsWithImages: Array<{ predictionId: string; urls: string[] }> = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        try {
          // Fetch details to get full inputs
          const details = await fetchDetails(item.id);

          console.log(`[History Sync] Details for ${item.id}:`, details);
          console.log(`[History Sync] Has input field:`, !!details.input);

          if (details.input) {
            // Extract image URLs from inputs
            const urls = this.extractImageUrls(details.input);

            console.log(`[History Sync] Extracted ${urls.length} image URLs for ${item.id}`);

            if (urls.length > 0) {
              itemsWithImages.push({ predictionId: item.id, urls });

              // Update database with input details
              console.log(`[History Sync] Updating input details for ${item.id}`);
              predictionRepo.updatePredictionInputDetails(
                item.id,
                details.input,
                [], // Will be filled after download
              );
            } else {
              // Still save input details even if no images (prompts, etc.)
              console.log(`[History Sync] No images but saving input details for ${item.id}`);
              predictionRepo.updatePredictionInputDetails(
                item.id,
                details.input,
                [],
              );
            }
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.error(`[History Sync] Failed to fetch details for ${item.id}:`, error);
          errors.push(`${item.id}: ${error}`);
        }

        // Update progress
        this.emitProgress({
          stage: "fetching",
          current: items.length + i,
          total: items.length * 2,
          percentage: Math.round(((items.length + i) / (items.length * 2)) * 50) + 25,
        });
      }

      // Stage 3: Download images
      if (itemsWithImages.length > 0) {
        console.log(`[History Sync] Downloading ${itemsWithImages.reduce((sum, item) => sum + item.urls.length, 0)} images...`);
        this.emitProgress({
          stage: "downloading",
          current: 0,
          total: 100,
          percentage: 50,
        });

        const downloadedImages = await this.downloadImages(itemsWithImages);

        // Update database with downloaded image paths
        for (const [predictionId, refImages] of downloadedImages) {
          try {
            const prediction = predictionRepo.getPredictionById(predictionId);
            if (prediction) {
              predictionRepo.updatePredictionInputDetails(
                predictionId,
                prediction.input_details || {},
                refImages,
              );
            }
          } catch (err) {
            console.error(`[History Sync] Failed to update prediction ${predictionId}:`, err);
          }
        }
      }

      this.emitProgress({
        stage: "complete",
        current: items.length,
        total: items.length,
        percentage: 100,
      });

      console.log("[History Sync] Sync completed");
      return { success: true, count: items.length, errors };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error("[History Sync] Sync failed:", error);
      errors.push(error);
      return { success: false, count: 0, errors };
    } finally {
      this.isSyncing = false;
    }
  }

  isCurrentlySyncing(): boolean {
    return this.isSyncing;
  }
}

// Singleton instance
let syncServiceInstance: HistorySyncService | null = null;

export function getHistorySyncService(): HistorySyncService {
  if (!syncServiceInstance) {
    syncServiceInstance = new HistorySyncService();
  }
  return syncServiceInstance;
}
