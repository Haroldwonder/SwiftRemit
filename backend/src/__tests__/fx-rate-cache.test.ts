import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FxRateCache, resetFxRateCache } from '../fx-rate-cache';
import axios from 'axios';

vi.mock('axios');

describe('FxRateCache', () => {
  let cache: FxRateCache;

  beforeEach(() => {
    vi.clearAllMocks();
    resetFxRateCache();
  });

  afterEach(() => {
    if (cache) {
      cache.close();
    }
  });

  describe('getCurrentRate', () => {
    it('fetches rate from external API on cache miss', async () => {
      const mockResponse = {
        data: {
          rates: {
            PHP: 56.25,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

      cache = new FxRateCache({ ttlSeconds: 60 });
      const result = await cache.getCurrentRate('USD', 'PHP');

      expect(result.from).toBe('USD');
      expect(result.to).toBe('PHP');
      expect(result.rate).toBe(56.25);
      expect(result.cached).toBe(false);
      expect(result.provider).toBe('ExchangeRateAPI');
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('returns cached rate on cache hit', async () => {
      const mockResponse = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

      cache = new FxRateCache({ ttlSeconds: 60 });

      // First call - cache miss
      const result1 = await cache.getCurrentRate('USD', 'EUR');
      expect(result1.cached).toBe(false);
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result2 = await cache.getCurrentRate('USD', 'EUR');
      expect(result2.cached).toBe(true);
      expect(result2.rate).toBe(0.85);
      expect(axios.get).toHaveBeenCalledTimes(1); // No additional API call
    });

    it('normalizes currency codes to uppercase', async () => {
      const mockResponse = {
        data: {
          rates: {
            GBP: 0.75,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

      cache = new FxRateCache({ ttlSeconds: 60 });
      const result = await cache.getCurrentRate('usd', 'gbp');

      expect(result.from).toBe('USD');
      expect(result.to).toBe('GBP');
      expect(result.rate).toBe(0.75);
    });

    it('throws error when rate not found in API response', async () => {
      const mockResponse = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

      cache = new FxRateCache({ ttlSeconds: 60 });

      await expect(cache.getCurrentRate('USD', 'XYZ')).rejects.toThrow('Rate not found for USD/XYZ');
    });

    it('throws error when external API fails', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'));

      cache = new FxRateCache({ ttlSeconds: 60 });

      await expect(cache.getCurrentRate('USD', 'EUR')).rejects.toThrow('Failed to fetch FX rate');
    });

    it('returns stale rate with stale:true on 429 when cache entry exists', async () => {
      const mockResponse = { data: { rates: { EUR: 0.85 } } };
      const rateLimitError = Object.assign(new Error('Too Many Requests'), {
        isAxiosError: true,
        response: { status: 429 },
      });
      // Make axios.isAxiosError return true for our error
      vi.spyOn(axios, 'isAxiosError').mockImplementation((e) => (e as any).isAxiosError === true);

      vi.mocked(axios.get)
        .mockResolvedValueOnce(mockResponse)  // first call succeeds → populates stale cache
        .mockRejectedValueOnce(rateLimitError); // second call (after invalidate) → 429

      cache = new FxRateCache({ ttlSeconds: 60 });

      // Populate stale cache
      await cache.getCurrentRate('USD', 'EUR');
      // Evict live cache so next call hits the API
      cache.invalidate('USD', 'EUR');

      const result = await cache.getCurrentRate('USD', 'EUR');
      expect(result.stale).toBe(true);
      expect(result.cached).toBe(true);
      expect(result.rate).toBe(0.85);
    });

    it('throws on 429 when no stale entry exists', async () => {
      const rateLimitError = Object.assign(new Error('Too Many Requests'), {
        isAxiosError: true,
        response: { status: 429 },
      });
      vi.spyOn(axios, 'isAxiosError').mockImplementation((e) => (e as any).isAxiosError === true);
      vi.mocked(axios.get).mockRejectedValueOnce(rateLimitError);

      cache = new FxRateCache({ ttlSeconds: 60 });

      // No stale entry → the original axios error is re-thrown
      await expect(cache.getCurrentRate('USD', 'EUR')).rejects.toMatchObject({ isAxiosError: true });
    });

    it('includes API key in request headers when provided', async () => {
      const mockResponse = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

      cache = new FxRateCache({ 
        ttlSeconds: 60,
        externalApiKey: 'test-api-key',
      });

      await cache.getCurrentRate('USD', 'EUR');

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-api-key',
          },
        })
      );
    });
  });

  describe('cache expiry', () => {
    it('expires cache after TTL', async () => {
      const mockResponse = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValue(mockResponse);

      cache = new FxRateCache({ ttlSeconds: 1 }); // 1 second TTL

      // First call
      await cache.getCurrentRate('USD', 'EUR');
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Second call after expiry
      await cache.getCurrentRate('USD', 'EUR');
      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('background refresh', () => {
    it('schedules background refresh before expiry', async () => {
      const mockResponse = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValue(mockResponse);

      cache = new FxRateCache({ 
        ttlSeconds: 10,
        refreshBeforeExpirySeconds: 5,
      });

      await cache.getCurrentRate('USD', 'EUR');
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Wait for background refresh (should happen at 5 seconds)
      await new Promise(resolve => setTimeout(resolve, 5500));

      expect(axios.get).toHaveBeenCalledTimes(2);
    }, 10000); // Increase timeout to 10 seconds

    it('does not reschedule refresh on background fetch error', async () => {
      const mockResponse = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      vi.mocked(axios.get)
        .mockResolvedValueOnce(mockResponse)
        .mockRejectedValueOnce(new Error('Network error'));

      cache = new FxRateCache({ 
        ttlSeconds: 2,
        refreshBeforeExpirySeconds: 1,
      });

      await cache.getCurrentRate('USD', 'EUR');
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Wait for background refresh attempt
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Should have attempted refresh but failed
      expect(axios.get).toHaveBeenCalledTimes(2);

      // Wait more - should not retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidate', () => {
    it('removes rate from cache', async () => {
      const mockResponse = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValue(mockResponse);

      cache = new FxRateCache({ ttlSeconds: 60 });

      // Cache the rate
      await cache.getCurrentRate('USD', 'EUR');
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Invalidate
      cache.invalidate('USD', 'EUR');

      // Next call should fetch again
      await cache.getCurrentRate('USD', 'EUR');
      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearAll', () => {
    it('clears all cached rates', async () => {
      const mockResponse1 = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      const mockResponse2 = {
        data: {
          rates: {
            GBP: 0.75,
          },
        },
      };

      vi.mocked(axios.get)
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      cache = new FxRateCache({ ttlSeconds: 60 });

      // Cache two rates
      await cache.getCurrentRate('USD', 'EUR');
      await cache.getCurrentRate('USD', 'GBP');
      expect(axios.get).toHaveBeenCalledTimes(2);

      // Clear all
      cache.clearAll();

      // Both should fetch again
      await cache.getCurrentRate('USD', 'EUR');
      await cache.getCurrentRate('USD', 'GBP');
      expect(axios.get).toHaveBeenCalledTimes(4);
    });
  });

  describe('getStats', () => {
    it('returns cache statistics', async () => {
      const mockResponse = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValue(mockResponse);

      cache = new FxRateCache({ ttlSeconds: 60 });

      await cache.getCurrentRate('USD', 'EUR');
      await cache.getCurrentRate('USD', 'EUR'); // Cache hit

      const stats = cache.getStats();
      expect(stats.keys).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('custom API URL', () => {
    it('uses custom API URL when provided', async () => {
      const mockResponse = {
        data: {
          rates: {
            EUR: 0.85,
          },
        },
      };

      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

      cache = new FxRateCache({ 
        ttlSeconds: 60,
        externalApiUrl: 'https://custom-api.com/rates',
      });

      await cache.getCurrentRate('USD', 'EUR');

      expect(axios.get).toHaveBeenCalledWith(
        'https://custom-api.com/rates/USD',
        expect.any(Object)
      );
    });
  });
});
