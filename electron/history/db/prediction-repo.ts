/**
 * Prediction repository for history cache CRUD operations.
 */

import type { Database } from "sql.js";
import type { HistoryItem, CachedPrediction } from "@/types/history-cache";
import { getDatabase, persistDatabase } from "./connection";

export function upsertPrediction(
  item: HistoryItem & {
    inputs?: Record<string, unknown>;
    input_details?: Record<string, unknown>;
    reference_images?: Array<{ url: string; localPath: string }>;
  },
): void {
  const db = getDatabase();
  const outputsJson = JSON.stringify(item.outputs ?? []);
  const inputsJson = JSON.stringify(item.inputs ?? {});
  const inputDetailsJson = item.input_details
    ? JSON.stringify(item.input_details)
    : null;
  const referenceImagesJson = item.reference_images
    ? JSON.stringify(item.reference_images)
    : null;

  db.run(
    `INSERT OR REPLACE INTO predictions (
      id, model_id, status, outputs, inputs, input_details, reference_images,
      created_at, updated_at, execution_time, has_nsfw_contents, error, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.model,
      item.status,
      outputsJson,
      inputsJson,
      inputDetailsJson,
      referenceImagesJson,
      item.created_at,
      item.updated_at || item.created_at,
      item.execution_time ?? null,
      item.has_nsfw_contents ? 1 : 0,
      item.error ?? null,
      null, // synced_at - set by sync operations
    ],
  );
  persistDatabase();
}

export function upsertPredictions(items: HistoryItem[]): void {
  const db = getDatabase();

  for (const item of items) {
    // Check if prediction already exists with inputs/input_details/reference_images
    const existing = db.exec(
      "SELECT inputs, input_details, reference_images FROM predictions WHERE id = ?",
      [item.id],
    );

    // Use existing values if available, otherwise defaults
    let inputsJson = "{}";
    let inputDetailsJson: string | null = null;
    let referenceImagesJson: string | null = null;

    if (existing.length > 0 && existing[0].values.length > 0) {
      const row = existing[0].values[0] as unknown[];
      if (row[0]) inputsJson = row[0] as string;
      if (row[1]) inputDetailsJson = row[1] as string;
      if (row[2]) referenceImagesJson = row[2] as string;
    }

    db.run(
      `INSERT OR REPLACE INTO predictions (
        id, model_id, status, outputs, inputs, input_details, reference_images,
        created_at, updated_at, execution_time, has_nsfw_contents, error, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.model,
        item.status,
        JSON.stringify(item.outputs ?? []),
        inputsJson, // preserve existing inputs
        inputDetailsJson, // preserve existing input_details
        referenceImagesJson, // preserve existing reference_images
        item.created_at,
        item.updated_at || item.created_at,
        item.execution_time ?? null,
        item.has_nsfw_contents ? 1 : 0,
        item.error ?? null,
        new Date().toISOString(), // marked as synced
      ],
    );
  }
  persistDatabase();
}

export function getPredictionById(id: string): CachedPrediction | null {
  const db = getDatabase();
  const result = db.exec("SELECT * FROM predictions WHERE id = ?", [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return rowToPrediction(result[0].values[0] as unknown[]);
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  status?: string;
}

export function listPredictions(options: ListOptions = {}): CachedPrediction[] {
  const db = getDatabase();
  const { limit = 50, offset = 0, status } = options;

  let sql = "SELECT * FROM predictions";
  const params: unknown[] = [];

  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const result = db.exec(sql, params);
  if (result.length === 0) return [];

  return result[0].values.map((row) => rowToPrediction(row as unknown[]));
}

export function deletePrediction(id: string): void {
  const db = getDatabase();
  db.run("DELETE FROM predictions WHERE id = ?", [id]);
  persistDatabase();
}

export function getCount(): number {
  const db = getDatabase();
  const result = db.exec("SELECT COUNT(*) as count FROM predictions");
  return result[0]?.values?.[0]?.[0] as number ?? 0;
}

export function getLastSyncTime(): string | null {
  const db = getDatabase();
  const result = db.exec(
    "SELECT MAX(synced_at) as last_sync FROM predictions WHERE synced_at IS NOT NULL",
  );
  return result[0]?.values?.[0]?.[0] as string ?? null;
}

export interface ReferenceImage {
  url: string;
  localPath: string;
}

export function updatePredictionInputDetails(
  id: string,
  inputDetails: Record<string, unknown>,
  referenceImages: ReferenceImage[],
): void {
  const db = getDatabase();
  db.run(
    `UPDATE predictions SET input_details = ?, reference_images = ? WHERE id = ?`,
    [
      JSON.stringify(inputDetails),
      JSON.stringify(referenceImages),
      id,
    ],
  );
  persistDatabase();
}

function rowToPrediction(row: unknown[]): CachedPrediction {
  // Handle both old schema (11 cols) and new schema (13 cols)
  const [
    id,
    model_id,
    status,
    outputsJson,
    inputsJson,
    created_at,
    updated_at,
    execution_time,
    has_nsfw_contents,
    error,
    synced_at,
    // New columns (may be undefined for old rows)
    inputDetailsJson,
    referenceImagesJson,
  ] = row;

  // Safe JSON parsing with fallback
  const parseJson = (json: unknown) => {
    if (!json) return undefined;
    try {
      return JSON.parse(json as string);
    } catch {
      return undefined;
    }
  };

  return {
    id: id as string,
    model: model_id as string,
    status:
      status as "pending" | "processing" | "completed" | "failed" | "created",
    outputs: parseJson(outputsJson) ?? [],
    inputs: parseJson(inputsJson),
    input_details: parseJson(inputDetailsJson),
    reference_images: parseJson(referenceImagesJson),
    created_at: created_at as string,
    updated_at: updated_at as string,
    execution_time: execution_time as number | undefined,
    has_nsfw_contents:
      (has_nsfw_contents as number) === 1 ? [true] : undefined,
    error: error as string | undefined,
    synced_at: synced_at as string | undefined,
  };
}
