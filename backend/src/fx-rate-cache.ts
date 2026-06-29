import NodeCache from 'node-cache';
import axios from 'axios';
import { EventEmitter } from 'events';

// Lazily resolved to avoid circular import — set by fx-rate-websocket.ts initialisation
let _fxRateEvents: EventEmitter | null = null;
export function setFxRateEventBus(emitter: EventEmitter): void {
  _fxRateEvents = emitter;
}

export interface FxRateResponse {
  from: string;
  to: string;
  rate: number;
  timestamp: Date;
  provider: string;
  cached: boolean;
  /** True when the rate is served from a stale cache entry due to a provider error (e.g. 429) */
  stale?: boolean;
  /** Age in seconds of a stale rate served during provider fallback */
  stale_age_seconds?: number;
}

export interface FxRateCacheOptions {
  ttlSeconds?: number;
  checkPeriodSeconds?: number;
  refreshBeforeExpirySeconds?: number;
  externalApiUrl?: string;
  secondaryApiUrl?: string;
  externalApiKey?: string;
  staleAgeWarningThresholdSeconds?: number;
}

export class FxRateCache {
  private cache: NodeCache;
  /** Stale-only store: survives TTL expiry, used as 429 fallback */
  private staleCache: Map<string, FxRateResponse>;
  private ttlSeconds: number;
  private refreshBeforeExpirySeconds: number;
  private externalApiUrl: string;
  private secondaryApiUrl?: string;
  private externalApiKey: string;
  private staleAgeWarningThresholdSeconds: number;
  private refreshTimers: Map<string, NodeJS.Timeout>;
  private inflight: Map<string, Promise<FxRateResponse>>;

  constructor(options: FxRateCacheOptions = {}) {
    this.ttlSeconds = options.ttlSeconds || 60;
    this.refreshBeforeExpirySeconds = options.refreshBeforeExpirySeconds || 10;
    this.externalApiUrl = options.externalApiUrl || process.env.FX_API_URL || 'https://api.exchangerate-api.com/v4/latest';
    this.secondaryApiUrl = options.secondaryApiUrl || process.env.FX_SECONDARY_API_URL;
    this.externalApiKey = options.externalApiKey || process.env.FX_API_KEY || '';
    this.refreshTimers = new Map();
    this.staleCache = new Map();
    this.inflight = new Map();

    this.cache = new NodeCache({
      stdTTL: this.ttlSeconds,
      checkperiod: options.checkPeriodSeconds || 120,
      useClones: false,
    });

    this.staleAgeWarningThresholdSeconds = options.staleAgeWarningThresholdSeconds ?? 60;

    // Listen for cache expiry events
    this.cache.on('expired', (key: string) => {
      this.clearRefreshTimer(key);
    });
  }

  setMetricsObserver(observer: (from: string, to: string, stalenessSeconds: number) => void): void {
    this.metricsObserver = observer;
  }

  /**
   * Get current FX rate with caching.
   * On provider 429, returns the last known stale rate with `stale: true`.
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

    // Cache miss - deduplicate concurrent requests for the same pair
    if (!this.inflight.has(cacheKey)) {
      const fetch = this.fetchFromExternalApi(fromUpper, toUpper).then(rate => {
        this.cache.set(cacheKey, rate);
        this.staleCache.set(cacheKey, rate);
        this.scheduleBackgroundRefresh(cacheKey, fromUpper, toUpper);
        _fxRateEvents?.emit('rate_updated', rate);
        return rate;
      }).finally(() => {
        this.inflight.delete(cacheKey);
      });
      this.inflight.set(cacheKey, fetch);
    }

    try {
      const rate = await this.inflight.get(cacheKey)!;
      return { ...rate, cached: false };
    } catch (error) {
      // On 429, serve stale rate if available
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const stale = this.staleCache.get(cacheKey);
        if (stale) {
          const staleAgeSeconds = this.getStaleAgeSeconds(stale);
          const message = `FX provider rate-limited (429) for ${fromUpper}/${toUpper}; serving stale rate (${staleAgeSeconds}s old)`;
          if (staleAgeSeconds >= this.staleAgeWarningThresholdSeconds) {
            console.warn(message);
          } else {
            console.info(message);
          }
          // Schedule a jittered background retry so all pairs don't hammer the API simultaneously
          this.scheduleJitteredRetry(cacheKey, fromUpper, toUpper);
          return { ...stale, cached: true, stale: true, stale_age_seconds: staleAgeSeconds };
        }
      }
      throw error;
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

      return {
        from,
        to,
        rate: parseFloat(rate),
        timestamp: new Date(),
        provider: 'ExchangeRateAPI',
        cached: false,
      };
    } catch (error) {
      // Re-throw axios errors as-is so callers can inspect the status code (e.g. 429)
      if (axios.isAxiosError(error)) {
        throw error;
      }
      console.error(`Failed to fetch FX rate for ${from}/${to}:`, error);
      throw new Error(`Failed to fetch FX rate: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  private getStaleAgeSeconds(stale: FxRateResponse): number {
    return Math.max(0, Math.floor((Date.now() - new Date(stale.timestamp).getTime()) / 1000));
  }

  private scheduleBackgroundRefresh(cacheKey: string, from: string, to: string): void {
    this.clearRefreshTimer(cacheKey);

    const refreshInMs = (this.ttlSeconds - this.refreshBeforeExpirySeconds) * 1000;

    if (refreshInMs > 0) {
      const timer = setTimeout(async () => {
        try {
          const rate = await this.fetchFromProviders(from, to);
          this.cache.set(cacheKey, rate);
          this.staleCache.set(cacheKey, rate);
          _fxRateEvents?.emit('rate_updated', rate);
          // Schedule next refresh
          this.scheduleBackgroundRefresh(cacheKey, from, to);
        } catch (error) {
          console.error(`Background refresh failed for ${cacheKey}:`, error);
        }
      }, refreshInMs);

      this.refreshTimers.set(cacheKey, timer);
    }
  }

  /**
   * Schedule a jittered retry after a 429 response to avoid thundering herd.
   * Retries after 60–120 s (base 60 s + up to 60 s random jitter).
   */
  private scheduleJitteredRetry(cacheKey: string, from: string, to: string): void {
    if (this.refreshTimers.has(cacheKey)) return; // already scheduled
    const jitterMs = 60_000 + Math.random() * 60_000;
    const timer = setTimeout(async () => {
      this.refreshTimers.delete(cacheKey);
      try {
        const rate = await this.fetchFromExternalApi(from, to);
        this.cache.set(cacheKey, rate);
        this.staleCache.set(cacheKey, rate);
        this.scheduleBackgroundRefresh(cacheKey, from, to);
      } catch (error) {
        console.error(`Jittered retry failed for ${cacheKey}:`, error);
      }
    }, jitterMs);
    this.refreshTimers.set(cacheKey, timer);
  }

  /**
   * Clear refresh timer for a cache key
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
    this.staleCache.clear();
    this.refreshTimers.forEach(timer => clearTimeout(timer));
    this.refreshTimers.clear();
    this.inflight.clear();
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
