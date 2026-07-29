/**
 * useTxPolling – polls a transaction status with exponential back-off.
 *
 * Rules:
 * - Never surfaces a "failure" while the status is still ambiguous/pending.
 * - Stops polling on terminal statuses (confirmed, failed, cancelled).
 * - Calls onTimeout after maxAttempts without a terminal status.
 */
import { useRef, useCallback } from 'react';

export type TxStatus = 'pending' | 'processing' | 'confirmed' | 'failed' | 'cancelled' | 'unknown';

export interface PollResult {
  status: TxStatus;
  txHash?: string;
  error?: string;
}

interface UseTxPollingOptions {
  /** Initial delay in ms before the first poll (default 2 000). */
  initialDelayMs?: number;
  /** Multiplier applied to delay after each attempt (default 2). */
  backoffFactor?: number;
  /** Maximum number of poll attempts before calling onTimeout (default 8). */
  maxAttempts?: number;
  /** Called on each poll with the latest result. */
  onUpdate: (result: PollResult) => void;
  /** Called when maxAttempts is reached without a terminal status. */
  onTimeout: () => void;
}

const TERMINAL_STATUSES: TxStatus[] = ['confirmed', 'failed', 'cancelled'];

export interface UseTxPollingReturn {
  startPolling: (txId: string, pollFn: (id: string) => Promise<PollResult>) => void;
  stopPolling: () => void;
}

export function useTxPolling({
  initialDelayMs = 2_000,
  backoffFactor = 2,
  maxAttempts = 8,
  onUpdate,
  onTimeout,
}: UseTxPollingOptions): UseTxPollingReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const stoppedRef = useRef(false);

  const stopPolling = useCallback((): void => {
    stoppedRef.current = true;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (txId: string, pollFn: (id: string) => Promise<PollResult>): void => {
      // Reset state
      stoppedRef.current = false;
      attemptRef.current = 0;

      const schedule = (delayMs: number): void => {
        timerRef.current = setTimeout(async () => {
          if (stoppedRef.current) return;

          attemptRef.current += 1;
          const attempt = attemptRef.current;

          let result: PollResult;
          try {
            result = await pollFn(txId);
          } catch {
            result = { status: 'unknown' };
          }

          if (stoppedRef.current) return;

          onUpdate(result);

          if (TERMINAL_STATUSES.includes(result.status)) {
            stopPolling();
            return;
          }

          if (attempt >= maxAttempts) {
            stopPolling();
            onTimeout();
            return;
          }

          schedule(delayMs * backoffFactor);
        }, delayMs);
      };

      schedule(initialDelayMs);
    },
    [initialDelayMs, backoffFactor, maxAttempts, onUpdate, onTimeout, stopPolling],
  );

  return { startPolling, stopPolling };
}
