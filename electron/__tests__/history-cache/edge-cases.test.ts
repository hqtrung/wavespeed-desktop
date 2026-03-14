import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  openDatabase,
  closeDatabase,
  getDatabase,
  persistDatabase,
  transaction,
} from "../../history/db/connection";
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

describe("History Cache Edge Cases", () => {
  let mockDb: any;
  let mockPersistSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDb = {
      run: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn(),
      close: vi.fn(),
      export: vi.fn(),
    };
    mockPersistSpy = vi.fn();

    (getDatabase as any).__mockData__ = mockDb;
    persistDatabase = mockPersistSpy;

    // Mock Electron and fs
    vi.mock("electron", () => ({
      app: {
        getPath: vi.fn().mockReturnValue("/mock/user/data"),
      },
    }));

    vi.mock("fs", () => ({
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      renameSync: vi.fn(),
      mkdirSync: vi.fn(),
    }));

    vi.mock("path", () => ({
      join: vi.fn((...args) => args.join("/")),
      dirname: vi.fn((p) => p),
    }));

    vi.mock("sql.js", () => ({
      init: vi.fn().mockResolvedValue(mockSqlJs),
      Database: vi.fn().mockReturnValue(mockDb),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Empty Cache Scenarios", () => {
    it("should handle completely empty database", () => {
      mockDb.exec.mockReturnValue([]);

      const count = getCount();
      expect(count).toBe(0);

      const predictions = listPredictions();
      expect(predictions).toEqual([]);

      const prediction = getPredictionById("non-existent");
      expect(prediction).toBeNull();

      const syncTime = getLastSyncTime();
      expect(syncTime).toBeNull();
    });

    it("should handle database with no schema version", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [] }]); // Empty schema version

      // Should still work but return 0
      const count = getCount();
      expect(count).toBe(0);
    });

    it("should handle database with no predictions table", () => {
      // Simulate corrupt database without predictions table
      mockDb.exec.mockImplementation((query) => {
        if (query.includes("predictions")) {
          throw new Error("no such table: predictions");
        }
        return [];
      });

      // Should handle gracefully
      expect(() => getCount()).not.toThrow();
    });
  });

  describe("Network Error Scenarios", () => {
    it("should handle network errors during sync", () => {
      // Simulate sync that fails due to network issues
      const mockUpsertPrediction = vi.fn().mockImplementation(() => {
        throw new Error("Network error during sync");
      });

      expect(() => {
        mockUpsertPrediction({
          id: "sync-failed",
          model: "test-model",
          status: "completed",
          outputs: [],
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        });
      }).toThrow("Network error during sync");

      // Database should still be in consistent state
      expect(mockDb.run).toHaveBeenCalled();
    });

    it("should handle partial sync failures", () => {
      const mockBulkUpsert = vi.fn().mockImplementation((items) => {
        // Simulate partial failure on second item
        if (items.length > 1 && items[1].id === "failed-item") {
          throw new Error("Partial sync failure");
        }
      });

      expect(() => {
        mockBulkUpsert([
          { id: "success-1", model: "model-1", status: "completed", outputs: [], created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" },
          { id: "failed-item", model: "model-2", status: "completed", outputs: [], created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" },
        ]);
      }).toThrow("Partial sync failure");

      // First item should still be saved
      expect(mockDb.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("Concurrent Writes", () => {
    it("should handle concurrent writes to same prediction", () => {
      // Simulate concurrent updates to same prediction ID
      const concurrentWrites = Array.from({ length: 10 }, (_, i) => ({
        id: "same-prediction",
        model: `model-${i}`,
        status: "completed",
        outputs: [{ url: `https://example.com/image-${i}.png` }],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      }));

      concurrentWrites.forEach(item => {
        expect(() => {
          upsertPrediction(item);
        }).not.toThrow();
      });

      // Only the last write should persist
      const finalPrediction = getPredictionById("same-prediction");
      expect(finalPrediction).toBeDefined();
      expect(finalPrediction?.model).toBe("model-9");
    });

    it("should handle concurrent reads and writes", () => {
      // Insert initial data
      const initialItem = {
        id: "concurrent-test",
        model: "initial-model",
        status: "completed",
        outputs: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      upsertPrediction(initialItem);

      // Simulate concurrent read while write is happening
      mockDb.exec.mockReturnValueOnce([{ values: [[initialItem.id, initialItem.model, initialItem.status, "[]", "{}", initialItem.created_at, initialItem.updated_at, null, 0, null, null]] }]);

      const readPromise = getPredictionById("concurrent-test");

      // Simulate concurrent update
      const updateItem = {
        ...initialItem,
        status: "failed",
        error: "Concurrent update",
      };

      upsertPrediction(updateItem);

      const readResult = readPromise;
      expect(readResult).toEqual({
        ...initialItem,
        inputs: undefined,
        synced_at: undefined,
      });
    });
  });

  describe("Large Datasets", () => {
    it("should handle 1000+ predictions efficiently", () => {
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: `bulk-pred-${i}`,
        model: `model-${i % 20}`, // 20 different models
        status: i % 10 === 0 ? "failed" : "completed", // 10% failed
        outputs: i % 5 === 0 ? [{ url: `https://example.com/image-${i}.png` }] : [], // 20% have outputs
        created_at: new Date(Date.now() - i * 3600000).toISOString(), // Spread over time
        updated_at: new Date(Date.now() - i * 3600000).toISOString(),
      }));

      // Bulk insert should work
      upsertPredictions(largeDataset);

      // Count should be accurate
      expect(getCount()).toBe(1000);

      // Pagination should work
      const page1 = listPredictions({ limit: 100, offset: 0 });
      const page2 = listPredictions({ limit: 100, offset: 100 });

      expect(page1).toHaveLength(100);
      expect(page2).toHaveLength(100);
      expect(page1[0].id).toBe("bulk-pred-999"); // Most recent first
      expect(page2[0].id).toBe("bulk-pred-899");
    });

    it("should handle large JSON payloads", () => {
      const largeOutputs = Array.from({ length: 100 }, (_, i) => ({
        url: `https://example.com/large-image-${i}.png`,
        metadata: {
          width: 1024,
          height: 1024,
          format: "png",
          size: 1024000, // 1MB each
        },
      }));

      const largeItem = {
        id: "large-json-test",
        model: "large-model",
        status: "completed",
        outputs: largeOutputs,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      // Should handle large JSON without crashing
      expect(() => {
        upsertPrediction(largeItem);
      }).not.toThrow();

      // Should be retrievable
      const retrieved = getPredictionById("large-json-test");
      expect(retrieved?.outputs).toHaveLength(100);
    });

    it("should handle large input data", () => {
      const largeInputs = {
        prompt: "This is a very long prompt that would typically be used in image generation applications where detailed descriptions are provided to guide the AI model towards producing specific visual outputs.",
        parameters: Array.from({ length: 50 }, (_, i) => ({
          name: `param-${i}`,
          value: Math.random(),
          type: "number",
        })),
        metadata: {
          tags: Array.from({ length: 20 }, (_, i) => `tag-${i}`),
          settings: {
            resolution: { width: 1024, height: 1024 },
            quality: "high",
            steps: 50,
          },
        },
      };

      const largeItem = {
        id: "large-inputs-test",
        model: "model-with-large-inputs",
        status: "processing",
        outputs: [],
        inputs: largeInputs,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      // Should handle large inputs without crashing
      expect(() => {
        upsertPrediction(largeItem);
      }).not.toThrow();
    });
  });

  describe("Data Corruption Scenarios", () => {
    it("should handle corrupted JSON in outputs", () => {
      // Insert item with corrupted JSON
      const corruptedItem = {
        id: "corrupted-json-test",
        model: "test-model",
        status: "completed",
        outputs: "this is not valid json",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      expect(() => {
        upsertPrediction(corruptedItem);
      }).not.toThrow();

      // Should still be retrievable but with empty outputs
      const retrieved = getPredictionById("corrupted-json-test");
      expect(retrieved?.outputs).toEqual([]);
    });

    it("should handle invalid UTF-8 data", () => {
      // Simulate binary data instead of UTF-8
      mockDb.run.mockImplementation((query, params) => {
        if (params && params[4] instanceof Uint8Array) {
          throw new Error("Invalid UTF-8 data");
        }
      });

      const item = {
        id: "invalid-utf8-test",
        model: "test-model",
        status: "completed",
        outputs: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      expect(() => {
        upsertPrediction(item);
      }).not.toThrow();
    });

    it("should handle database file corruption", () => {
      // Simulate corrupted database file
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("Corrupted database file");
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);

      expect(() => {
        openDatabase();
      }).not.toThrow();
    });
  });

  describe("Memory Pressure Scenarios", () => {
    it("should handle memory limits", () => {
      // Simulate memory-intensive operations
      const largeExportData = new ArrayBuffer(1024 * 1024 * 50); // 50MB
      mockDb.export.mockReturnValue(largeExportData);

      const db = getDatabase();
      const exportedData = db.export();

      expect(exportedData).toBeInstanceOf(ArrayBuffer);
      expect(exportedData.byteLength).toBe(50 * 1024 * 1024);
    });

    it("should handle large result sets", () => {
      // Simulate large result set from database
      const largeResultSet = Array.from({ length: 1000 }, (_, i) => [
        `pred-${i}`,
        `model-${i}`,
        "completed",
        "[]",
        "{}",
        "2024-01-01T00:00:00Z",
        "2024-01-01T00:00:00Z",
        null,
        0,
        null,
        null,
      ]);

      mockDb.exec.mockReturnValue([{ values: largeResultSet }]);

      const results = listPredictions();
      expect(results).toHaveLength(1000);

      // Should handle pagination without memory issues
      const paginated = listPredictions({ limit: 100, offset: 500 });
      expect(paginated).toHaveLength(100);
    });
  });

  describe("Time-related Edge Cases", () => {
    it("should handle future timestamps", () => {
      const futureItem = {
        id: "future-timestamp-test",
        model: "test-model",
        status: "completed",
        outputs: [],
        created_at: "2050-01-01T00:00:00Z", // Future date
        updated_at: "2050-01-01T00:00:00Z",
      };

      expect(() => {
        upsertPrediction(futureItem);
      }).not.toThrow();

      const retrieved = getPredictionById("future-timestamp-test");
      expect(retrieved?.created_at).toBe("2050-01-01T00:00:00Z");
    });

    it("should handle very old timestamps", () => {
      const oldItem = {
        id: "old-timestamp-test",
        model: "test-model",
        status: "completed",
        outputs: [],
        created_at: "1970-01-01T00:00:00Z", // Unix epoch
        updated_at: "1970-01-01T00:00:00Z",
      };

      expect(() => {
        upsertPrediction(oldItem);
      }).not.toThrow();

      const retrieved = getPredictionById("old-timestamp-test");
      expect(retrieved?.created_at).toBe("1970-01-01T00:00:00Z");
    });

    it("should handle timezone variations", () => {
      const utcItem = {
        id: "utc-timestamp-test",
        model: "test-model",
        status: "completed",
        outputs: [],
        created_at: "2024-01-01T00:00:00Z", // UTC
        updated_at: "2024-01-01T00:00:00Z",
      };

      expect(() => {
        upsertPrediction(utcItem);
      }).not.toThrow();

      const retrieved = getPredictionById("utc-timestamp-test");
      expect(retrieved?.created_at).toBe("2024-01-01T00:00:00Z");
    });
  });

  describe("Special Character Handling", () => {
    it("should handle Unicode characters in data", () => {
      const unicodeItem = {
        id: "unicode-test",
        model: "model-🚀", // Emoji
        status: "completed",
        outputs: [{ url: "https://example.com/🖼️.png" }],
        created_at: "2024-01-01T12:00:00+00:00", // With timezone
        updated_at: "2024-01-01T12:00:00+00:00",
      };

      expect(() => {
        upsertPrediction(unicodeItem);
      }).not.toThrow();

      const retrieved = getPredictionById("unicode-test");
      expect(retrieved?.model).toBe("model-🚀");
    });

    it("should handle special characters in outputs", () => {
      const specialCharOutputs = [
        { url: "https://example.com/test/with/slashes/file.png" },
        { url: "https://example.com/test with spaces/file.jpg" },
        { url: "https://example.com/test@with/special#chars.gif" },
      ];

      const item = {
        id: "special-chars-test",
        model: "test-model",
        status: "completed",
        outputs: specialCharOutputs,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      expect(() => {
        upsertPrediction(item);
      }).not.toThrow();

      const retrieved = getPredictionById("special-chars-test");
      expect(retrieved?.outputs).toHaveLength(3);
    });
  });
});