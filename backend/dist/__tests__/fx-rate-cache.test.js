"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fx_rate_cache_1 = require("../fx-rate-cache");
const axios_1 = __importDefault(require("axios"));
vitest_1.vi.mock('axios');
(0, vitest_1.describe)('FxRateCache', () => {
    let cache;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        (0, fx_rate_cache_1.resetFxRateCache)();
    });
    (0, vitest_1.afterEach)(() => {
        if (cache) {
            cache.close();
        }
    });
    (0, vitest_1.describe)('getCurrentRate', () => {
        (0, vitest_1.it)('fetches rate from external API on cache miss', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        PHP: 56.25,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValueOnce(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 60 });
            const result = await cache.getCurrentRate('USD', 'PHP');
            (0, vitest_1.expect)(result.from).toBe('USD');
            (0, vitest_1.expect)(result.to).toBe('PHP');
            (0, vitest_1.expect)(result.rate).toBe(56.25);
            (0, vitest_1.expect)(result.cached).toBe(false);
            (0, vitest_1.expect)(result.provider).toBe('ExchangeRateAPI');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(1);
        });
        (0, vitest_1.it)('returns cached rate on cache hit', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValueOnce(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 60 });
            // First call - cache miss
            const result1 = await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(result1.cached).toBe(false);
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(1);
            // Second call - cache hit
            const result2 = await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(result2.cached).toBe(true);
            (0, vitest_1.expect)(result2.rate).toBe(0.85);
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(1); // No additional API call
        });
        (0, vitest_1.it)('normalizes currency codes to uppercase', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        GBP: 0.75,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValueOnce(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 60 });
            const result = await cache.getCurrentRate('usd', 'gbp');
            (0, vitest_1.expect)(result.from).toBe('USD');
            (0, vitest_1.expect)(result.to).toBe('GBP');
            (0, vitest_1.expect)(result.rate).toBe(0.75);
        });
        (0, vitest_1.it)('throws error when rate not found in API response', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValueOnce(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 60 });
            await (0, vitest_1.expect)(cache.getCurrentRate('USD', 'XYZ')).rejects.toThrow('Rate not found for USD/XYZ');
        });
        (0, vitest_1.it)('falls back to the secondary provider before using the last known rate', async () => {
            vitest_1.vi.mocked(axios_1.default.get)
                .mockRejectedValueOnce(new Error('primary down'))
                .mockResolvedValueOnce({
                data: {
                    rates: {
                        PHP: 60.5,
                    },
                },
            });
            cache = new fx_rate_cache_1.FxRateCache({
                ttlSeconds: 60,
                secondaryApiUrl: 'https://secondary.example/rates',
            });
            const result = await cache.getCurrentRate('USD', 'PHP');
            (0, vitest_1.expect)(result.rate).toBe(60.5);
            (0, vitest_1.expect)(result.fx_rate_source).toBe('secondary');
            (0, vitest_1.expect)(result.stale).toBe(false);
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(2);
        });
        (0, vitest_1.it)('uses the last known rate when both providers fail and marks it stale', async () => {
            vitest_1.vi.mocked(axios_1.default.get)
                .mockResolvedValueOnce({
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            })
                .mockRejectedValue(new Error('network unavailable'));
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 1 });
            await cache.getCurrentRate('USD', 'EUR');
            await new Promise(resolve => setTimeout(resolve, 1100));
            const result = await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(result.rate).toBe(0.85);
            (0, vitest_1.expect)(result.fx_rate_source).toBe('last_known');
            (0, vitest_1.expect)(result.stale).toBe(true);
            (0, vitest_1.expect)(result.stalenessSeconds).toBeGreaterThan(0);
        });
        (0, vitest_1.it)('throws error when external API fails', async () => {
            vitest_1.vi.mocked(axios_1.default.get).mockRejectedValueOnce(new Error('Network error'));
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 60 });
            await (0, vitest_1.expect)(cache.getCurrentRate('USD', 'EUR')).rejects.toThrow('Failed to fetch FX rate');
        });
        (0, vitest_1.it)('includes API key in request headers when provided', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValueOnce(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({
                ttlSeconds: 60,
                externalApiKey: 'test-api-key',
            });
            await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledWith(vitest_1.expect.any(String), vitest_1.expect.objectContaining({
                headers: {
                    Authorization: 'Bearer test-api-key',
                },
            }));
        });
    });
    (0, vitest_1.describe)('cache expiry', () => {
        (0, vitest_1.it)('expires cache after TTL', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValue(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 1 }); // 1 second TTL
            // First call
            await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(1);
            // Wait for cache to expire
            await new Promise(resolve => setTimeout(resolve, 1100));
            // Second call after expiry
            await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(2);
        });
    });
    (0, vitest_1.describe)('background refresh', () => {
        (0, vitest_1.it)('schedules background refresh before expiry', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValue(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({
                ttlSeconds: 10,
                refreshBeforeExpirySeconds: 5,
            });
            await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(1);
            // Wait for background refresh (should happen at 5 seconds)
            await new Promise(resolve => setTimeout(resolve, 5500));
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(2);
        }, 10000); // Increase timeout to 10 seconds
        (0, vitest_1.it)('does not reschedule refresh on background fetch error', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get)
                .mockResolvedValueOnce(mockResponse)
                .mockRejectedValueOnce(new Error('Network error'));
            cache = new fx_rate_cache_1.FxRateCache({
                ttlSeconds: 2,
                refreshBeforeExpirySeconds: 1,
            });
            await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(1);
            // Wait for background refresh attempt
            await new Promise(resolve => setTimeout(resolve, 1500));
            // Should have attempted refresh but failed
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(2);
            // Wait more - should not retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(2);
        });
    });
    (0, vitest_1.describe)('invalidate', () => {
        (0, vitest_1.it)('removes rate from cache', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValue(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 60 });
            // Cache the rate
            await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(1);
            // Invalidate
            cache.invalidate('USD', 'EUR');
            // Next call should fetch again
            await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(2);
        });
    });
    (0, vitest_1.describe)('clearAll', () => {
        (0, vitest_1.it)('clears all cached rates', async () => {
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
            vitest_1.vi.mocked(axios_1.default.get)
                .mockResolvedValueOnce(mockResponse1)
                .mockResolvedValueOnce(mockResponse2)
                .mockResolvedValueOnce(mockResponse1)
                .mockResolvedValueOnce(mockResponse2);
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 60 });
            // Cache two rates
            await cache.getCurrentRate('USD', 'EUR');
            await cache.getCurrentRate('USD', 'GBP');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(2);
            // Clear all
            cache.clearAll();
            // Both should fetch again
            await cache.getCurrentRate('USD', 'EUR');
            await cache.getCurrentRate('USD', 'GBP');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledTimes(4);
        });
    });
    (0, vitest_1.describe)('getStats', () => {
        (0, vitest_1.it)('returns cache statistics', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValue(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({ ttlSeconds: 60 });
            await cache.getCurrentRate('USD', 'EUR');
            await cache.getCurrentRate('USD', 'EUR'); // Cache hit
            const stats = cache.getStats();
            (0, vitest_1.expect)(stats.keys).toBe(1);
            (0, vitest_1.expect)(stats.hits).toBe(1);
            (0, vitest_1.expect)(stats.misses).toBe(1);
        });
    });
    (0, vitest_1.describe)('custom API URL', () => {
        (0, vitest_1.it)('uses custom API URL when provided', async () => {
            const mockResponse = {
                data: {
                    rates: {
                        EUR: 0.85,
                    },
                },
            };
            vitest_1.vi.mocked(axios_1.default.get).mockResolvedValueOnce(mockResponse);
            cache = new fx_rate_cache_1.FxRateCache({
                ttlSeconds: 60,
                externalApiUrl: 'https://custom-api.com/rates',
            });
            await cache.getCurrentRate('USD', 'EUR');
            (0, vitest_1.expect)(axios_1.default.get).toHaveBeenCalledWith('https://custom-api.com/rates/USD', vitest_1.expect.any(Object));
        });
    });
});
