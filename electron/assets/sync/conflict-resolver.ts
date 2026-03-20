/**
 * Conflict resolution for asset synchronization.
 * Version-based strategy with tag merging for concurrent edits.
 */

import { parseTags, mergeTags } from "./utils";

export interface Conflict {
  id: string;
  entityType: "asset" | "folder" | "tag_category";
  localVersion: {
    id: string;
    version: number;
    data: any;
  };
  remoteVersion: {
    id: string;
    version: number;
    data: any;
  };
}

export interface ConflictResolution {
  conflictId: string;
  action: "keep_local" | "keep_remote" | "merged";
  mergedData?: any;
}

export class ConflictResolver {
  constructor(private deviceId: string) {}

  /**
   * Resolve a single conflict using version-based strategy.
   */
  resolve(conflict: Conflict): ConflictResolution {
    const local = conflict.localVersion;
    const remote = conflict.remoteVersion;

    // Case 1: Remote deletion wins (higher version)
    if (remote.data.sync_status === "deleted" && remote.version > local.version) {
      return { conflictId: conflict.id, action: "keep_remote" };
    }

    // Case 2: Local deletion wins (higher version)
    if (local.data.sync_status === "deleted" && local.version > remote.version) {
      return { conflictId: conflict.id, action: "keep_local" };
    }

    // Case 3: Version comparison
    if (remote.version > local.version) {
      return { conflictId: conflict.id, action: "keep_remote" };
    } else if (local.version > remote.version) {
      return { conflictId: conflict.id, action: "keep_local" };
    }

    // Case 4: Same version (concurrent edit - rare!)
    // For assets: merge tags, for others: keep local (device that initiated)
    if (conflict.entityType === "asset") {
      const localTags = this.parseTags(local.data.tags);
      const remoteTags = this.parseTags(remote.data.tags);
      const mergedTags = this.mergeTags(localTags, remoteTags);

      return {
        conflictId: conflict.id,
        action: "merged",
        mergedData: {
          ...local.data,
          tags: JSON.stringify(mergedTags),
          version: local.version + 1,
        },
      };
    }

    // Default: local wins (current device's operation)
    return { conflictId: conflict.id, action: "keep_local" };
  }

  /**
   * Batch resolve conflicts.
   */
  resolveBatch(conflicts: Conflict[]): Map<string, ConflictResolution> {
    const resolutions = new Map<string, ConflictResolution>();
    for (const conflict of conflicts) {
      resolutions.set(conflict.id, this.resolve(conflict));
    }
    return resolutions;
  }

  /**
   * Check if two asset versions have conflicting tag changes.
   */
  tagsDiffer(a: any, b: any): boolean {
    const tagsA = parseTags(a.tags);
    const tagsB = parseTags(b.tags);

    if (tagsA.length !== tagsB.length) return true;

    const sortedA = [...tagsA].sort();
    const sortedB = [...tagsB].sort();

    return sortedA.some((tag, i) => tag !== sortedB[i]);
  }
}
