import NodeCache from 'node-cache';
import axios from 'axios';

export interface FxRateResponse {
  from: string;
  to: string;
  rate: number;
  timestamp: Date;
  provider: string;
  cached: boolean;
  fx_rate_source?: string;
  stale?: boolean;
  stalenessSeconds?: number;
}

export interface FxRateCacheOptions {
  ttlSeconds?: number;
  checkPeriodSeconds?: number;
  refreshBeforeExpirySeconds?: number;
  externalApiUrl?: string;
  secondaryApiUrl?: string;
  externalApiKey?: string;
  maxStalenessSeconds?: number;
}

export class FxRateCache {
  private cache: NodeCache;
  private ttlSeconds: number;
  private refreshBeforeExpirySeconds: number;
  private externalApiUrl: string;
  private secondaryApiUrl?: string;
  private externalApiKey: string;
  private refreshTimers: Map<string, NodeJS.Timeout>;
  private lastKnownRates: Map<string, FxRateResponse>;
  private metricsObserver?: (from: string, to: string, stalenessSeconds: number) => void;

  constructor(options: FxRateCacheOptions = {}) {
    this.ttlSeconds = options.ttlSeconds || 60;
    this.refreshBeforeExpirySeconds = options.refreshBeforeExpirySeconds || 10;
    this.externalApiUrl = options.externalApiUrl || process.env.FX_API_URL || 'https://api.exchangerate-api.com/v4/latest';
    this.secondaryApiUrl = options.secondaryApiUrl || process.env.FX_SECONDARY_API_URL;
    this.externalApiKey = options.externalApiKey || process.env.FX_API_KEY || '';
    this.refreshTimers = new Map();
    this.lastKnownRates = new Map();

    this.cache = new NodeCache({
      stdTTL: this.ttlSeconds,
      checkperiod: options.checkPeriodSeconds || 120,
      useClones: false,
    });

    this.cache.on('expired', (key: string) => {
      this.clearRefreshTimer(key);
    });
  }

  setMetricsObserver(observer: (from: string, to: string, stalenessSeconds: number) => void): void {
    this.metricsObserver = observer;
  }

  /**
   * Get current FX rate with caching and deterministic fallback.
   */
  async getCurrentRate(from: string, to: string): Promise<FxRateResponse> {
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();
    const cacheKey = this.getCacheKey(fromUpper, toUpper);

    const cached = this.cache.get<FxRateResponse>(cacheKey);
    if (cached) {
      const response = {
        ...cached,
        cached: true,
        stale: false,
        stalenessSeconds: 0,
        fx_rate_source: cached.fx_rate_source || cached.provider || 'primary',
      };
      this.reportStaleness(fromUpper, toUpper, 0);
      return response;
    }

    const lastKnown = this.lastKnownRates.get(cacheKey);

    try {
      const rate = await this.fetchFromProviders(fromUpper, toUpper);
      this.cache.set(cacheKey, rate);
      this.lastKnownRates.set(cacheKey, rate);
      this.scheduleBackgroundRefresh(cacheKey, fromUpper, toUpper);

      const response = { ...rate, cached: false, stale: false, stalenessSeconds: 0 };
      this.reportStaleness(fromUpper, toUpper, 0);
      return response;
    } catch (error) {
      if (lastKnown) {
        const stalenessSeconds = Math.max(0, Math.floor((Date.now() - new Date(lastKnown.timestamp).getTime()) / 1000));
        const response = {
          ...lastKnown,
          cached: true,
          stale: true,
          fx_rate_source: 'last_known',
          stalenessSeconds,
        };
        this.reportStaleness(fromUpper, toUpper, stalenessSeconds);
        return response;
      }

      console.error(`Failed to fetch FX rate for ${fromUpper}/${toUpper}:`, error);
      throw new Error(`Failed to fetch FX rate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Try the configured providers in order: primary, secondary, then fail.
   */
  private async fetchFromProviders(from: string, to: string): Promise<FxRateResponse> {
    const providers = [{ name: 'primary', url: this.externalApiUrl }];
    if (this.secondaryApiUrl) {
      providers.push({ name: 'secondary', url: this.secondaryApiUrl });
    }

    let lastError: Error | undefined;
    for (const provider of providers) {
      try {
        return await this.fetchFromProvider(from, to, provider.url, provider.name);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }
    }

    throw lastError || new Error('Failed to fetch FX rate');
  }

  /**
   * Fetch rate from a specific FX provider.
   */
  private async fetchFromProvider(from: string, to: string, url: string, providerName: string): Promise<FxRateResponse> {
    const headers: Record<string, string> = {};

    if (this.externalApiKey) {
      headers['Authorization'] = `Bearer ${this.externalApiKey}`;
    }

    const response = await axios.get(`${url}/${from}`, {
      headers,
      timeout: 5000,
    });

    const rates = response.data.rates || {};
    const rate = rates[to];

    if (!rate) {
      throw new Error(`Rate not found for ${from}/${to}`);
    }

    return {
      from,
      to,
      rate: parseFloat(rate),
      timestamp: new Date(),
      provider: providerName === 'primary' ? 'ExchangeRateAPI' : 'secondary',
      cached: false,
      fx_rate_source: providerName,
      stale: false,
      stalenessSeconds: 0,
    };
  }

  /**
   * Schedule background refresh before cache expires.
   */
  private scheduleBackgroundRefresh(cacheKey: string, from: string, to: string): void {
    this.clearRefreshTimer(cacheKey);

    const refreshInMs = (this.ttlSeconds - this.refreshBeforeExpirySeconds) * 1000;

    if (refreshInMs > 0) {
      const timer = setTimeout(async () => {
        try {
          const rate = await this.fetchFromProviders(from, to);
          this.cache.set(cacheKey, rate);
          this.lastKnownRates.set(cacheKey, rate);
          this.scheduleBackgroundRefresh(cacheKey, from, to);
        } catch (error) {
          console.error(`Background refresh failed for ${cacheKey}:`, error);
        }
      }, refreshInMs);

      this.refreshTimers.set(cacheKey, timer);
    }
  }

  /**
   * Clear refresh timer for a cache key.
   */
  private clearRefreshTimer(cacheKey: string): void {
    const timer = this.refreshTimers.get(cacheKey);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(cacheKey);
    }
  }

  private reportStaleness(from: string, to: string, stalenessSeconds: number): void {
    this.metricsObserver?.(from, to, stalenessSeconds);
  }

  /**
   * Generate cache key from currency pair.
   */
  private getCacheKey(from: string, to: string): string {
    return `fx:${from.toUpperCase()}:${to.toUpperCase()}`;
  }

  /**
   * Manually invalidate cache for a currency pair.
   */
  invalidate(from: string, to: string): void {
    const cacheKey = this.getCacheKey(from, to);
    this.cache.del(cacheKey);
    this.lastKnownRates.delete(cacheKey);
    this.clearRefreshTimer(cacheKey);
  }

  /**
   * Clear all cached rates.
   */
  clearAll(): void {
    this.cache.flushAll();
    this.lastKnownRates.clear();
    this.refreshTimers.forEach(timer => clearTimeout(timer));
    this.refreshTimers.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * Close the cache and cleanup.
   */
  close(): void {
    this.clearAll();
    this.cache.close();
  }
}

// Singleton instance
let fxRateCacheInstance: FxRateCache | null = null;

export function getFxRateCache(options?: FxRateCacheOptions): FxRateCache {
  if (!fxRateCacheInstance) {
    fxRateCacheInstance = new FxRateCache(options);
  }
  return fxRateCacheInstance;
}

export function resetFxRateCache(): void {
  if (fxRateCacheInstance) {
    fxRateCacheInstance.close();
    fxRateCacheInstance = null;
  }
}
