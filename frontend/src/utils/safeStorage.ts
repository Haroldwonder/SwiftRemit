/**
 * safeStorage – localStorage access that never throws.
 *
 * `localStorage` itself can throw on access (private mode, disabled cookies,
 * sandboxed iframes, quota exceeded), so every call is wrapped in try/catch.
 */

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getItem(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string): boolean {
  try {
    getStorage()?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string): boolean {
  try {
    getStorage()?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export const safeStorage = { getItem, setItem, removeItem };

export default safeStorage;
