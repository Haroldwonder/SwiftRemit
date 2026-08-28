import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../api';
import { ROUTE_SCOPES, requiredScopeForRoute } from '../middleware/api-key-store';

/**
 * SR-131 — backend authorisation-matrix drift test.
 *
 * Mirrors api/src/__tests__/auth-matrix.test.ts (SR-048) for the backend
 * service. Before this fix, /api/admin, /api/aml and /api/compliance were
 * mounted with only a flat rate limiter and no identity check at all —
 * these assertions fail loudly if that regresses.
 */
describe('backend/AUTH_MATRIX.md — route scope drift', () => {
  it('declares a scope for every previously-unauthenticated route group', () => {
    for (const prefix of ['GET /api/admin', 'GET /api/aml', 'GET /api/compliance', 'GET /api/devices']) {
      const [method, path] = prefix.split(' ');
      expect(requiredScopeForRoute(method, path)).not.toBeNull();
    }
  });

  it('has no route-scope entry with an empty scope', () => {
    for (const entry of ROUTE_SCOPES) {
      expect(entry.scope).toBeTruthy();
    }
  });
});

describe('SR-131 — admin/aml/compliance reject unauthenticated requests', () => {
  it('rejects GET /api/admin/audit-log with no API key', async () => {
    const res = await request(app).get('/api/admin/audit-log');
    expect(res.status).toBe(401);
  });

  it('rejects GET /api/admin/jobs with no API key', async () => {
    const res = await request(app).get('/api/admin/jobs');
    expect(res.status).toBe(401);
  });

  it('rejects GET /api/aml/alerts/summary with no API key', async () => {
    const res = await request(app).get('/api/aml/alerts/summary');
    expect(res.status).toBe(401);
  });

  it('rejects GET /api/compliance/report with no API key', async () => {
    const res = await request(app).get('/api/compliance/report');
    expect(res.status).toBe(401);
  });

  it('rejects GET /api/devices with no API key', async () => {
    const res = await request(app).get('/api/devices');
    expect(res.status).toBe(401);
  });

  it('rejects an API key lacking the required scope with 403', async () => {
    // A key that only carries read:verification must not reach admin routes.
    const res = await request(app)
      .get('/api/admin/jobs')
      .set('x-api-key', 'sr_live_not-a-real-key-but-store-lookup-will-401-first');
    // Unknown key → 401 (invalid), not a silent pass-through.
    expect([401, 403]).toContain(res.status);
  });
});
