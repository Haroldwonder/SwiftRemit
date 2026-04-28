/**
 * React hooks for SwiftRemit React Native integration.
 *
 * These hooks wrap the SwiftRemitRNClient and provide React-friendly
 * state management for common operations.
 */

import { useState, useCallback } from 'react';
import type { SwiftRemitRNClient } from './client.js';

// ── useRemittance ─────────────────────────────────────────────────────────────

interface UseRemittanceState {
  loading: boolean;
  error: Error | null;
}

/**
 * Hook for creating a remittance and tracking submission state.
 *
 * @example
 * const { createRemittance, loading, error } = useCreateRemittance(client);
 * await createRemittance({ sender, agent, amount: toStroops(100) });
 */
export function useCreateRemittance(client: SwiftRemitRNClient) {
  const [state, setState] = useState<UseRemittanceState>({ loading: false, error: null });

  const createRemittance = useCallback(
    async (params: Parameters<SwiftRemitRNClient['createRemittance']>[0]) => {
      setState({ loading: true, error: null });
      try {
        const tx = await client.createRemittance(params);
        const result = await client.submitSigned(tx);
        setState({ loading: false, error: null });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ loading: false, error });
        throw error;
      }
    },
    [client]
  );

  return { createRemittance, ...state };
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
