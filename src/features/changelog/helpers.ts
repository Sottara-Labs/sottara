import type { ChangelogEntry } from "./types";

/**
 * The localStorage key used to persist the last-seen changelog version.
 */
export const STORAGE_KEY = "stealth:changelog:seen-version";

/**
 * Read the last-seen version from localStorage.
 * Returns `null` when storage is unavailable or the key has never been set.
 */
export function getSeenVersion(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the last-seen version to localStorage.
 * Silently swallows storage errors (e.g. private browsing quota).
 */
export function setSeenVersion(version: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, version);
  } catch {
    // ignore — storage may be unavailable in private browsing
  }
}

/**
 * Compare two version strings numerically segment by segment, handling
 * pre-release suffixes explicitly.
 *
 * Returns:
 *  - 1 if v1 > v2 (v1 is newer)
 *  - -1 if v1 < v2 (v1 is older)
 *  - 0 if v1 === v2
 */
export function compareVersions(v1: string, v2: string): number {
  if (v1 === v2) return 0;

  // Clean leading 'v'
  const clean1 = v1.trim().replace(/^v/i, "");
  const clean2 = v2.trim().replace(/^v/i, "");

  // Split version into core segments and pre-release suffix (e.g. "1.10.0-beta.1" -> "1.10.0", "beta.1")
  const [core1, ...preParts1] = clean1.split("-");
  const [core2, ...preParts2] = clean2.split("-");

  const pre1 = preParts1.length > 0 ? preParts1.join("-") : undefined;
  const pre2 = preParts2.length > 0 ? preParts2.join("-") : undefined;

  const segs1 = core1.split(".").map((s) => parseInt(s, 10));
  const segs2 = core2.split(".").map((s) => parseInt(s, 10));

  const maxLen = Math.max(segs1.length, segs2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = Number.isNaN(segs1[i]) || segs1[i] === undefined ? 0 : segs1[i];
    const num2 = Number.isNaN(segs2[i]) || segs2[i] === undefined ? 0 : segs2[i];

    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  // Core versions are equal. Handle pre-release suffixes:
  // A version with a pre-release suffix is older than a version without one.
  if (pre1 === undefined && pre2 !== undefined) return 1;
  if (pre1 !== undefined && pre2 === undefined) return -1;
  if (pre1 !== undefined && pre2 !== undefined) {
    return pre1.localeCompare(pre2, undefined, { numeric: true });
  }

  return 0;
}

/**
 * Determine whether a changelog entry should be considered unread
 * given the last version the user acknowledged.
 *
 * When `seenVersion` is `null` (first visit), every entry is unread.
 * Otherwise, an entry is unread when its version compares numerically
 * greater than the seen version.
 */
export function isEntryUnread(entryVersion: string, seenVersion: string | null): boolean {
  if (!seenVersion) return true;
  return compareVersions(entryVersion, seenVersion) > 0;
}

/**
 * Determine whether any entry in the list is newer than the seen version.
 */
export function hasUnreadEntries(latestVersion: string, seenVersion: string | null): boolean {
  if (!seenVersion) return true;
  return compareVersions(latestVersion, seenVersion) > 0;
}

/** Key used to group changelog entries by release. */
export type ReleaseGroupKey = string;

/**
 * Group changelog entries by `"version|date"`.
 *
 * Maintains insertion order so the caller receives groups in the same
 * sequence as the source array (typically newest-first).
 */
export function groupEntriesByRelease(
  entries: readonly ChangelogEntry[],
): Record<ReleaseGroupKey, ChangelogEntry[]> {
  return entries.reduce<Record<string, ChangelogEntry[]>>((acc, entry) => {
    const key = `${entry.version}|${entry.date}`;
    (acc[key] ??= []).push(entry);
    return acc;
  }, {});
}

/**
 * Look up the display configuration for a changelog category.
 * Returns `undefined` for unknown categories, letting the caller
 * fall back to a generic badge.
 */
export const CATEGORY_CONFIG: Record<string, { label: string; styles: string }> = {
  ui: {
    label: "UI",
    styles: "bg-sky-400/15 text-sky-300 border-sky-400/20 hover:bg-sky-400/20",
  },
  api: {
    label: "API",
    styles: "bg-violet-400/15 text-violet-300 border-violet-400/20 hover:bg-violet-400/20",
  },
  protocol: {
    label: "Protocol",
    styles: "bg-amber-400/15 text-amber-300 border-amber-400/20 hover:bg-amber-400/20",
  },
  security: {
    label: "Security",
    styles: "bg-rose-400/15 text-rose-300 border-rose-400/20 hover:bg-rose-400/20",
  },
};

/**
 * Resolve the human-readable label for a category, falling back
 * to the raw category string for unknown values.
 */
export function getCategoryLabel(category: string): string {
  return CATEGORY_CONFIG[category]?.label ?? category;
}
