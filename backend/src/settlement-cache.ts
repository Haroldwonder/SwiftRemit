import NodeCache from 'node-cache';
import { createLogger } from './correlation-id';

const logger = createLogger('settlement-cache');

/**
 * Settlement simulation result cached structure
 */
export interface SettlementSimulationResult {
  remittanceId: number;
  amount: string;
  asset: string;
  corridor: string;
  fees: {
    platformFee: string;
    integrationFee: string;
    totalFee: string;
  };
  netPayout: string;
  estimatedTime: string;
  timestamp: Date;
}

/**
 * Cache key builder for settlement simulations
 * Keyed by (amount, asset, corridor) tuple
 */
function buildCacheKey(amount: string, asset: string, corridor: string): string {
  return `settlement:${amount}:${asset}:${corridor}`;
}

/**
 * Settlement simulation cache with 30s TTL
 */
class SettlementSimulationCache {
  private cache: NodeCache;
  private readonly ttlSeconds = 30;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor() {
    this.cache = new NodeCache({ stdTTL: this.ttlSeconds, checkperiod: 5 });
  }

  /**
   * Get cached simulation result
   */
  get(amount: string, asset: string, corridor: string): SettlementSimulationResult | null {
    const key = buildCacheKey(amount, asset, corridor);
    const cached = this.cache.get<SettlementSimulationResult>(key);

    if (cached) {
      this.cacheHits++;
      logger.debug('Cache hit', { key, hits: this.cacheHits });
      return cached;
    }

    this.cacheMisses++;
    logger.debug('Cache miss', { key, misses: this.cacheMisses });
    return null;
  }

  /**
   * Set simulation result in cache
   */
  set(
    amount: string,
    asset: string,
    corridor: string,
    result: SettlementSimulationResult
  ): void {
    const key = buildCacheKey(amount, asset, corridor);
    this.cache.set(key, result, this.ttlSeconds);
    logger.debug('Cache set', { key, ttl: this.ttlSeconds });
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const keys = this.cache.keys();
    const hitRate = this.cacheHits + this.cacheMisses > 0
      ? (this.cacheHits / (this.cacheHits + this.cacheMisses) * 100).toFixed(2)
      : 'N/A';

    return {
      entries: keys.length,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: `${hitRate}%`,
      ttl: this.ttlSeconds,
    };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.flushAll();
    logger.info('Cache cleared');
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

// Singleton instance
let instance: SettlementSimulationCache | null = null;

/**
 * Get or create the settlement simulation cache singleton
 */
export function getSettlementSimulationCache(): SettlementSimulationCache {
  if (!instance) {
    instance = new SettlementSimulationCache();
  }
  return instance;
}

/**
 * Middleware to add Cache-Control headers for settlement simulation responses
 */
export function addSettlementCacheHeaders(maxAge = 30) {
  return (req: any, res: any, next: any) => {
    // Override default cache headers for settlement endpoint
    res.set('Cache-Control', `public, max-age=${maxAge}, must-revalidate`);
    res.set('Expires', new Date(Date.now() + maxAge * 1000).toUTCString());
    next();
  };
}

/**
 * Wrapper for settlement simulation with caching
 */
export async function getCachedSettlementSimulation(
  amount: string,
  asset: string,
  corridor: string,
  simulationFn: () => Promise<SettlementSimulationResult>
): Promise<SettlementSimulationResult> {
  const cache = getSettlementSimulationCache();

  // Try cache first
  const cached = cache.get(amount, asset, corridor);
  if (cached) {
    return cached;
  }

  // Simulate if not cached
  const result = await simulationFn();

  // Store in cache
  cache.set(amount, asset, corridor, result);

  return result;
}

/**
 * Metrics for settlement simulation caching
 */
export function getSettlementCacheMetrics(): {
  cache_entries: number;
  cache_hits: number;
  cache_misses: number;
  cache_hit_rate: string;
  cache_ttl_seconds: number;
} {
  const stats = getSettlementSimulationCache().getStats();
  return {
    cache_entries: stats.entries,
    cache_hits: stats.hits,
    cache_misses: stats.misses,
    cache_hit_rate: stats.hitRate,
    cache_ttl_seconds: 30,
  };
}
