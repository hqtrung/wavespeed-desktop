/**
 * Web API client for /center/* endpoints that require cookie authentication.
 * Uses IPC to main process because browser blocks Cookie header in XHR/fetch.
 */

const BASE_URL = "https://wavespeed.ai";

export interface WebPredictionDetail {
  id: number;
  uuid: string;
  order_id: number;
  model_id: number;
  model_uuid: string;
  user_id: number;
  org_id: number;
  source: string;
  version: string;
  payload: string; // JSON string with full inputs including prompt
  result: string;
  inputs: string; // JSON string with inputs
  outputs: string; // JSON string with outputs
  origin_id: string;
  origin_inputs: string;
  origin_outputs: string;
  status: "completed" | "failed" | "processing" | "pending" | "created";
  created_at: string;
  updated_at: string;
  score: number;
  webhook: string;
  archived: number;
  channel: string;
  extra: {
    runpod_endpoint_id: string;
    datacrunch_endpoint_id: string;
    runpod_job_duration: number | null;
    platform_id: number;
    model_mapping_id: number;
    hyper3d_subscription_key: string;
  };
}

export interface WebPredictionResponse {
  code: number;
  message: string;
  data: WebPredictionDetail;
}

// Check if we're in Electron environment
function isElectron(): boolean {
  return typeof window !== "undefined" && typeof window.electronAPI === "object";
}

class WaveSpeedWebClient {
  private token: string | null = null;

  /** Set the web auth token (from cookie) */
  setToken(token: string) {
    this.token = token;
  }

  /** Clear the auth token */
  clearToken() {
    this.token = null;
  }

  /** Make an authenticated request through main process */
  private async request(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: unknown,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (!this.token) {
      throw new Error("Web auth token not set. Please sign in first.");
    }

    if (!isElectron()) {
      throw new Error("Electron API not available. This feature only works in the desktop app.");
    }

    return window.electronAPI.webAuthRequest(this.token, endpoint, method, body);
  }

  /**
   * Get prediction detail with full prompt from /center/ endpoint.
   * Tries direct UUID lookup first, then adjacent endpoint as fallback.
   */
  async getPredictionDetail(uuid: string): Promise<WebPredictionDetail> {
    // Primary: Direct GET by UUID (standard REST pattern)
    const response = await this.request(`/center/default/api/v1/predictions/${uuid}`, "GET");

    if (response.success && response.data) {
      const data = (response.data as WebPredictionResponse).data;
      if (data?.uuid === uuid) {
        return data;
      }
    }

    // If direct lookup fails, throw with clear error message
    // The adjacent endpoint is for navigation, not for fetching specific predictions
    const errorMsg = response.error || "Failed to fetch prediction detail";
    throw new Error(`${errorMsg} for ${uuid}`);
  }
}

export const webClient = new WaveSpeedWebClient();

export default webClient;
