/**
 * Cloudflare D1 client for asset metadata synchronization.
 * Uses D1 REST API with per-device API token authentication.
 */

interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

interface D1QueryResult<T = unknown> {
  success: boolean;
  error?: string;
  results?: T[];
  meta?: {
    duration: number;
    rowsRead: number;
    rowsWritten: number;
  };
}

interface D1ErrorResponse {
  success: false;
  errors: Array<{ message: string; code: number }>;
}

export class D1Client {
  private config: D1Config;
  private baseUrl: string;

  constructor(config: D1Config) {
    this.config = config;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}`;
  }

  /**
   * Execute a single SQL query via D1 REST API.
   */
  async query<T = unknown>(
    sql: string,
    params: unknown[] = []
  ): Promise<D1QueryResult<T>> {
    try {
      const response = await fetch(`${this.baseUrl}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = (await response.json()) as D1ErrorResponse | { success: true; result: Array<{ meta: any; results: T[] }> };

      if (!data.success) {
        return {
          success: false,
          error: (data as D1ErrorResponse).errors?.[0]?.message || "D1 query failed",
        };
      }

      const result = (data as { success: true; result: Array<{ meta: any; results: T[] }> }).result?.[0];

      return {
        success: true,
        results: result?.results || [],
        meta: {
          duration: result?.meta?.duration || 0,
          rowsRead: result?.meta?.rows_read || 0,
          rowsWritten: result?.meta?.rows_written || 0,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Execute multiple queries sequentially (D1 doesn't support true batching via REST).
   * For production, consider using a Worker with D1 binding for true transactions.
   */
  async batch(queries: Array<{ sql: string; params?: unknown[] }>): Promise<D1QueryResult[]> {
    const results: D1QueryResult[] = [];

    for (const queryItem of queries) {
      const result = await this.query(queryItem.sql, queryItem.params || []);
      results.push(result);
      if (!result.success) break;
    }

    return results;
  }

  /**
   * Check connection to D1.
   */
  async ping(): Promise<boolean> {
    const result = await this.query("SELECT 1 as ping");
    return result.success && (result.results?.[0] as any)?.ping === 1;
  }

  /**
   * Get the current schema version from D1.
   */
  async getSchemaVersion(): Promise<number> {
    const result = await this.query<{ version: number }>(
      "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
    );
    return result.results?.[0]?.version || 0;
  }

  /**
   * Initialize remote D1 schema from SQL statements.
   */
  async initializeSchema(schemaSql: string): Promise<{ success: boolean; error?: string }> {
    const statements = schemaSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      const result = await this.query(statement);
      if (!result.success) {
        console.error("[D1] Failed to execute:", statement, result.error);
        return { success: false, error: result.error };
      }
    }

    return { success: true };
  }

  /**
   * Fetch remote changes since a given timestamp.
   */
  async fetchChanges(since: string): Promise<{
    success: boolean;
    assets: any[];
    folders: any[];
    tagCategories: any[];
    error?: string;
  }> {
    const assetsResult = await this.query(
      `SELECT * FROM assets WHERE updated_at > ? AND sync_status != 'deleted' ORDER BY updated_at ASC`,
      [since]
    );

    if (!assetsResult.success) {
      return { success: false, assets: [], folders: [], tagCategories: [], error: assetsResult.error };
    }

    const foldersResult = await this.query(
      `SELECT * FROM folders WHERE updated_at > ? AND sync_status != 'deleted'`,
      [since]
    );

    const categoriesResult = await this.query(
      `SELECT * FROM tag_categories WHERE updated_at > ? AND sync_status != 'deleted'`,
      [since]
    );

    return {
      success: true,
      assets: assetsResult.results || [],
      folders: foldersResult.results || [],
      tagCategories: categoriesResult.results || [],
    };
  }

  /**
   * Upload a single asset record to D1.
   */
  async uploadAsset(asset: any): Promise<{ success: boolean; error?: string }> {
    const result = await this.query(
      `INSERT OR REPLACE INTO assets (
        id, file_path, file_name, type, model_id, created_at, updated_at,
        file_size, favorite, prediction_id, result_index, original_url,
        source, workflow_id, workflow_name, node_id, execution_id,
        folder_id, tags, device_id, sync_status, synced_at, version, cloud_r2_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?)`,
      [
        asset.id,
        asset.filePath,
        asset.fileName,
        asset.type,
        asset.modelId,
        asset.createdAt,
        new Date().toISOString(),
        asset.fileSize,
        asset.favorite ? 1 : 0,
        asset.predictionId ?? null,
        asset.resultIndex ?? 0,
        asset.originalUrl ?? null,
        asset.source ?? null,
        asset.workflowId ?? null,
        asset.workflowName ?? null,
        asset.nodeId ?? null,
        asset.executionId ?? null,
        asset.folderId ?? null,
        JSON.stringify(asset.tags || []),
        asset.deviceId || "",
        new Date().toISOString(),
        asset.version || 1,
        asset.cloudR2Key ?? null,
      ]
    );

    return result;
  }

  /**
   * Upload a folder record to D1.
   */
  async uploadFolder(folder: any): Promise<{ success: boolean; error?: string }> {
    const result = await this.query(
      `INSERT OR REPLACE INTO folders (id, name, color, icon, created_at, updated_at, device_id, sync_status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?)`,
      [folder.id, folder.name, folder.color, folder.icon ?? null, folder.createdAt, folder.createdAt, folder.deviceId || "", folder.version || 1]
    );

    return result;
  }

  /**
   * Upload a tag category record to D1.
   */
  async uploadTagCategory(category: any): Promise<{ success: boolean; error?: string }> {
    const result = await this.query(
      `INSERT OR REPLACE INTO tag_categories (id, name, color, tags, created_at, updated_at, device_id, sync_status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?)`,
      [
        category.id,
        category.name,
        category.color,
        JSON.stringify(category.tags || []),
        category.createdAt,
        category.createdAt,
        category.deviceId || "",
        category.version || 1,
      ]
    );

    return result;
  }

  /**
   * Delete a record from D1 by table and ID.
   */
  async deleteRecord(table: string, id: string): Promise<{ success: boolean; error?: string }> {
    const validTables = ["assets", "folders", "tag_categories"];
    if (!validTables.includes(table)) {
      return { success: false, error: `Invalid table: ${table}` };
    }

    const result = await this.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
    return result;
  }

  /**
   * Mark a record as deleted in D1 (tombstone pattern).
   */
  async markDeleted(table: string, id: string, deviceId: string): Promise<{ success: boolean; error?: string }> {
    const validTables = ["assets", "folders", "tag_categories"];
    if (!validTables.includes(table)) {
      return { success: false, error: `Invalid table: ${table}` };
    }

    // Set sync_status to 'deleted' instead of actually deleting
    const result = await this.query(
      `UPDATE ${table} SET sync_status = 'deleted', updated_at = ?, device_id = ? WHERE id = ?`,
      [new Date().toISOString(), deviceId, id]
    );

    return result;
  }

  /**
   * Get the base URL for this D1 client.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get R2 configuration from D1.
   */
  async getR2Config(): Promise<{
    success: boolean;
    config?: { bucket: string | null; accessKeyId: string | null; secretAccessKey: string | null; publicUrl: string | null };
    error?: string;
  }> {
    const result = await this.query<{ key: string; value: string }>("SELECT key, value FROM r2_config");
    if (!result.success) {
      return { success: false, error: result.error };
    }

    const config: Record<string, string> = {};
    for (const row of result.results || []) {
      config[row.key] = row.value;
    }

    return {
      success: true,
      config: {
        bucket: config["bucket"] ?? null,
        accessKeyId: config["accessKeyId"] ?? null,
        secretAccessKey: config["secretAccessKey"] ?? null,
        publicUrl: config["publicUrl"] ?? null,
      },
    };
  }

  /**
   * Set R2 configuration in D1.
   */
  async setR2Config(config: {
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicUrl?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const entries = Object.entries(config).filter(([_, value]) => value !== undefined);

    for (const [key, value] of entries) {
      const result = await this.query(
        `INSERT INTO r2_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [key, value as string]
      );
      if (!result.success) {
        return { success: false, error: result.error };
      }
    }

    return { success: true };
  }
}
