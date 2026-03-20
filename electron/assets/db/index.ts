/**
 * Assets database module exports.
 */

export { openDatabase, getDatabase, closeDatabase, transaction, vacuumDatabase, getDatabaseStats } from "./connection";
export { initializeSchema, runMigrations, getRemoteSchemaSql, SCHEMA_VERSION } from "./schema";
export { assetsRepo, type AssetFilter, type PaginatedResult } from "./assets.repo";
export { foldersRepo } from "./folders.repo";
export { tagsRepo } from "./tags.repo";
export { syncRepo, type SyncState } from "./sync.repo";
export type { AssetRow, FolderRow, TagCategoryRow } from "./schema";
