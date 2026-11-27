import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  MAX_CACHE_AGE_MS, MAX_CACHE_ENTRIES_PER_WALLET,
  pruneOfflineCache, readThroughCache,
} from './offlineCache';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(),
    getItem: jest.fn(),
    setItem: jest.fn(),
    multiRemove: jest.fn(),
    removeItem: jest.fn(),
  },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined) },
}));

const store = new Map<string, string>();
let activeWallet = 'wallet-a';
const key = (wallet: string, suffix: string) => `cache:v2:${wallet}:${suffix}`;
const makeEntry = (cachedAt: number, lastAccessedAt = cachedAt) =>
  JSON.stringify({ data: 'saved', cachedAt, lastAccessedAt });

beforeEach(() => {
  store.clear();
  activeWallet = 'wallet-a';
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async () => activeWallet);
  jest.mocked(AsyncStorage.getAllKeys).mockImplementation(async () => [...store.keys()]);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => store.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { store.set(key, value); });
  jest.mocked(AsyncStorage.multiRemove).mockImplementation(async (keys) => { keys.forEach((key) => store.delete(key)); });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => { store.delete(key); });
});

describe('#1905 wallet-scoped offline eviction', () => {
  it('removes expired entries but never touches unrelated storage', async () => {
    const now = Date.now();
    store.set(key('wallet-a', 'expired'), makeEntry(now - MAX_CACHE_AGE_MS - 1));
    store.set(key('wallet-a', 'fresh'), makeEntry(now - 1000));
    store.set('unrelated:setting', 'keep');
    await pruneOfflineCache();
    expect(store.has(key('wallet-a', 'expired'))).toBe(false);
    expect(store.has(key('wallet-a', 'fresh'))).toBe(true);
    expect(store.has('unrelated:setting')).toBe(true);
  });

  it('evicts the least recently used item for each wallet independently', async () => {
    const now = Date.now();
    for (let i = 0; i <= MAX_CACHE_ENTRIES_PER_WALLET; i++) {
      store.set(key('wallet-a', String(i)), makeEntry(now - 1000, now - i));
    }
    store.set(key('wallet-b', 'keep'), makeEntry(now));
    await pruneOfflineCache();
    expect([...store.keys()].filter((item) => item.startsWith('cache:v2:wallet-a:')))
      .toHaveLength(MAX_CACHE_ENTRIES_PER_WALLET);
    expect(store.has(key('wallet-a', String(MAX_CACHE_ENTRIES_PER_WALLET)))).toBe(false);
    expect(store.has(key('wallet-b', 'keep'))).toBe(true);
  });

  it('updates LRU recency on a cached read', async () => {
    const now = Date.now();
    store.set(key('wallet-a', 'balance'), makeEntry(now - 3000));
    const result = await readThroughCache('balance', async () => { throw new Error('offline'); });
    expect(result).toMatchObject({ data: 'saved', fromCache: true });
    expect(JSON.parse(store.get(key('wallet-a', 'balance'))!).lastAccessedAt).toBeGreaterThan(now - 3000);
  });

  it('does not return expired data when offline', async () => {
    store.set(key('wallet-a', 'balance'), makeEntry(Date.now() - MAX_CACHE_AGE_MS - 1));
    await expect(readThroughCache('balance', async () => { throw new Error('offline'); }))
      .rejects.toThrow('offline');
    expect(store.has(key('wallet-a', 'balance'))).toBe(false);
  });

  it('writes fresh responses and keeps other wallets isolated', async () => {
    expect(await readThroughCache('balance', async () => 42))
      .toMatchObject({ data: 42, fromCache: false });
    activeWallet = 'wallet-b';
    await expect(readThroughCache('balance', async () => { throw new Error('offline'); }))
      .rejects.toThrow('offline');
    activeWallet = 'wallet-a';
    expect(await readThroughCache('balance', async () => { throw new Error('offline'); }))
      .toMatchObject({ data: 42, fromCache: true });
  });
});
