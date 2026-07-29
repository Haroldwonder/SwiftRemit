/**
 * Analytics query guards: bounded time range and response caching.
 * SR-055
 */
import { Request, Response, NextFunction } from 'express';

export const MAX_RANGE_DAYS = 90;
export const VALID_GRANULARITIES = ['hour', 'day', 'week', 'month'] as const;
export const CACHE_TTL_MS = 60_000; // 1 minute

export type Granularity = typeof VALID_GRANULARITIES[number];

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Validate that the time range is bounded and granularity is valid.
 */
export function validateAnalyticsParams(
  startDate: string | undefined,
  endDate: string | undefined,
  granularity: string | undefined,
): { start: Date; end: Date; granularity: Granularity } {
  if (!startDate || !endDate) {
    throw Object.assign(new Error('start_date and end_date are required'), {
      statusCode: 400,
      code: 'MISSING_DATE_RANGE',
    });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw Object.assign(new Error('Invalid date format'), {
      statusCode: 400,
      code: 'INVALID_DATE',
    });
  }

  if (end <= start) {
    throw Object.assign(new Error('end_date must be after start_date'), {
      statusCode: 400,
      code: 'INVALID_RANGE',
    });
  }

  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_RANGE_DAYS) {
    throw Object.assign(new Error(`Time range cannot exceed ${MAX_RANGE_DAYS} days`), {
      statusCode: 400,
      code: 'RANGE_TOO_LARGE',
    });
  }

  const gran = (granularity || 'day') as Granularity;
  if (!VALID_GRANULARITIES.includes(gran)) {
    throw Object.assign(
      new Error(`Invalid granularity. Must be one of: ${VALID_GRANULARITIES.join(', ')}`),
      { statusCode: 400, code: 'INVALID_GRANULARITY' },
    );
  }

  return { start, end, granularity: gran };
}

/**
 * Build a normalised cache key from query params.
 */
export function buildCacheKey(path: string, params: Record<string, string>): string {
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  return `${path}?${sorted.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

/**
 * Get a cached response if available and not expired.
 */
export function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Store a response in the cache with TTL.
 */
export function setCache(key: string, data: unknown, ttlMs: number = CACHE_TTL_MS): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Clear the analytics cache.
 */
export function clearCache(): void {
  cache.clear();
}
