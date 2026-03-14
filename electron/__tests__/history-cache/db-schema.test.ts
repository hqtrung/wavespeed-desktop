import { describe, it, expect } from "vitest";
import { initializeSchema, runMigrations } from "../../history/db/schema";
import type { SqlJsDatabase } from "sql.js";

describe("Database Schema", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      run: vi.fn(),
      exec: vi.fn(),
    };
  });

  describe("initializeSchema", () => {
    it("should create all required tables", () => {
      initializeSchema(mockDb);

      expect(mockDb.run).toHaveBeenCalledTimes(4); // predictions, schema_version + 3 indexes

      expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS schema_version"));
      expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS predictions"));
      expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining("idx_history_created"));
      expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining("idx_history_model"));
      expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining("idx_history_status"));
    });

    it("should set up schema constraints", () => {
      initializeSchema(mockDb);

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'created'))")
      );
    });

    it("should initialize schema version", () => {
      initializeSchema(mockDb);

      expect(mockDb.run).toHaveBeenCalledWith(
        "INSERT OR IGNORE INTO schema_version (version) VALUES (1)"
      );
    });
  });

  describe("runMigrations", () => {
    it("should do nothing when current version matches", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [["1"]] }]);

      runMigrations(mockDb);

      expect(mockDb.exec).toHaveBeenCalledWith("SELECT MAX(version) as version FROM schema_version");
      expect(mockDb.run).not.toHaveBeenCalledWith(expect.stringContaining("version"));
    });

    it("should run migrations for newer versions", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [["1"]] }]);

      const migrations = [
        {
          version: 2,
          apply: vi.fn(),
        },
        {
          version: 3,
          apply: vi.fn(),
        },
      ];

      (runMigrations as any).migrations = migrations;

      runMigrations(mockDb);

      expect(migrations[0].apply).toHaveBeenCalledWith(mockDb);
      expect(migrations[1].apply).not.toHaveBeenCalled(); // Not applied yet
    });

    it("should handle empty migration list", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [["1"]] }]);

      runMigrations(mockDb);

      expect(mockDb.run).not.toHaveBeenCalledWith(expect.stringContaining("ALTER"));
    });

    it("should handle database with no version", () => {
      mockDb.exec.mockReturnValueOnce([{ values: [] }]); // Empty result

      runMigrations(mockDb);

      expect(mockDb.run).not.toHaveBeenCalledWith(expect.stringContaining("ALTER"));
    });
  });

  describe("Index creation", () => {
    it("should create indexes for common queries", () => {
      initializeSchema(mockDb);

      expect(mockDb.run).toHaveBeenCalledWith(
        "CREATE INDEX IF NOT EXISTS idx_history_created ON predictions(created_at DESC)"
      );
      expect(mockDb.run).toHaveBeenCalledWith(
        "CREATE INDEX IF NOT EXISTS idx_history_model ON predictions(model_id)"
      );
      expect(mockDb.run).toHaveBeenCalledWith(
        "CREATE INDEX IF NOT EXISTS idx_history_status ON predictions(status)"
      );
    });
  });
});