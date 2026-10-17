/**
 * Safe localStorage wrapper that degrades gracefully in storage-denied contexts
 * (e.g. Safari private browsing, sandboxed iframes, or quota exceeded)
 * without throwing DOMExceptions or unmounting components.
 */

export function safeStorageGet(key: string): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(key: string, value: string): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageRemove(key: string): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export const safeStorage = {
  getItem: safeStorageGet,
  setItem: safeStorageSet,
  removeItem: safeStorageRemove,
};
