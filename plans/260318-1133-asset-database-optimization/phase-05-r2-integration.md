---
title: "Phase 05: Cloudflare R2 Integration"
description: "Implement Cloudflare R2 for cloud file storage (assets + thumbnails) with resumable uploads"
status: pending
priority: P2
effort: 4h
tags: [cloudflare, r2, storage, upload, thumbnails]
created: 2026-03-18
---

# Phase 05: Cloudflare R2 Integration

## Context Links
- Parent: [plan.md](./plan.md)
- D1 Sync: [phase-04-d1-integration.md](./phase-04-d1-integration.md)
- Cloudflare R2 Docs: https://developers.cloudflare.com/r2/

## Overview

Implement Cloudflare R2 (S3-compatible) for cloud file storage. R2 stores the actual asset files **and thumbnails** while D1 stores metadata. Thumbnail references are stored in the `thumbnail_r2_key` column of the assets table.

## Authentication

Uses the same **per-device API token** as D1 (see Phase 04). R2 credentials (accessKeyId, secretAccessKey) stored alongside the API token in electron-store.

## Architecture

```
Local Storage                    Cloud Storage
├── ~/WaveSpeed/images/    <->   R2 Bucket: assets/
├── ~/WaveSpeed/videos/    <->   R2 Bucket: assets/videos/
├── ~/WaveSpeed/audio/    <->    R2 Bucket: assets/audio/
└── ~/WaveSpeed/text/     <->    R2 Bucket: assets/text/
```

### R2 Key Pattern

```
assets/{userId}/{assetId}.{ext}
assets/{userId}/thumbnails/{assetId}_thumb.{ext}
```

## Implementation

### r2-client.ts

```typescript
import { createHash } from "crypto";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  userId?: string;
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

export class R2Client {
  private config: R2Config;
  private endpoint: string;

  constructor(config: R2Config) {
    this.config = config;
    this.endpoint = `https://${this.config.accountId}.r2.cloudflarestorage.com`;
  }

  // Generate R2 key for asset
  generateKey(assetId: string, type: string, extension: string): string {
    const userId = this.config.userId || "anonymous";
    const subdir = this.getSubdir(type);
    return `assets/${userId}/${subdir}/${assetId}.${extension}`;
  }

  // Generate thumbnail key
  generateThumbnailKey(assetId: string, extension: string): string {
    const userId = this.config.userId || "anonymous";
    return `assets/${userId}/thumbnails/${assetId}_thumb.${extension}`;
  }

  // Upload file to R2
  async uploadFile(
    assetId: string,
    filePath: string,
    type: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    try {
      const fs = require("fs");
      const { readFileSync, statSync } = fs;

      // Check file exists
      const stats = statSync(filePath);
      const fileBuffer = readFileSync(filePath);

      // Get extension
      const extension = this.getExtension(filePath);
      const key = this.generateKey(assetId, type, extension);

      // For large files (>100MB), use multipart upload
      if (stats.size > 100 * 1024 * 1024) {
        return await this.uploadMultipart(key, fileBuffer, stats.size, onProgress);
      }

      // Simple upload for smaller files
      return await this.uploadSimple(key, fileBuffer, stats.size, onProgress);
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // Simple upload (for files < 100MB)
  private async uploadSimple(
    key: string,
    data: Buffer,
    size: number,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    const url = `${this.endpoint}/${this.config.bucket}/${key}`;

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Authorization": this.generateAuthHeader("PUT", key, ""),
          "Content-Type": "application/octet-stream",
          "Content-Length": size.toString(),
          "x-amz-content-sha256": this.hashPayload(data),
        },
        body: data,
      });

      if (response.ok) {
        // Report completion
        onProgress?.({
          assetId: key.split("/").pop()?.split(".")[0] || "",
          fileName: key.split("/").pop() || "",
          bytesUploaded: size,
          totalBytes: size,
          percentage: 100,
        });

        return {
          success: true,
          key,
          url: this.getPublicUrl(key),
        };
      }

      return {
        success: false,
        error: `Upload failed: HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // Multipart upload (for files > 100MB)
  private async uploadMultipart(
    key: string,
    data: Buffer,
    size: number,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    const partSize = 10 * 1024 * 1024; // 10MB parts
    const totalParts = Math.ceil(size / partSize);
    const uploadId = await this.initiateMultipartUpload(key);

    if (!uploadId) {
      return { success: false, error: "Failed to initiate multipart upload" };
    }

    try {
      const parts: Array<{ partNumber: number; etag: string }> = [];

      for (let i = 0; i < totalParts; i++) {
        const start = i * partSize;
        const end = Math.min(start + partSize, size);
        const partData = data.subarray(start, end);

        const uploadResult = await this.uploadPart(key, uploadId, i + 1, partData);

        if (!uploadResult.etag) {
          throw new Error(`Failed to upload part ${i + 1}`);
        }

        parts.push({ partNumber: i + 1, etag: uploadResult.etag });

        onProgress?.({
          assetId: key.split("/").pop()?.split(".")[0] || "",
          fileName: key.split("/").pop() || "",
          bytesUploaded: end,
          totalBytes: size,
          percentage: Math.floor((end / size) * 100),
        });
      }

      // Complete multipart upload
      const completeResult = await this.completeMultipartUpload(key, uploadId, parts);

      if (completeResult.success) {
        return {
          success: true,
          key,
          url: this.getPublicUrl(key),
        };
      }

      return completeResult;
    } catch (error) {
      // Abort multipart upload on error
      await this.abortMultipartUpload(key, uploadId);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // Initiate multipart upload
  private async initiateMultipartUpload(key: string): Promise<string | null> {
    const url = `${this.endpoint}/${this.config.bucket}/${key}?uploads`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": this.generateAuthHeader("POST", key, "uploads="),
          "Content-Type": "application/octet-stream",
        },
      });

      if (response.ok) {
        const text = await response.text();
        // Parse UploadId from XML response
        const match = text.match(/<UploadId>(.+?)<\/UploadId>/);
        return match ? match[1] : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  // Upload part
  private async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer
  ): Promise<{ etag?: string; error?: string }> {
    const query = `partNumber=${partNumber}&uploadId=${uploadId}`;
    const url = `${this.endpoint}/${this.config.bucket}/${key}?${query}`;

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Authorization": this.generateAuthHeader("PUT", key, query, data),
          "Content-Type": "application/octet-stream",
          "Content-Length": data.length.toString(),
          "x-amz-content-sha256": this.hashPayload(data),
        },
        body: data,
      });

      if (response.ok) {
        const etag = response.headers.get("etag");
        if (etag) {
          return { etag: etag.replace(/"/g, "") };
        }
      }

      return { error: `Part ${partNumber} upload failed` };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }

  // Complete multipart upload
  private async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<UploadResult> {
    const query = `uploadId=${uploadId}`;
    const url = `${this.endpoint}/${this.config.bucket}/${key}?${query}`;

    // Build parts XML
    const partsXml = parts
      .map((p) => `  <Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${p.etag}"</ETag></Part>`)
      .join("\n");
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n${partsXml}\n</CompleteMultipartUpload>`;
    const bodyBuffer = Buffer.from(body);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": this.generateAuthHeader("POST", key, query, bodyBuffer),
          "Content-Type": "application/xml",
          "Content-Length": bodyBuffer.length.toString(),
          "x-amz-content-sha256": this.hashPayload(bodyBuffer),
        },
        body: bodyBuffer,
      });

      if (response.ok) {
        return { success: true, key, url: this.getPublicUrl(key) };
      }

      return { success: false, error: `Failed to complete upload: HTTP ${response.status}` };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // Abort multipart upload
  private async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const query = `uploadId=${uploadId}`;
    const url = `${this.endpoint}/${this.config.bucket}/${key}?${query}`;

    try {
      await fetch(url, {
        method: "DELETE",
        headers: {
          "Authorization": this.generateAuthHeader("DELETE", key, query),
        },
      });
    } catch {
      // Ignore abort errors
    }
  }

  // Download file from R2
  async downloadFile(key: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    const url = `${this.endpoint}/${this.config.bucket}/${key}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": this.generateAuthHeader("GET", key, ""),
        },
      });

      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const fs = require("fs");
        fs.writeFileSync(destPath, buffer);
        return { success: true };
      }

      return { success: false, error: `Download failed: HTTP ${response.status}` };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // Delete file from R2
  async deleteFile(key: string): Promise<{ success: boolean; error?: string }> {
    const url = `${this.endpoint}/${this.config.bucket}/${key}`;

    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "Authorization": this.generateAuthHeader("DELETE", key, ""),
        },
      });

      if (response.ok || response.status === 404) {
        return { success: true };
      }

      return { success: false, error: `Delete failed: HTTP ${response.status}` };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // Check if file exists in R2
  async fileExists(key: string): Promise<boolean> {
    const url = `${this.endpoint}/${this.config.bucket}/${key}`;

    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers: {
          "Authorization": this.generateAuthHeader("HEAD", key, ""),
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // Get public URL (if bucket is public or using custom domain)
  getPublicUrl(key: string): string {
    // If using custom domain, replace endpoint
    // For now, return the R2 URL
    return `${this.endpoint}/${this.config.bucket}/${key}`;
  }

  // Generate AWS SigV4 authorization header
  private generateAuthHeader(
    method: string,
    key: string,
    query: string,
    payload?: Buffer
  ): string {
    const crypto = require("crypto");

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    const service = "s3";
    const region = "auto"; // R2 uses "auto" region

    // Canonical request
    const canonicalUri = `/${this.config.bucket}/${key}`;
    const canonicalQuerystring = query;
    const canonicalHeaders = `host:${this.config.accountId}.r2.cloudflarestorage.com\nx-amz-content-sha256:${this.hashPayload(payload || Buffer.alloc(0))}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const payloadHash = this.hashPayload(payload || Buffer.alloc(0));

    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    // String to sign
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${crypto.createHash("sha256").update(canonicalRequest).digest("hex")}`;

    // Calculate signature
    const kDate = this.hmacSha256(dateStamp, `AWS4${this.config.secretAccessKey}`);
    const kRegion = this.hmacSha256(region, kDate);
    const kService = this.hmacSha256(service, kRegion);
    const kSigning = this.hmacSha256("aws4_request", kService);
    const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    // Authorization header
    return `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  private hashPayload(payload: Buffer): string {
    return createHash("sha256").update(payload).digest("hex");
  }

  private hmacSha256(key: string | Buffer, data: string | Buffer): Buffer {
    const crypto = require("crypto");
    return crypto.createHmac("sha256", key).update(data).digest();
  }

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

  private getExtension(filePath: string): string {
    const match = filePath.match(/\.([a-zA-Z0-9]+)$/);
    return match ? match[1] : "bin";
  }
}
```

### Integration with Sync Manager

Update `sync-manager.ts` to include R2 uploads:

```typescript
// Add to sync-manager.ts

private async uploadAsset(assetId: string): Promise<{ success: boolean; error?: string }> {
  const asset = assetsRepo.getById(assetId);
  if (!asset) {
    return { success: false, error: "Asset not found" };
  }

  // Check if already uploaded to R2
  if (asset.cloudR2Key) {
    const exists = await this.r2.fileExists(asset.cloudR2Key);
    if (exists) {
      // Skip upload, just update metadata
      return this.updateAssetMetadata(asset);
    }
  }

  // Upload file to R2
  const uploadResult = await this.r2.uploadFile(
    asset.id,
    asset.filePath,
    asset.type,
    (progress) => {
      // Emit progress event to renderer
      this.emitProgress("upload", progress);
    }
  );

  if (!uploadResult.success) {
    return { success: false, error: uploadResult.error };
  }

  // Store R2 key in metadata
  asset.cloudR2Key = uploadResult.key;

  // Continue with D1 metadata upload...
}
```

## Implementation Steps

1. [ ] Implement `r2-client.ts` with upload/download
2. [ ] Add R2 config to settings
3. [ ] Integrate R2 upload into sync flow
4. [ ] Add progress reporting to UI
5. [ ] Add retry logic for failed uploads
6. [ ] Add download capability for cloud assets
7. [ ] Test with large files (>100MB)

## Success Criteria

- Can upload files to R2
- Multipart upload works for large files
- Progress reporting accurate
- Failed uploads handled gracefully
- Can download files from R2
- Can delete files from R2

## Thumbnail Handling

**Decision:** Thumbnails stored in R2, metadata reference only (`thumbnail_r2_key` column).

```typescript
// After uploading asset file, upload thumbnail
async uploadThumbnail(
  assetId: string,
  thumbnailBuffer: Buffer,
  extension: string = "webp"
): Promise<UploadResult> {
  const key = this.generateThumbnailKey(assetId, extension);
  return this.uploadSimple(key, thumbnailBuffer, thumbnailBuffer.length);
}
```

- Thumbnails generated client-side (Electron main process)
- Uploaded to `assets/{userId}/thumbnails/{assetId}_thumb.webp`
- `thumbnail_r2_key` stored in assets table for fast lookup
- Local thumbnails cached in app data directory

## Security Considerations

- R2 credentials stored securely in electron-store (per-device, same as D1)
- Credentials never exposed to renderer
- Use presigned URLs for direct browser access (future)
- Encrypt sensitive data before upload (optional)

## Unresolved Questions

1. Should we enable public bucket access for sharing?
2. How to handle bandwidth limits and quota exceeded?

## Next Steps

[Phase 06: Sync & Conflict Resolution](./phase-06-sync-conflict.md)
