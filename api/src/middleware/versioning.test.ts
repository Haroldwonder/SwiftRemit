import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractVersion, CURRENT_VERSION, deprecationMiddleware, registerDeprecation, getDeprecations } from './versioning';

describe('API Versioning (SR-056)', () => {
  describe('extractVersion', () => {
    const mockReq = (path: string, headers: Record<string, string> = {}) =>
      ({ path, headers } as any);

    it('extracts version from URL prefix', () => {
      expect(extractVersion(mockReq('/v1/remittances'))).toBe('v1');
      expect(extractVersion(mockReq('/v2/anchors'))).toBe('v2');
    });

    it('falls back to Accept-Version header', () => {
      expect(extractVersion(mockReq('/remittances', { 'accept-version': 'v2' }))).toBe('v2');
    });

    it('defaults to current version when no version specified', () => {
      expect(extractVersion(mockReq('/remittances'))).toBe(CURRENT_VERSION);
    });
  });

  describe('deprecationMiddleware', () => {
    beforeEach(() => {
      // Clear registry between tests
      getDeprecations().length = 0;
    });

    it('sets Deprecation and Sunset headers for deprecated paths', () => {
      registerDeprecation({
        path: '/v1/old-endpoint',
        deprecatedAt: '2025-01-01',
        sunsetAt: '2026-01-01',
        replacement: '/v2/new-endpoint',
      });

      const req = { path: '/v1/old-endpoint' } as any;
      const setHeader = vi.fn();
      const res = { setHeader } as any;
      const next = vi.fn();

      deprecationMiddleware(req, res, next);

      expect(setHeader).toHaveBeenCalledWith('Deprecation', 'date="2025-01-01"');
      expect(setHeader).toHaveBeenCalledWith('Sunset', '2026-01-01');
      expect(setHeader).toHaveBeenCalledWith('Link', '</v2/new-endpoint>; rel="successor-version"');
      expect(next).toHaveBeenCalled();
    });

    it('does not set headers for non-deprecated paths', () => {
      const req = { path: '/v1/active-endpoint' } as any;
      const setHeader = vi.fn();
      const res = { setHeader } as any;
      const next = vi.fn();

      deprecationMiddleware(req, res, next);
      expect(setHeader).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('deprecation registry', () => {
    it('tracks registered deprecations', () => {
      const before = getDeprecations().length;
      registerDeprecation({
        path: '/test',
        deprecatedAt: '2025-06-01',
        sunsetAt: '2026-06-01',
      });
      expect(getDeprecations().length).toBe(before + 1);
    });
  });
});
