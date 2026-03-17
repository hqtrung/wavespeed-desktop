/**
 * History cache module — local SQLite storage for prediction history.
 * Called from electron/main.ts during app.whenReady().
 */
import { openDatabase, closeDatabase } from "./db/connection";
import { registerHistoryIpc } from "./ipc/history-ipc";
import { getCount } from "./db/prediction-repo";

export async function initHistoryModule(): Promise<void> {
  console.log("[History Cache] Initializing history cache module...");

  await openDatabase();
  registerHistoryIpc();

  // Check if database needs resync (has entries but might be missing input_details)
  const count = getCount();
  console.log(`[History Cache] Found ${count} cached predictions`);

  console.log("[History Cache] Module initialized successfully");
}

export function closeHistoryDatabase(): void {
  closeDatabase();
  console.log("[History Cache] Database closed");
}
