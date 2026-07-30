import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const CACHE_PREFIX = 'cache:';

// Reads older than this are still shown, but flagged as stale in the UI.
const STALE_AFTER_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

export interface ReadThroughResult<T> {
  data: T;
  fromCache: boolean;
  stale: boolean;
  cachedAt: number | null;
}

/**
 * Fetches fresh data and caches it for offline reads. If the fetch fails
 * (e.g. no connectivity), falls back to the last cached value for that key
 * and marks the result as stale/from-cache instead of erroring out.
 * Only ever used for safe, idempotent reads — never for money-moving calls.
 */
export async function readThroughCache<T>(key: string, fetcher: () => Promise<T>): Promise<ReadThroughResult<T>> {
  const storageKey = CACHE_PREFIX + key;
  try {
    const data = await fetcher();
    const entry: CacheEntry<T> = { data, cachedAt: Date.now() };
    await AsyncStorage.setItem(storageKey, JSON.stringify(entry));
    return { data, fromCache: false, stale: false, cachedAt: entry.cachedAt };
  } catch (err) {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) throw err;
    const entry: CacheEntry<T> = JSON.parse(raw);
    return {
      data: entry.data,
      fromCache: true,
      stale: Date.now() - entry.cachedAt > STALE_AFTER_MS,
      cachedAt: entry.cachedAt,
    };
  }
}

export function useNetworkStatus(): { isOffline: boolean; isReconnecting: boolean } {
  const [isOffline, setIsOffline] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = state.isConnected === false || state.isInternetReachable === false;
      if (wasOffline.current && !offline) setIsReconnecting(true);
      wasOffline.current = offline;
      setIsOffline(offline);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isReconnecting) return;
    const timeout = setTimeout(() => setIsReconnecting(false), 2000);
    return () => clearTimeout(timeout);
  }, [isReconnecting]);

  return { isOffline, isReconnecting };
}
