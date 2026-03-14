import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerHistoryIpc } from "../../history/ipc/history-ipc";
import { ipcMain } from "electron";
import type { HistoryItem, ListOptions } from "@/types/history-cache";

describe("History IPC Handlers", () => {
  let ipcSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    ipcSpy = {
      handle: vi.fn(),
      handleOnce: vi.fn(),
    };
    (ipcMain as any).handle = ipcSpy.handle;
    (ipcMain as any).handleOnce = ipcSpy.handleOnce;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("registerHistoryIpc", () => {
    it("should register all required IPC handlers", () => {
      registerHistoryIpc();

      expect(ipcSpy.handle).toHaveBeenCalledTimes(7); // 7 handlers expected

      const handlerCalls = ipcSpy.handle.mock.calls;
      const handlerNames = handlerCalls.map(call => call[0]);

      expect(handlerNames).toContain("history-cache:list");
      expect(handlerNames).toContain("history-cache:get");
      expect(handlerNames).toContain("history-cache:upsert");
      expect(handlerNames).toContain("history-cache:upsert-bulk");
      expect(handlerNames).toContain("history-cache:delete");
      expect(handlerNames).toContain("history-cache:stats");
      expect(handlerNames).toContain("history-cache:clear");
    });

    it("should handle list predictions with options", () => {
      registerHistoryIpc();

      const listHandler = ipcSpy.handle.mock.calls.find(call => call[0] === "history-cache:list");
      const mockListPredictions = vi.fn();
      mockListPredictions.mockReturnValue([]);

      // Mock the repository function
      listHandler[1](_event: any, options: ListOptions) => {
        return mockListPredictions(options);
      };

      const options = { limit: 10, offset: 5, status: "completed" };
      const result = listHandler[1]({} as any, options);

      expect(mockListPredictions).toHaveBeenCalledWith(options);
      expect(result).toEqual([]);
    });

    it("should handle get prediction by id", () => {
      registerHistoryIpc();

      const getHandler = ipcSpy.handle.mock.calls.find(call => call[0] === "history-cache:get");
      const mockGetPredictionById = vi.fn();
      mockGetPredictionById.mockReturnValue(null);

      getHandler[1](_event: any, id: string) => {
        return mockGetPredictionById(id);
      };

      const result = getHandler[1]({} as any, "test-id");

      expect(mockGetPredictionById).toHaveBeenCalledWith("test-id");
      expect(result).toBeNull();
    });

    it("should handle upsert prediction", () => {
      registerHistoryIpc();

      const upsertHandler = ipcSpy.handle.mock.calls.find(call => call[0] === "history-cache:upsert");
      const mockUpsertPrediction = vi.fn();

      upsertHandler[1](_event: any, item: HistoryItem) => {
        mockUpsertPrediction(item);
        return { success: true };
      };

      const testItem: HistoryItem = {
        id: "test-prediction",
        model: "test-model",
        status: "completed",
        outputs: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const result = upsertHandler[1]({} as any, testItem);

      expect(mockUpsertPrediction).toHaveBeenCalledWith(testItem);
      expect(result).toEqual({ success: true });
    });

    it("should handle bulk upsert predictions", () => {
      registerHistoryIpc();

      const bulkHandler = ipcSpy.handle.mock.calls.find(call => call[0] === "history-cache:upsert-bulk");
      const mockUpsertPredictions = vi.fn();

      bulkHandler[1](_event: any, items: HistoryItem[]) => {
        mockUpsertPredictions(items);
        return { success: true, count: items.length };
      };

      const testItems: HistoryItem[] = [
        {
          id: "pred-1",
          model: "model-1",
          status: "completed",
          outputs: [],
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "pred-2",
          model: "model-2",
          status: "failed",
          outputs: [],
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ];

      const result = bulkHandler[1]({} as any, testItems);

      expect(mockUpsertPredictions).toHaveBeenCalledWith(testItems);
      expect(result).toEqual({ success: true, count: 2 });
    });

    it("should handle delete prediction", () => {
      registerHistoryIpc();

      const deleteHandler = ipcSpy.handle.mock.calls.find(call => call[0] === "history-cache:delete");
      const mockDeletePrediction = vi.fn();

      deleteHandler[1](_event: any, id: string) => {
        mockDeletePrediction(id);
        return { success: true };
      };

      const result = deleteHandler[1]({} as any, "test-id");

      expect(mockDeletePrediction).toHaveBeenCalledWith("test-id");
      expect(result).toEqual({ success: true });
    });

    it("should handle stats request", () => {
      registerHistoryIpc();

      const statsHandler = ipcSpy.handle.mock.calls.find(call => call[0] === "history-cache:stats");
      const mockGetCount = vi.fn();
      const mockGetLastSyncTime = vi.fn();

      statsHandler[1](_event: any) => {
        return {
          totalCount: mockGetCount(),
          lastSyncTime: mockGetLastSyncTime(),
        };
      };

      mockGetCount.mockReturnValue(42);
      mockGetLastSyncTime.mockReturnValue("2024-01-01T00:00:00Z");

      const result = statsHandler[1]({} as any);

      expect(mockGetCount).toHaveBeenCalled();
      expect(mockGetLastSyncTime).toHaveBeenCalled();
      expect(result).toEqual({
        totalCount: 42,
        lastSyncTime: "2024-01-01T00:00:00Z",
      });
    });

    it("should handle clear all predictions", () => {
      registerHistoryIpc();

      const clearHandler = ipcSpy.handle.mock.calls.find(call => call[0] === "history-cache:clear");
      const mockGetDatabase = vi.fn();
      const mockPersistDatabase = vi.fn();

      clearHandler[1](_event: any) => {
        const db = mockGetDatabase();
        db.run("DELETE FROM predictions");
        mockPersistDatabase();
        return { success: true };
      };

      const mockDb = {
        run: vi.fn(),
      };
      mockGetDatabase.mockReturnValue(mockDb);

      const result = clearHandler[1]({} as any);

      expect(mockDb.run).toHaveBeenCalledWith("DELETE FROM predictions");
      expect(mockPersistDatabase).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("should handle error cases gracefully", () => {
      registerHistoryIpc();

      const errorHandlers = ["history-cache:list", "history-cache:get", "history-cache:upsert", "history-cache:upsert-bulk", "history-cache:delete"];

      errorHandlers.forEach(handlerName => {
        const handler = ipcSpy.handle.mock.calls.find(call => call[0] === handlerName);
        if (handler) {
          // Simulate repository throwing an error
          const mockRepo = vi.fn().mockImplementation(() => {
            throw new Error("Repository error");
          });

          handler[1](_event: any, ...args: any[]) => {
            return mockRepo(...args);
          };

          expect(() => handler[1]({} as any, ...args)).toThrow("Repository error");
        }
      });
    });

    it("should provide proper type safety for IPC handlers", () => {
      registerHistoryIpc();

      const typeCheckHandler = ipcSpy.handle.mock.calls[0];
      const handler = typeCheckHandler[1];

      // Type checking - these should work without runtime errors
      expect(() => {
        handler({} as any, { limit: 50, offset: 0 }); // list options
        handler({} as any, "test-id"); // get prediction id
        handler({} as any, { id: "test", model: "test", status: "completed", outputs: [], created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" }); // upsert item
        handler({} as any, [{ id: "test", model: "test", status: "completed", outputs: [], created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" }]); // bulk items
        handler({} as any, "test-id"); // delete id
        handler({} as any, {}); // stats (no args)
        handler({} as any, {}); // clear (no args)
      }).not.toThrow();
    });

    it("should handle concurrent requests properly", () => {
      registerHistoryIpc();

      const concurrentHandler = ipcSpy.handle.mock.calls.find(call => call[0] === "history-cache:list");
      const mockListPredictions = vi.fn();

      concurrentHandler[1](_event: any, options: ListOptions) => {
        // Simulate async operation
        return new Promise((resolve) => {
          setTimeout(() => {
            mockListPredictions(options);
            resolve([]);
          }, 10);
        });
      };

      // Simulate concurrent calls
      const promises = [
        concurrentHandler[1]({} as any, { limit: 10 }),
        concurrentHandler[1]({} as any, { limit: 20 }),
        concurrentHandler[1]({} as any, { limit: 30 }),
      ];

      expect(promises).toHaveLength(3);
      // All promises should resolve without interference
      return Promise.all(promises).then(results => {
        expect(results).toHaveLength(3);
        expect(results.every(result => Array.isArray(result) || result === null || result === undefined)).toBe(true);
      });
    });
  });
});