/**
 * React hooks for SwiftRemit React Native integration.
 *
 * These hooks wrap the SwiftRemitRNClient and provide React-friendly
 * state management for common operations.
 *
 * ## Wrapping write methods
 *
 * Every write method follows the same pattern: build a transaction with the
 * client, then sign and submit it with `client.submitSigned(tx)`. Wrap such a
 * method with `useMutation` instead of hand-rolling loading/error state:
 *
 * ```ts
 * export function useConfirmPayout(client: SwiftRemitRNClient) {
 *   const { mutate, loading, error } = useMutation(
 *     useCallback(
 *       async (params: Parameters<SwiftRemitRNClient['confirmPayout']>[0]) => {
 *         const tx = await client.confirmPayout(params);
 *         return client.submitSigned(tx);
 *       },
 *       [client]
 *     )
 *   );
 *   return { confirmPayout: mutate, loading, error };
 * }
 * ```
 *
 * `useMutation` owns the loading/error state and the mounted-ref guard, so the
 * wrapper only has to describe the operation. It rethrows errors after
 * recording them, so callers can still `try/catch` around `mutate`.
 *
 * ## Reading state
 *
 * Use `useRemittanceQuery` for reads. It fetches once on mount and, when
 * `pollMs` is given, keeps polling until the remittance reaches a terminal
 * status (`Completed`, `Cancelled`, `Failed` or `Disputed`).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { SwiftRemitRNClient } from './client.js';
import type { Remittance, RemittanceStatus } from '@swiftremit/sdk';

// ── useMutation ───────────────────────────────────────────────────────────────

interface UseMutationState {
  loading: boolean;
  error: Error | null;
}

/**
 * Generic hook for tracking the loading/error state of an async write.
 *
 * @param fn - The async operation to run. Should be stable (wrap in `useCallback`).
 * @returns `mutate` (runs `fn`), `loading`, `error` and `isLoading`.
 */
export function useMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
) {
  const [state, setState] = useState<UseMutationState>({ loading: false, error: null });
  const mountedRef = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mutate = useCallback(async (...args: TArgs): Promise<TResult> => {
    if (mountedRef.current) setState({ loading: true, error: null });
    try {
      const result = await fnRef.current(...args);
      if (mountedRef.current) setState({ loading: false, error: null });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) setState({ loading: false, error });
      throw error;
    }
  }, []);

  return { mutate, isLoading: state.loading, ...state };
}

// ── useCreateRemittance ───────────────────────────────────────────────────────

/**
 * Hook for creating a remittance and tracking submission state.
 *
 * @example
 * const { createRemittance, loading, error } = useCreateRemittance(client);
 * await createRemittance({ sender, agent, amount: toStroops(100) });
 */
export function useCreateRemittance(client: SwiftRemitRNClient) {
  const { mutate, loading, error } = useMutation(
    useCallback(
      async (params: Parameters<SwiftRemitRNClient['createRemittance']>[0]) => {
        const tx = await client.createRemittance(params);
        return client.submitSigned(tx);
      },
      [client]
    )
  );

  return { createRemittance: mutate, isLoading: loading, loading, error };
}

// ── useRemittanceQuery ────────────────────────────────────────────────────────

const TERMINAL_STATUSES: readonly RemittanceStatus[] = [
  'Completed',
  'Cancelled',
  'Failed',
  'Disputed',
];

export interface UseRemittanceQueryOptions {
  /** Poll interval in ms. Omit to fetch once. Polling stops at a terminal status. */
  pollMs?: number;
}

/**
 * Hook for reading a single remittance, optionally polling until it reaches a
 * terminal status.
 *
 * @example
 * const { remittance, loading, error, refetch } = useRemittanceQuery(
 *   client,
 *   address,
 *   remittanceId,
 *   { pollMs: 3000 }
 * );
 */
export function useRemittanceQuery(
  client: SwiftRemitRNClient,
  sourceAddress: string,
  remittanceId: bigint,
  options: UseRemittanceQueryOptions = {}
) {
  const { pollMs } = options;
  const [remittance, setRemittance] = useState<Remittance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fetchOnce = async () => {
      try {
        const result = await client.getRemittance(sourceAddress, remittanceId);
        if (cancelled || !mountedRef.current) return;
        setRemittance(result);
        setError(null);
        setLoading(false);
        if (pollMs !== undefined && pollMs > 0 && !TERMINAL_STATUSES.includes(result.status)) {
          timer = setTimeout(fetchOnce, pollMs);
        }
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    };

    setLoading(true);
    void fetchOnce();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, sourceAddress, remittanceId, pollMs, refetchToken]);

  const refetch = useCallback(() => {
    setRefetchToken((n) => n + 1);
  }, []);

  return { remittance, loading, isLoading: loading, error, refetch };
}

// ── useNetworkToggle ──────────────────────────────────────────────────────────

export type StellarNetwork = 'testnet' | 'mainnet';

/**
 * Simple hook for persisting the active Stellar network selection.
 * Pair with AsyncStorage or expo-secure-store for persistence across restarts.
 */
export function useNetworkToggle(initial: StellarNetwork = 'testnet') {
  const [network, setNetwork] = useState<StellarNetwork>(initial);

  const toggle = useCallback(() => {
    setNetwork((n) => (n === 'testnet' ? 'mainnet' : 'testnet'));
  }, []);

  return { network, toggle, isTestnet: network === 'testnet' };
}
