/**
 * Pact consumer tests — API calling the Backend service (SR-062)
 *
 * The API server makes internal calls to the backend for:
 *   - Admin audit log writes/reads  (POST/GET /internal/audit-log)
 *   - Anchor TOML validation cache invalidation (POST /internal/toml-cache/invalidate)
 *   - Webhook delivery status       (GET /internal/webhooks/:id/status)
 *   - Settlement simulation         (POST /internal/settlements/simulate)
 *
 * These are the server-to-server contracts. The API is the *consumer*,
 * the Backend service is the *provider*.
 *
 * Generated pact file: pacts/SwiftRemitAPI-SwiftRemitBackend.json
 */

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, expect } from 'vitest';

const { like, eachLike, string, integer, boolean: boolM } = MatchersV3;

const PACT_DIR = path.resolve(__dirname, '../../../../../pacts');

const provider = new PactV3({
  consumer: 'SwiftRemitAPI',
  provider: 'SwiftRemitBackend',
  dir: PACT_DIR,
  logLevel: 'warn',
});

async function get(base: string, p: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${p}`, {
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'test-secret', ...headers },
  });
  return { status: res.status, body: await res.json() };
}

async function post(base: string, p: string, body: unknown) {
  const res = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': 'test-secret',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('SwiftRemitAPI→Backend — Pact consumer contract (SR-062)', () => {

  // ── Audit log write ───────────────────────────────────────────────────────

  describe('POST /internal/audit-log', () => {
    it('writes an audit log entry and returns 201', async () => {
      await provider.addInteraction({
        states: [{ description: 'backend audit log service is ready' }],
        uponReceiving: 'API writes simulate-upgrade audit entry',
        withRequest: {
          method: 'POST',
          path: '/internal/audit-log',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': string('test-secret') },
          body: {
            admin_address: string('...abcd'),
            action: string('simulate_upgrade'),
            target: like(null),
            params_json: like({}),
            ip_address: like(null),
          },
        },
        willRespondWith: {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: { success: boolM(true), id: integer(1) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await post(mock.url, '/internal/audit-log', {
          admin_address: '...abcd',
          action: 'simulate_upgrade',
          target: null,
          params_json: {},
          ip_address: null,
        });
        expect(status).toBe(201);
        expect(body.success).toBe(true);
      });
    });
  });

  // ── Audit log query ───────────────────────────────────────────────────────

  describe('GET /internal/audit-log', () => {
    it('returns paginated audit entries filtered by action', async () => {
      await provider.addInteraction({
        states: [{ description: 'audit log has simulate_upgrade entries' }],
        uponReceiving: 'API queries audit log for simulate_upgrade',
        withRequest: {
          method: 'GET',
          path: '/internal/audit-log',
          query: { action: 'simulate_upgrade', limit: '50' },
          headers: { 'x-internal-secret': string('test-secret') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: boolM(true),
            entries: eachLike({
              id: integer(1),
              admin_address: string('...abcd'),
              action: string('simulate_upgrade'),
              created_at: string('2026-01-01T00:00:00.000Z'),
            }),
            total: integer(1),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(
          mock.url,
          '/internal/audit-log?action=simulate_upgrade&limit=50',
        );
        expect(status).toBe(200);
        expect(Array.isArray(body.entries)).toBe(true);
      });
    });
  });

  // ── TOML cache invalidation ───────────────────────────────────────────────

  describe('POST /internal/toml-cache/invalidate', () => {
    it('invalidates the stellar.toml cache for a domain', async () => {
      await provider.addInteraction({
        states: [{ description: 'TOML cache is populated' }],
        uponReceiving: 'API requests TOML cache invalidation for moneygram.stellar.org',
        withRequest: {
          method: 'POST',
          path: '/internal/toml-cache/invalidate',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': string('test-secret') },
          body: { domain: string('moneygram.stellar.org') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { success: boolM(true), domain: string('moneygram.stellar.org') },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await post(mock.url, '/internal/toml-cache/invalidate', {
          domain: 'moneygram.stellar.org',
        });
        expect(status).toBe(200);
        expect(body.success).toBe(true);
      });
    });

    it('returns 400 for missing domain field', async () => {
      await provider.addInteraction({
        states: [{ description: 'backend validation is active' }],
        uponReceiving: 'API TOML invalidation request without domain',
        withRequest: {
          method: 'POST',
          path: '/internal/toml-cache/invalidate',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': string('test-secret') },
          body: {},
        },
        willRespondWith: {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: { success: boolM(false), error: like({ code: string('MISSING_FIELD') }) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await post(mock.url, '/internal/toml-cache/invalidate', {});
        expect(status).toBe(400);
      });
    });
  });

  // ── Webhook delivery status ───────────────────────────────────────────────

  describe('GET /internal/webhooks/:id/status', () => {
    it('returns delivery status for a webhook', async () => {
      await provider.addInteraction({
        states: [{ description: 'webhook delivery wh-001 exists' }],
        uponReceiving: 'API queries webhook delivery status for wh-001',
        withRequest: {
          method: 'GET',
          path: '/internal/webhooks/wh-001/status',
          headers: { 'x-internal-secret': string('test-secret') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: like({
            id: string('wh-001'),
            status: string('delivered'),
            attempts: integer(1),
            last_attempt_at: string('2026-01-01T00:00:00.000Z'),
          }),
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/internal/webhooks/wh-001/status');
        expect(status).toBe(200);
        expect(body.id).toBe('wh-001');
      });
    });

    it('returns 404 for unknown webhook', async () => {
      await provider.addInteraction({
        states: [{ description: 'webhook delivery wh-unknown does not exist' }],
        uponReceiving: 'API queries status for non-existent webhook',
        withRequest: {
          method: 'GET',
          path: '/internal/webhooks/wh-unknown/status',
          headers: { 'x-internal-secret': string('test-secret') },
        },
        willRespondWith: {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: { success: boolM(false), error: like({ code: string('NOT_FOUND') }) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await get(mock.url, '/internal/webhooks/wh-unknown/status');
        expect(status).toBe(404);
      });
    });
  });

  // ── Settlement simulation ─────────────────────────────────────────────────

  describe('POST /internal/settlements/simulate', () => {
    it('returns a simulation report for valid input', async () => {
      await provider.addInteraction({
        states: [{ description: 'backend settlement simulator is ready' }],
        uponReceiving: 'API requests settlement simulation',
        withRequest: {
          method: 'POST',
          path: '/internal/settlements/simulate',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': string('test-secret') },
          body: {
            amount: integer(10000000),
            source_currency: string('USD'),
            dest_currency: string('NGN'),
            corridor: string('USD-NG'),
          },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: like({
            success: boolM(true),
            simulated_amount: integer(16205000),
            fee: integer(250000),
            net_amount: integer(15955000),
            exchange_rate: like(1620.5),
          }),
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await post(mock.url, '/internal/settlements/simulate', {
          amount: 10000000,
          source_currency: 'USD',
          dest_currency: 'NGN',
          corridor: 'USD-NG',
        });
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(typeof body.exchange_rate).toBe('number');
      });
    });
  });
});
