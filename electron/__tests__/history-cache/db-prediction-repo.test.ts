import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  upsertPrediction,
  upsertPredictions,
  getPredictionById,
  listPredictions,
  deletePrediction,
  getCount,
  getLastSyncTime,
} from "../../history/db/prediction-repo";
import type { HistoryItem, CachedPrediction } from "@/types/history-cache";

// Mock dependencies
vi.mock("../../history/db/connection");
const { getDatabase, persistDatabase } = await import("../../history/db/connection");

describe("Prediction Repository", () => {
  let mockDb: any;
  let mockPersistSpy: any;

  beforeEach(() => {
    mockDb = {
      run: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn(),
    };
    mockPersistSpy = vi.fn();

    (getDatabase as any).__mockData__ = mockDb;
    persistDatabase = mockPersistSpy;

    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockHistoryItem: HistoryItem = {
    id: "test-prediction-1",
    model: "test-model",
    status: "completed",
    outputs: [{ url: "https://example.com/image.png" }],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    execution_time: 5000,
    has_nsfw_contents: [true],
    error: null,
  };

  describe("upsertPrediction", () => {
    it("should insert new prediction", () => {
      upsertPrediction(mockHistoryItem);

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO predictions"),
        [
          "test-prediction-1",
          "test-model",
          "completed",
          JSON.stringify([{ url: "https://example.com/image.png" }]),
          "{}",
          "2024-01-01T00:00:00Z",
          "2024-01-01T00:00:00Z",
          5000,
          1,
          null,
          null,
        ]
      );
      expect(mockPersistSpy).toHaveBeenCalled();
    });

    it("should update existing prediction", () => {
      const updatedItem = {
        ...mockHistoryItem,
        status: "failed",
        error: "Model timeout",
        inputs: { prompt: "test prompt" },
      };

      upsertPrediction(updatedItem);

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO predictions"),
        [
          "test-prediction-1",
          "test-model",
          "failed",
          JSON.stringify([{ url: "https://example.com/image.png" }]),
          JSON.stringify({ prompt: "test prompt" }),
          "2024-01-01T00:00:00Z",
          "2024-01-01T00:00:00Z",
          5000,
          1,
          "Model timeout",
          null,
        ]
      );
    });

    it("should handle prediction without outputs", () => {
      const itemWithoutOutputs = {
        ...mockHistoryItem,
        outputs: [],
      };

      upsertPrediction(itemWithoutOutputs);

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO predictions"),
        expect.arrayContaining([JSON.stringify([])])
      );
    });

    it("should handle prediction with null values", () => {
      const itemWithNulls = {
        ...mockHistoryItem,
        execution_time: null,
        error: null,
      };

      upsertPrediction(itemWithNulls);

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO predictions"),
        expect.arrayContaining([null, null])
      );
    });
  });

  describe("upsertPredictions", () => {
    it("should bulk insert multiple predictions", () => {
      const bulkItems = [
        { ...mockHistoryItem, id: "pred-1" },
        { ...mockHistoryItem, id: "pred-2", status: "failed" },
        { ...mockHistoryItem, id: "pred-3" },
      ];

      upsertPredictions(bulkItems);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO predictions")
      );

      // Verify all items were processed
      const stmt = mockDb.prepare();
      expect(stmt.run).toHaveBeenCalledTimes(3);
      expect(mockPersistSpy).toHaveBeenCalled();
    });

    it("should mark bulk items as synced", () => {
      const bulkItems = [
        { ...mockHistoryItem, id: "pred-1" },
        { ...mockHistoryItem, id: "pred-2" },
      ];

      upsertPredictions(bulkItems);

      // Check that synced_at is set for bulk operations
      expect(mockDb.prepare().run).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(String)]) // synced_at should be current time
      );
    });
  });

  describe("getPredictionById", () => {
    it("should return prediction when found", () => {
      const mockRow = [
        "test-prediction-1",
        "test-model",
        "completed",
        JSON.stringify([{ url: "https://example.com/image.png" }]),
        JSON.stringify({ prompt: "test" }),
        "2024-01-01T00:00:00Z",
        "2024-01-01T00:00:00Z",
        5000,
        1,
        null,
        "2024-01-01T00:00:00Z",
      ];

      mockDb.exec.mockReturnValueOnce([{ values: [mockRow] }]);

      const result = getPredictionById("test-prediction-1");

      expect(result).toEqual({
        id: "test-prediction-1",
        model: "test-model",
        status: "completed",
        outputs: [{ url: "https://example.com/image.png" }],
        inputs: { prompt: "test" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        execution_time: 5000,
        has_nsfw_contents: [true],
        error: null,
        synced_at: "2024-01-01T00:00:00Z",
      });
    });

    it("should return null when not found", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [] }]);

      const result = getPredictionById("non-existent-id");

      expect(result).toBeNull();
    });

    it("should handle null outputs JSON", () => {
      const mockRow = [
        "test-prediction-1",
        "test-model",
        "completed",
        null,
        JSON.stringify({ prompt: "test" }),
        "2024-01-01T00:00:00Z",
        "2024-01-01T00:00:00Z",
        null,
        0,
        null,
        null,
      ];

      mockDb.exec.mockReturnValueOnce([{ values: [mockRow] }]);

      const result = getPredictionById("test-prediction-1");

      expect(result).toEqual({
        id: "test-prediction-1",
        model: "test-model",
        status: "completed",
        outputs: [],
        inputs: { prompt: "test" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        execution_time: undefined,
        has_nsfw_contents: undefined,
        error: undefined,
        synced_at: undefined,
      });
    });
  });

  describe("listPredictions", () => {
    it("should list predictions with default options", () => {
      const mockRows = [
        [
          "pred-1", "model-1", "completed", "[]", "{}", "2024-01-02T00:00:00Z",
          "2024-01-02T00:00:00Z", null, 0, null, null
        ],
        [
          "pred-2", "model-2", "failed", "[]", "{}", "2024-01-01T00:00:00Z",
          "2024-01-01T00:00:00Z", null, 0, null, null
        ],
      ];

      mockDb.exec.mockReturnValueOnce([{ values: mockRows }]);

      const result = listPredictions();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("pred-1"); // Most recent first
      expect(result[1].id).toBe("pred-2");
      expect(mockDb.exec).toHaveBeenCalledWith(
        "SELECT * FROM predictions ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [50, 0]
      );
    });

    it("should list predictions with status filter", () => {
      const mockRow = [
        "pred-1", "model-1", "completed", "[]", "{}", "2024-01-01T00:00:00Z",
        "2024-01-01T00:00:00Z", null, 0, null, null
      ];

      mockDb.exec.mockReturnValueOnce([{ values: [mockRow] }]);

      const result = listPredictions({ status: "completed" });

      expect(result).toHaveLength(1);
      expect(mockDb.exec).toHaveBeenCalledWith(
        "SELECT * FROM predictions WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        ["completed", 50, 0]
      );
    });

    it("should list predictions with pagination", () => {
      const mockRow = [
        "pred-1", "model-1", "completed", "[]", "{}", "2024-01-01T00:00:00Z",
        "2024-01-01T00:00:00Z", null, 0, null, null
      ];

      mockDb.exec.mockReturnValueOnce([{ values: [mockRow] }]);

      const result = listPredictions({ limit: 10, offset: 5 });

      expect(result).toHaveLength(1);
      expect(mockDb.exec).toHaveBeenCalledWith(
        "SELECT * FROM predictions ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [10, 5]
      );
    });

    it("should return empty array when no predictions found", () => {
      mockDb.exec.mockReturnValueOnce([]);

      const result = listPredictions();

      expect(result).toEqual([]);
    });
  });

  describe("deletePrediction", () => {
    it("should delete prediction by id", () => {
      deletePrediction("test-prediction-1");

      expect(mockDb.run).toHaveBeenCalledWith(
        "DELETE FROM predictions WHERE id = ?",
        ["test-prediction-1"]
      );
      expect(mockPersistSpy).toHaveBeenCalled();
    });
  });

  describe("getCount", () => {
    it("should return total count", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [["42"]] }]);

      const count = getCount();

      expect(count).toBe(42);
    });

    it("should handle empty database", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [] }]);

      const count = getCount();

      expect(count).toBe(0);
    });
  });

  describe("getLastSyncTime", () => {
    it("should return last sync time", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [["2024-01-01T12:00:00Z"]] }]);

      const syncTime = getLastSyncTime();

      expect(syncTime).toBe("2024-01-01T12:00:00Z");
    });

    it("should return null when no synced predictions", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [[null]] }]);

      const syncTime = getLastSyncTime();

      expect(syncTime).toBeNull();
    });

    it("should return null when no predictions at all", () => {
      mockDb.exec.mockReturnValueOnce([]);

      const syncTime = getLastSyncTime();

      expect(syncTime).toBeNull();
    });
  });
});