/**
 * History cache module — local SQLite storage for prediction history.
 * Called from electron/main.ts during app.whenReady().
 */
import { openDatabase, closeDatabase } from "./db/connection";
import { registerHistoryIpc } from "./ipc/history-ipc";

export async function initHistoryModule(): Promise<void> {
  console.log("[History Cache] Initializing history cache module...");

  await openDatabase();
  registerHistoryIpc();

  console.log("[History Cache] Module initialized successfully");
}

export function closeHistoryDatabase(): void {
  closeDatabase();
  console.log("[History Cache] Database closed");
}
