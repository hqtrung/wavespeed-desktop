import type { AssetFolder } from "@/types/asset";

/**
 * Color palette for asset folders
 * Provides 12 preset colors for folder customization
 */

export const FOLDER_COLORS = [
  { name: "Slate", value: "#64748b", className: "bg-slate-500" },
  { name: "Red", value: "#ef4444", className: "bg-red-500" },
  { name: "Orange", value: "#f97316", className: "bg-orange-500" },
  { name: "Amber", value: "#f59e0b", className: "bg-amber-500" },
  { name: "Green", value: "#22c55e", className: "bg-green-500" },
  { name: "Emerald", value: "#10b981", className: "bg-emerald-500" },
  { name: "Cyan", value: "#06b6d4", className: "bg-cyan-500" },
  { name: "Blue", value: "#3b82f6", className: "bg-blue-500" },
  { name: "Indigo", value: "#6366f1", className: "bg-indigo-500" },
  { name: "Violet", value: "#8b5cf6", className: "bg-violet-500" },
  { name: "Purple", value: "#a855f7", className: "bg-purple-500" },
  { name: "Pink", value: "#ec4899", className: "bg-pink-500" },
] as const;

export const DEFAULT_FOLDER_COLOR = FOLDER_COLORS[7].value; // Blue

export function getFolderColorClass(value: string): string {
  const color = FOLDER_COLORS.find((c) => c.value === value);
  return color?.className || FOLDER_COLORS[7].className;
}

/**
 * Get folder color value (hex) from folder ID
 * Requires the folders array from assetsStore
 */
export function getFolderColor(
  folderId: string | undefined,
  folders: AssetFolder[],
): string {
  if (!folderId) return DEFAULT_FOLDER_COLOR;
  const folder = folders.find((f) => f.id === folderId);
  return folder?.color || DEFAULT_FOLDER_COLOR;
}

/**
 * Get folder name from folder ID
 * Requires the folders array from assetsStore
 */
export function getFolderName(
  folderId: string | undefined,
  folders: AssetFolder[],
): string | undefined {
  if (!folderId) return undefined;
  return folders.find((f) => f.id === folderId)?.name;
}
