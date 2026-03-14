import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openDatabase, closeDatabase, getDatabase, persistDatabase, transaction } from "../../history/db/connection";
import type { SqlJsDatabase } from "sql.js";
import fs from "fs";
import path from "path";

// Mock sql.js
vi.mock("sql.js");
const mockSqlJs = {
  Database: vi.fn(),
  init: vi.fn().mockResolvedValue(mockSqlJs),
};

// Mock Electron app and fs
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

describe("Database Connection", () => {
  let mockDb: any;
  let consoleSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDb = {
      exec: vi.fn(),
      run: vi.fn(),
      close: vi.fn(),
      export: vi.fn(),
    };
    (mockSqlJs.Database as any).mockReturnValue(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("openDatabase", () => {
    it("should create new database when none exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);

      const db = await openDatabase();

      expect(mockSqlJs.Database).toHaveBeenCalledWith(undefined);
      expect(mockDb.run).toHaveBeenCalledWith("PRAGMA foreign_keys = ON");
      expect(mockDb.run).not.toHaveBeenCalledWith("BEGIN TRANSACTION");
      expect(db).toBe(mockDb);
    });

    it("should load existing database when it exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("mock-data"));
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);

      const db = await openDatabase();

      expect(mockSqlJs.Database).toHaveBeenCalledWith(Buffer.from("mock-data"));
      expect(mockDb.run).toHaveBeenCalledWith("PRAGMA foreign_keys = ON");
    });

    it("should handle database corruption by creating backup", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("corrupt-data"));
      mockDb.exec.mockReturnValue([{ values: [["corrupt"]] }]);
      vi.mocked(fs.existsSync).mockImplementation((path: string) => {
        if (path.endsWith("history-cache.db")) return true;
        if (path.endsWith(".corrupt.")) return false;
        return false;
      });

      const db = await openDatabase();

      expect(mockSqlJs.Database).toHaveBeenCalledWith(Buffer.from("corrupt-data"));
      expect(fs.renameSync).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
      expect(mockSqlJs.Database).toHaveBeenCalledWith(undefined);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should initialize schema for new database", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);

      const db = await openDatabase();

      expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS predictions"));
      expect(mockDb.run).toHaveBeenCalledWith("INSERT OR IGNORE INTO schema_version (version) VALUES (1)");
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should run migrations for existing database", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("mock-data"));
      mockDb.exec
        .mockReturnValueOnce([{ values: [["1"]] }]) // schema version
        .mockReturnValueOnce([{ values: [["ok"]] }]); // integrity check

      const db = await openDatabase();

      expect(mockDb.run).not.toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS predictions"));
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe("getDatabase", () => {
    it("should return existing database", () => {
      // Mock database as already initialized
      (getDatabase as any).__mockData__ = mockDb;
      expect(getDatabase()).toBe(mockDb);
    });

    it("should throw error when database not initialized", () => {
      expect(() => getDatabase()).toThrow("Database not initialized");
    });
  });

  describe("persistDatabase", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should debounce multiple calls", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockDb.exec.mockReturnValue([{ values: [["ok"]] }]);

      const persistSpy = vi.spyOn(mockDb, "export");

      persistDatabase();
      persistDatabase();
      persistDatabase();

      expect(persistSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(persistSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("closeDatabase", () => {
    it("should persist and close database", () => {
      (getDatabase as any).__mockData__ = mockDb;
      const persistSpy = vi.spyOn({ persistDatabaseNow }, "persistDatabaseNow");

      closeDatabase();

      expect(persistSpy).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
    });

    it("should handle errors during close", () => {
      (getDatabase as any).__mockData__ = mockDb;
      mockDb.close.mockImplementation(() => {
        throw new Error("Close error");
      });

      expect(() => closeDatabase()).not.toThrow();
    });
  });

  describe("transaction", () => {
    beforeEach(() => {
      (getDatabase as any).__mockData__ = mockDb;
    });

    it("should execute transaction successfully", () => {
      const result = transaction((db) => "test-result");

      expect(mockDb.run).toHaveBeenCalledWith("BEGIN TRANSACTION");
      expect(mockDb.run).toHaveBeenCalledWith("COMMIT");
      expect(result).toBe("test-result");
    });

    it("should rollback on error", () => {
      mockDb.run.mockImplementationOnce((query) => {
        if (query === "COMMIT") throw new Error("Commit error");
      });

      expect(() => transaction(() => { throw new Error("Test error"); })).toThrow("Test error");
      expect(mockDb.run).toHaveBeenCalledWith("ROLLBACK");
    });
  });
});