/**
 * Cloudflare R2 client for cloud file storage.
 * Uses @aws-sdk/client-s3 for reliable SigV4 authentication.
 */

import { createHash } from "crypto";
import { readFileSync, statSync, existsSync, writeFileSync, mkdirSync, dirname } from "fs";
import { join } from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  userId?: string;
  publicUrl?: string; // Public r2.dev URL for fast downloads
}

export interface UploadProgress {
  assetId: string;
  fileName: string;
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
}

export interface UploadResult {
  success: boolean;
  key?: string;
  url?: string;
  error?: string;
}

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export class R2Client {
  private config: R2Config;
  private s3Client: S3Client;
  private publicEndpoint?: string;

  constructor(config: R2Config) {
    this.config = config;

    // Initialize S3Client with R2 credentials
    this.s3Client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts: 3,
    });

    // r2.dev public endpoint for unauthenticated downloads (if bucket is public)
    this.publicEndpoint = config.publicUrl || undefined;
  }

  /**
   * Generate R2 storage key for an asset file.
   */
  generateKey(assetId: string, type: string, extension: string): string {
    const userId = this.config.userId || "anonymous";
    const subdir = this.getSubdir(type);
    return `assets/${userId}/${subdir}/${assetId}.${extension}`;
  }

  /**
   * Generate R2 storage key for a thumbnail.
   */
  generateThumbnailKey(assetId: string, extension: string = "webp"): string {
    const userId = this.config.userId || "anonymous";
    return `assets/${userId}/thumbnails/${assetId}_thumb.${extension}`;
  }

  /**
   * Get the R2 configuration (for external auth generation).
   */
  getConfig(): R2Config {
    return { ...this.config };
  }

  /**
   * Upload a file to R2 using AWS SDK.
   */
  async uploadFile(
    assetId: string,
    filePath: string,
    type: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    try {
      if (!existsSync(filePath)) {
        return { success: false, error: "File does not exist" };
      }

      const stats = statSync(filePath);
      const extension = this.getExtension(filePath);
      const key = this.generateKey(assetId, type, extension);

      console.log("[R2Client] Uploading file:", { key, filePath, size: stats.size });

      const fileBuffer = readFileSync(filePath);

      const command = new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: this.getContentType(extension),
      });

      const response = await this.s3Client.send(command);

      console.log("[R2Client] Upload successful:", { key, etag: response.ETag });

      onProgress?.({
        assetId,
        fileName: key.split("/").pop() || "",
        bytesUploaded: stats.size,
        totalBytes: stats.size,
        percentage: 100,
      });

      return {
        success: true,
        key,
        url: this.getPublicUrl(key),
      };
    } catch (error) {
      console.error("[R2Client] Upload error:", error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Upload a thumbnail buffer to R2.
   */
  async uploadThumbnail(
    assetId: string,
    thumbnailBuffer: Buffer,
    extension: string = "webp"
  ): Promise<UploadResult> {
    const key = this.generateThumbnailKey(assetId, extension);

    try {
      const command = new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: thumbnailBuffer,
        ContentType: "image/webp",
      });

      const response = await this.s3Client.send(command);

      return {
        success: true,
        key,
        url: this.getPublicUrl(key),
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get the download URL for a file.
   * Uses public URL if available (faster, no auth), otherwise returns presigned URL.
   */
  getDownloadUrl(key: string): string {
    // Use public r2.dev URL if configured (faster, no auth needed)
    if (this.publicEndpoint) {
      return `${this.publicEndpoint}/${this.config.bucket}/${key}`;
    }
    // Fallback to direct R2 URL
    return `https://${this.config.accountId}.r2.cloudflarestorage.com/${this.config.bucket}/${key}`;
  }

  /**
   * Download a file from R2 to a local path.
   */
  async downloadFile(
    key: string,
    destPath: string,
    onProgress?: (bytes: number, total: number) => void
  ): Promise<DownloadResult> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      // Convert stream to buffer
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      // For download, we'll use the Body stream directly
      if (!response.Body) {
        return { success: false, error: "No data in response" };
      }

      // @ts-ignore - Body is a ReadableStream in Node
      const buffer = Buffer.from(await response.Body.transformToByteArray());

      // Write to file
      if (!existsSync(dirname(destPath))) {
        mkdirSync(dirname(destPath), { recursive: true });
      }
      writeFileSync(destPath, buffer);

      onProgress?.(buffer.length, buffer.length);

      return { success: true, filePath: destPath };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Delete a file from R2.
   */
  async deleteFile(key: string): Promise<{ success: boolean; error?: string }> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Check if a file exists in R2.
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the public URL for a file (if bucket is public or using custom domain).
   */
  getPublicUrl(key: string): string {
    return `https://${this.config.accountId}.r2.cloudflarestorage.com/${this.config.bucket}/${key}`;
  }

  /**
   * Check if R2 client is properly configured with credentials.
   */
  isConfigured(): boolean {
    const configured = !!(
      this.config.accountId &&
      this.config.accessKeyId &&
      this.config.secretAccessKey &&
      this.config.bucket
    );
    if (!configured) {
      console.error("[R2 Client] Not configured:", {
        hasAccountId: !!this.config.accountId,
        hasAccessKeyId: !!this.config.accessKeyId,
        hasSecretAccessKey: !!this.config.secretAccessKey,
        hasBucket: !!this.config.bucket,
      });
    }
    return configured;
  }

  /**
   * Get content type based on file extension.
   */
  private getContentType(extension: string): string {
    const ext = extension.toLowerCase();
    const imageTypes = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
    const videoTypes = ["mp4", "webm", "mov", "avi", "mkv"];
    const audioTypes = ["mp3", "wav", "ogg", "aac", "m4a"];

    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
    if (ext === "svg") return "image/svg+xml";
    if (videoTypes.includes(ext)) return "video/mp4";
    if (audioTypes.includes(ext)) return "audio/mpeg";
    return "application/octet-stream";
  }

  /**
   * Get subdirectory based on asset type.
   */
  private getSubdir(type: string): string {
    switch (type) {
      case "image":
        return "images";
      case "video":
        return "videos";
      case "audio":
        return "audio";
      case "text":
      case "json":
        return "text";
      default:
        return "other";
    }
  }

  /**
   * Get file extension from path.
   */
  private getExtension(filePath: string): string {
    const match = filePath.match(/\.([a-zA-Z0-9]+)$/);
    return match ? match[1] : "bin";
  }
}
