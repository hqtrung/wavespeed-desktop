/**
 * Shared utilities for sync operations.
 */

/**
 * Parse tags from JSON or return empty array.
 */
export function parseTags(tags: string | string[] | undefined): string[] {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === "string") {
    try {
      return JSON.parse(tags);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Merge tag arrays (union, no duplicates).
 */
export function mergeTags(local: string[], remote: string[]): string[] {
  return Array.from(new Set([...local, ...remote]));
}
