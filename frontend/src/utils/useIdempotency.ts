/**
 * useIdempotency – generates and tracks idempotency keys so the same
 * submission can never be sent twice (double-click / network retry guard).
 */
import { useRef, useCallback } from 'react';

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
  const submittedKeys = useRef<Set<string>>(new Set());

  const nextKey = useCallback((): string => generateIdempotencyKey(), []);

  const isDuplicate = useCallback((key: string): boolean => submittedKeys.current.has(key), []);

  const markSubmitted = useCallback((key: string): void => {
    submittedKeys.current.add(key);
  }, []);

  const clearKey = useCallback((key: string): void => {
    submittedKeys.current.delete(key);
  }, []);

  const reset = useCallback((): void => {
    submittedKeys.current.clear();
  }, []);

  return { nextKey, isDuplicate, markSubmitted, clearKey, reset };
}
