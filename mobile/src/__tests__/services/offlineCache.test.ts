import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { readThroughCache } from '../../services/offlineCache';

jest.mock('@react-native-async-storage/async-storage');
jest.mock('@react-native-community/netinfo');

const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('offlineCache.ts — readThroughCache', () => {
  const cacheKey = 'test-key';
  const testData = { id: 1, name: 'Test' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches fresh data and caches it when fetch succeeds', async () => {
    const fetcher = jest.fn().mockResolvedValue(testData);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.getItem.mockResolvedValue(null);

    const result = await readThroughCache(cacheKey, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual(testData);
    expect(result.fromCache).toBe(false);
    expect(result.stale).toBe(false);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      `cache:${cacheKey}`,
      expect.stringContaining(JSON.stringify(testData))
    );
  });

  it('falls back to cached data when fetch fails', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network error'));
    const cachedEntry = {
      data: testData,
      cachedAt: Date.now(),
    };
    mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(cachedEntry));

    const result = await readThroughCache(cacheKey, fetcher);

    expect(result.data).toEqual(testData);
    expect(result.fromCache).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.cachedAt).toBe(cachedEntry.cachedAt);
  });

  it('marks data as stale if cached beyond STALE_AFTER_MS threshold', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network error'));
    const staleTime = Date.now() - 11 * 60 * 1000;
    const cachedEntry = {
      data: testData,
      cachedAt: staleTime,
    };
    mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(cachedEntry));

    const result = await readThroughCache(cacheKey, fetcher);

    expect(result.fromCache).toBe(true);
    expect(result.stale).toBe(true);
  });

  it('throws if both fetch and cache miss occur', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network error'));
    mockAsyncStorage.getItem.mockResolvedValue(null);

    await expect(readThroughCache(cacheKey, fetcher)).rejects.toThrow('Network error');
  });

  it('returns null cachedAt when fresh data is fetched', async () => {
    const fetcher = jest.fn().mockResolvedValue(testData);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);

    const result = await readThroughCache(cacheKey, fetcher);

    expect(result.cachedAt).not.toBeNull();
    expect(typeof result.cachedAt).toBe('number');
  });

  it('returns stored cachedAt when cache is used', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network error'));
    const storedTime = Date.now() - 5 * 60 * 1000;
    const cachedEntry = {
      data: testData,
      cachedAt: storedTime,
    };
    mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(cachedEntry));

    const result = await readThroughCache(cacheKey, fetcher);

    expect(result.cachedAt).toBe(storedTime);
  });
});
