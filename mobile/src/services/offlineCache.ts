import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';

// v2 does not read the unscoped legacy cache. Each entry belongs to one wallet.
const CACHE_PREFIX = 'cache:v2:';
const STALE_AFTER_MS = 10 * 60 * 1000;
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_CACHE_ENTRIES_PER_WALLET = 100;

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  lastAccessedAt?: number;
}

export interface ReadThroughResult<T> {
  data: T;
  fromCache: boolean;
  stale: boolean;
  cachedAt: number | null;
}

function userPrefix(wallet: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(wallet)}:`;
}

async function getRequiredWallet(): Promise<string> {
  const wallet = await SecureStore.getItemAsync('wallet_address');
  if (!wallet) throw new Error('A signed-in wallet is required to access offline data');
  return wallet;
}

/**
 * On startup and after writes, remove expired/invalid v2 entries, then keep
 * at most MAX_CACHE_ENTRIES_PER_WALLET per wallet by last access time.
 * Never touches unrelated storage or unscoped legacy cache keys.
 */
export async function pruneOfflineCache(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(CACHE_PREFIX));
  const groups = new Map<string, Array<{ key: string; recentlyUsed: number }>>();
  const remove: string[] = [];
  const now = Date.now();

  for (const key of keys) {
    const rest = key.slice(CACHE_PREFIX.length);
    const separator = rest.indexOf(':');
    if (separator <= 0) {
      remove.push(key);
      continue;
    }
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' ||
          !('data' in parsed) || !('cachedAt' in parsed) ||
          typeof parsed.cachedAt !== 'number' || !Number.isFinite(parsed.cachedAt) ||
          parsed.cachedAt < 0 || parsed.cachedAt > now ||
          now - parsed.cachedAt > MAX_CACHE_AGE_MS) {
        remove.push(key);
        continue;
      }
      const entry = parsed as CacheEntry<unknown>;
      const last = typeof entry.lastAccessedAt === 'number' &&
        Number.isFinite(entry.lastAccessedAt) && entry.lastAccessedAt >= entry.cachedAt &&
        entry.lastAccessedAt <= now ? entry.lastAccessedAt : entry.cachedAt;
      const wallet = rest.slice(0, separator);
      const group = groups.get(wallet) ?? [];
      group.push({ key, recentlyUsed: last });
      groups.set(wallet, group);
    } catch {
      remove.push(key);
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.recentlyUsed - a.recentlyUsed || a.key.localeCompare(b.key));
    remove.push(...group.slice(MAX_CACHE_ENTRIES_PER_WALLET).map((entry) => entry.key));
  }
  if (remove.length) await AsyncStorage.multiRemove(remove);
}

// This module is imported at app startup. Read-through calls wait for this
// initial cleanup, without breaking network requests if storage is unavailable.
const startupCleanup = pruneOfflineCache().catch(() => undefined);

/** Clears this wallet's cached entries, plus unsafe legacy unscoped entries. */
export async function clearOfflineCacheForUser(wallet: string): Promise<void> {
  if (!wallet) return;
  const keys = await AsyncStorage.getAllKeys();
  const prefix = userPrefix(wallet);
  const toRemove = keys.filter((key) =>
    key.startsWith(prefix) || (key.startsWith('cache:') && !key.startsWith(CACHE_PREFIX)),
  );
  if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
}

/** Only cache safe read-only results. Never share a cached result between wallets. */
export async function readThroughCache<T>(key: string, fetcher: () => Promise<T>): Promise<ReadThroughResult<T>> {
  const wallet = await getRequiredWallet();
  const storageKey = userPrefix(wallet) + encodeURIComponent(key);
  await startupCleanup;
  try {
    const data = await fetcher();
    // Do not persist data fetched just before a logout or wallet switch.
    if (await SecureStore.getItemAsync('wallet_address') !== wallet) {
      throw new Error('Wallet changed during offline cache request');
    }
    const now = Date.now();
    const entry: CacheEntry<T> = { data, cachedAt: now, lastAccessedAt: now };
    await AsyncStorage.setItem(storageKey, JSON.stringify(entry));
    // Capacity cleanup should not turn a successful network read into an error.
    await pruneOfflineCache().catch(() => undefined);
    return { data, fromCache: false, stale: false, cachedAt: entry.cachedAt };
  } catch (fetchError) {
    // A switched account must never receive the prior wallet's cached data.
    if (await SecureStore.getItemAsync('wallet_address') !== wallet) throw fetchError;
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw === null) throw fetchError;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed || typeof parsed !== 'object' ||
        !('data' in parsed) || !('cachedAt' in parsed) ||
        typeof parsed.cachedAt !== 'number' || !Number.isFinite(parsed.cachedAt) ||
        parsed.cachedAt < 0
      ) {
        throw new Error('Invalid cache entry');
      }
      const entry = parsed as CacheEntry<T>;
      if (entry.cachedAt > Date.now() || Date.now() - entry.cachedAt > MAX_CACHE_AGE_MS) {
        throw new Error('Expired cache entry');
      }
      // Best effort recency tracking; offline data remains readable if the write fails.
      try {
        await AsyncStorage.setItem(storageKey, JSON.stringify({ ...entry, lastAccessedAt: Date.now() }));
      } catch { /* best effort */ }
      return {
        data: entry.data,
        fromCache: true,
        stale: Date.now() - entry.cachedAt > STALE_AFTER_MS,
        cachedAt: entry.cachedAt,
      };
    } catch {
      // Corrupt or incompatible entries are discarded; surface the original
      // network failure, not a JSON parse error (nor potentially sensitive JSON).
      try { await AsyncStorage.removeItem(storageKey); } catch { /* best effort */ }
      throw fetchError;
    }
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
