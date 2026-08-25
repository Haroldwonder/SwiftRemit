/**
 * useIdempotency – generates and tracks idempotency keys so the same
 * submission can never be sent twice (double-click / network retry guard).
 * 
 * SR-177: Keys are persisted to sessionStorage to protect against page reloads.
 */
import { useRef, useCallback } from 'react';

const STORAGE_KEY = 'idempotency_keys';

function generateIdempotencyKey(): string {
  // Use crypto.randomUUID when available (all modern browsers + Node ≥ 14.17)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random hex
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

function loadKeysFromStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const keys = JSON.parse(stored) as string[];
      return new Set(keys);
    }
  } catch (e) {
    console.warn('Failed to load idempotency keys from sessionStorage:', e);
  }
  return new Set();
}

function saveKeysToStorage(keys: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(keys)));
  } catch (e) {
    console.warn('Failed to save idempotency keys to sessionStorage:', e);
  }
}

export interface UseIdempotencyReturn {
  /** Generate a fresh key for the next submission attempt. */
  nextKey: () => string;
  /** Return true if this key has already been submitted (and not yet cleared). */
  isDuplicate: (key: string) => boolean;
  /** Mark a key as successfully submitted. */
  markSubmitted: (key: string) => void;
  /** Remove a key from the submitted set (e.g. on confirmed success). */
  clearKey: (key: string) => void;
  /** Remove all tracked keys. */
  reset: () => void;
}

export function useIdempotency(): UseIdempotencyReturn {
  const submittedKeys = useRef<Set<string>>(loadKeysFromStorage());

  const nextKey = useCallback((): string => generateIdempotencyKey(), []);

  const isDuplicate = useCallback((key: string): boolean => submittedKeys.current.has(key), []);

  const markSubmitted = useCallback((key: string): void => {
    submittedKeys.current.add(key);
    saveKeysToStorage(submittedKeys.current);
  }, []);

  const clearKey = useCallback((key: string): void => {
    submittedKeys.current.delete(key);
    saveKeysToStorage(submittedKeys.current);
  }, []);

  const reset = useCallback((): void => {
    submittedKeys.current.clear();
    saveKeysToStorage(submittedKeys.current);
  }, []);

  return { nextKey, isDuplicate, markSubmitted, clearKey, reset };
}
