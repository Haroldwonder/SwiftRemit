import { describe, it, expect, beforeEach } from 'vitest';
import { validateAnalyticsParams, buildCacheKey, getCached, setCache, clearCache, MAX_RANGE_DAYS, VALID_GRANULARITIES } from './analyticsGuard';

describe('Analytics Guards (SR-055)', () => {
  describe('validateAnalyticsParams', () => {
    it('accepts valid bounded range', () => {
      const result = validateAnalyticsParams('2025-01-01', '2025-02-01', 'day');
      expect(result.start).toBeInstanceOf(Date);
      expect(result.end).toBeInstanceOf(Date);
      expect(result.granularity).toBe('day');
    });

    it('rejects missing dates', () => {
      expect(() => validateAnalyticsParams(undefined, '2025-02-01', 'day')).toThrow('required');
      expect(() => validateAnalyticsParams('2025-01-01', undefined, 'day')).toThrow('required');
    });

    it('rejects invalid date format', () => {
      expect(() => validateAnalyticsParams('not-a-date', '2025-02-01', 'day')).toThrow('Invalid date');
    });

    it('rejects end before start', () => {
      expect(() => validateAnalyticsParams('2025-02-01', '2025-01-01', 'day')).toThrow('after');
    });

    it(`rejects range exceeding ${MAX_RANGE_DAYS} days`, () => {
      expect(() => validateAnalyticsParams('2025-01-01', '2025-12-31', 'day')).toThrow('exceed');
    });

    it('rejects invalid granularity', () => {
      expect(() => validateAnalyticsParams('2025-01-01', '2025-02-01', 'second')).toThrow('granularity');
    });

    it('defaults granularity to day', () => {
      const result = validateAnalyticsParams('2025-01-01', '2025-02-01', undefined);
      expect(result.granularity).toBe('day');
    });

    it('accepts all valid granularities', () => {
      for (const gran of VALID_GRANULARITIES) {
        const result = validateAnalyticsParams('2025-01-01', '2025-02-01', gran);
        expect(result.granularity).toBe(gran);
      }
    });
  });

  describe('Caching', () => {
    beforeEach(() => clearCache());

    it('returns null for cache miss', () => {
      expect(getCached('nonexistent')).toBeNull();
    });

    it('stores and retrieves cached data', () => {
      setCache('key1', { corridors: ['US-MX'] });
      expect(getCached('key1')).toEqual({ corridors: ['US-MX'] });
    });

    it('expires entries after TTL', async () => {
      setCache('key2', 'data', 50); // 50ms TTL
      expect(getCached('key2')).toBe('data');
      await new Promise(r => setTimeout(r, 60));
      expect(getCached('key2')).toBeNull();
    });

    it('builds normalised cache keys', () => {
      const k1 = buildCacheKey('/analytics', { end: '2025-02-01', start: '2025-01-01' });
      const k2 = buildCacheKey('/analytics', { start: '2025-01-01', end: '2025-02-01' });
      expect(k1).toBe(k2); // Sorted params
    });
  });
});
