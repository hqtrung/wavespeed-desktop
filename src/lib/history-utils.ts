/**
 * Utility functions for converting prediction results to history items.
 */
import type { PredictionResult, HistoryItem } from "@/types/prediction";

export function predictionResultToHistoryItem(
  result: PredictionResult,
  formValues?: Record<string, unknown>,
): HistoryItem & { inputs?: Record<string, unknown> } {
  return {
    id: result.id,
    model: result.model,
    status: result.status,
    outputs: result.outputs,
    created_at: result.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    execution_time: result.timings?.inference,
    has_nsfw_contents: result.has_nsfw_contents,
    error: result.error,
    inputs: formValues,
  };
}

export function isPredictionComplete(result: PredictionResult): boolean {
  return result.status === "completed" || result.status === "failed";
}
