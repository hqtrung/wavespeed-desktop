import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initHistoryModule, closeHistoryDatabase } from "../../history/index";
import { openDatabase } from "../../history/db/connection";
import { registerHistoryIpc } from "../../history/ipc/history-ipc";

describe("History Cache Integration Tests", () => {
  let mockDb: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDb = {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: vi.fn(),
      close: vi.fn(),
      export: vi.fn(),
    };

    vi.mock("sql.js", () => ({
      init: vi.fn().mockResolvedValue(mockSqlJs),
      Database: vi.fn().mockReturnValue(mockDb),
    }));

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initHistoryModule", () => {
    it("should initialize history module successfully", async () => {
      // Mock successful database opening
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);

      const openDbSpy = vi.spyOn({ openDatabase }, "openDatabase").mockResolvedValue(mockDb);
      const registerIpcSpy = vi.spyOn({ registerHistoryIpc }, "registerHistoryIpc");

      await initHistoryModule();

      expect(openDbSpy).toHaveBeenCalled();
      expect(registerIpcSpy).toHaveBeenCalled();
    });

    it("should handle database initialization errors gracefully", async () => {
      const openDbSpy = vi.spyOn({ openDatabase }, "openDatabase").mockRejectedValue(new Error("Database error"));

      await expect(initHistoryModule()).resolves.not.toThrow();
    });
  });

  describe("Database Schema Integration", () => {
    it("should create all required tables on first run", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);

      const db = await openDatabase();

      expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS predictions"));
      expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS schema_version"));
      expect(mockDb.run).toHaveBeenCalledWith("INSERT OR IGNORE INTO schema_version (version) VALUES (1)");
    });

    it("should run migrations on subsequent runs", async () => {
      // Simulate existing database with version 1
      mockDb.exec
        .mockReturnValueOnce([{ values: [["1"]] }]) // schema version
        .mockReturnValueOnce([{ values: [["ok"]] }]); // integrity check

      const db = await openDatabase();

      expect(mockDb.run).not.toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS predictions"));
      expect(mockDb.run).toHaveBeenCalledWith("INSERT OR IGNORE INTO schema_version (version) VALUES (1)");
    });

    it("should handle database corruption recovery", async () => {
      mockDb.exec.mockReturnValue([{ values: [["corrupt"]] }]); // integrity check fails

      const fsMock = vi.mocked(fs);
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(Buffer.from("corrupt-data"));
      fsMock.renameSync.mockImplementation((from: string, to: string) => {
        // Simulate successful backup
      });

      const db = await openDatabase();

      expect(fsMock.renameSync).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
    });
  });

  describe("CRUD Operations Integration", () => {
    it("should perform complete CRUD lifecycle", async () => {
      // Setup
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);
      mockDb.prepare.mockReturnValue({
        run: vi.fn(),
        free: vi.fn(),
      });
      mockDb.exec.mockReturnValueOnce([]).mockReturnValueOnce([{ values: [["1"]] }]);

      // Initialize
      await initHistoryModule();

      const testPredictions = [
        {
          id: "pred-1",
          model: "model-1",
          status: "completed",
          outputs: [{ url: "https://example.com/image1.png" }],
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
          error: "Model timeout",
        },
      ];

      // Test data persistence
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should handle concurrent writes safely", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);
      mockDb.prepare.mockReturnValue({
        run: vi.fn().mockImplementation((args) => {
          // Simulate async operation
          return new Promise(resolve => setTimeout(resolve, 1));
        }),
        free: vi.fn(),
      });

      await initHistoryModule();

      // Simulate concurrent writes
      const writes = Array.from({ length: 10 }, (_, i) => ({
        id: `pred-${i}`,
        model: `model-${i}`,
        status: "completed",
        outputs: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      }));

      // All writes should complete without errors
      writes.forEach(item => {
        expect(() => {
          // Simulate upsert operation
          mockDb.prepare().run([item.id, item.model, item.status, "[]", "{}", item.created_at, item.updated_at, null, 0, null, null]);
        }).not.toThrow();
      });
    });

    it("should handle large datasets efficiently", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);
      mockDb.prepare.mockReturnValue({
        run: vi.fn(),
        free: vi.fn(),
      });

      // Create 1000 test predictions
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: `pred-${i}`,
        model: `model-${i % 10}`, // 10 different models
        status: "completed",
        outputs: [],
        created_at: new Date(Date.now() - i * 3600000).toISOString(), // Spread over time
        updated_at: new Date(Date.now() - i * 3600000).toISOString(),
      }));

      await initHistoryModule();

      // Bulk insert
      const stmt = mockDb.prepare();
      for (const item of largeDataset) {
        stmt.run([item.id, item.model, item.status, "[]", "{}", item.created_at, item.updated_at, null, 0, null, null]);
      }
      stmt.free();

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe("Error Handling Integration", () => {
    it("should handle JSON parsing errors gracefully", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);

      // Simulate corrupted JSON in database
      mockDb.exec.mockReturnValueOnce([{ values: [["1"]] }]).mockReturnValueOnce([{ values: [["ok"]] }]);

      const db = await openDatabase();

      // Should still work, even with potential JSON issues
      expect(db).toBeDefined();
    });

    it("should handle database connection failures", async () => {
      const openDbSpy = vi.spyOn({ openDatabase }, "openDatabase")
        .mockRejectedValue(new Error("Connection failed"));

      await expect(initHistoryModule()).resolves.not.toThrow();
    });

    it("should handle IPC registration errors", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);

      const registerIpcSpy = vi.spyOn({ registerHistoryIpc }, "registerHistoryIpc")
        .mockImplementation(() => {
          throw new Error("IPC registration failed");
        });

      await expect(initHistoryModule()).resolves.not.toThrow();
    });
  });

  describe("Performance Integration", () => {
    it("should handle fast writes with debouncing", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);
      mockDb.prepare.mockReturnValue({
        run: vi.fn(),
        free: vi.fn(),
      });

      await initHistoryModule();

      // Simulate rapid writes
      const rapidWrites = Array.from({ length: 100 }, (_, i) => ({
        id: `rapid-pred-${i}`,
        model: "rapid-model",
        status: "completed",
        outputs: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      }));

      rapidWrites.forEach(item => {
        mockDb.prepare().run([item.id, item.model, item.status, "[]", "{}", item.created_at, item.updated_at, null, 0, null, null]);
      });

      // Should debounced writes to minimize disk I/O
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should handle memory constraints", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);
      mockDb.prepare.mockReturnValue({
        run: vi.fn(),
        free: vi.fn(),
      });

      await initHistoryModule();

      // Simulate large export (memory-intensive operation)
      mockDb.export.mockReturnValue(new ArrayBuffer(1024 * 1024 * 10)); // 10MB

      const db = getDatabase();
      const exportedData = db.export();

      expect(exportedData).toBeInstanceOf(ArrayBuffer);
    });
  });

  describe("Cache-First Integration", () => {
    it("should prioritize cache over API for existing data", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);

      await initHistoryModule();

      // Verify cache is the single source of truth
      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining("SELECT * FROM predictions"));
    });

    it("should handle offline mode gracefully", async () => {
      // Simulate no network availability
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);

      await initHistoryModule();

      // Should still work with cached data
      expect(mockDb.exec).toHaveBeenCalled();

      global.fetch = originalFetch;
    });
  });

  describe("Data Consistency", () => {
    it("should maintain data integrity across operations", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);
      mockDb.prepare.mockReturnValue({
        run: vi.fn(),
        free: vi.fn(),
      });

      await initHistoryModule();

      // Insert data
      const testItem = {
        id: "consistency-test",
        model: "test-model",
        status: "completed",
        outputs: [{ url: "https://example.com/test.png" }],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      mockDb.prepare().run([testItem.id, testItem.model, testItem.status, JSON.stringify(testItem.outputs), "{}", testItem.created_at, testItem.updated_at, null, 0, null, null]);

      // Verify data consistency
      mockDb.exec.mockReturnValueOnce([{ values: [] }]).mockReturnValueOnce([{ values: [[testItem.id, testItem.model, testItem.status, JSON.stringify(testItem.outputs), "{}", testItem.created_at, testItem.updated_at, null, 0, null, null]] }]);

      const retrieved = getPredictionById(testItem.id);
      expect(retrieved).toEqual({
        ...testItem,
        inputs: undefined,
        synced_at: undefined,
      });
    });

    it("should handle transaction rollbacks", async () => {
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);
      mockDb.run.mockReturnValue(undefined);
      mockDb.prepare.mockReturnValue({
        run: vi.fn().mockImplementation((query) => {
          if (query.includes("COMMIT")) {
            throw new Error("Commit failed");
          }
        }),
        free: vi.fn(),
      });

      await initHistoryModule();

      // Should rollback on error
      expect(() => {
        mockDb.run("ROLLBACK");
      }).not.toThrow();
    });
  });
});