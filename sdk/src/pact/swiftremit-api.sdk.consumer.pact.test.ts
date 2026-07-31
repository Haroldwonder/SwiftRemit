/**
 * Pact consumer tests — SwiftRemit SDK (SR-062)
 *
 * Covers every HTTP endpoint that sdk/src/client.ts reaches via the API
 * server (health, currencies, anchors, remittances, agents, limits, analytics).
 * The SDK talks directly to the Soroban RPC for on-chain calls; those are
 * NOT pacted here — only the REST API surface matters.
 *
 * Generated pact file: pacts/SwiftRemitSDK-SwiftRemitAPI.json
 */

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, expect } from 'vitest';

const {
  like,
  eachLike,
  string,
  integer,
  decimal,
  boolean: bool,
  regex,
  timestamp,
} = MatchersV3;

const PACT_DIR = path.resolve(__dirname, '../../../../pacts');

const provider = new PactV3({
  consumer: 'SwiftRemitSDK',
  provider: 'SwiftRemitAPI',
  dir: PACT_DIR,
  logLevel: 'warn',
});

// ── Minimal fetch helpers ─────────────────────────────────────────────────────

async function get(base: string, p: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${p}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  return { status: res.status, body: await res.json() };
}

async function post(base: string, p: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── Interactions ──────────────────────────────────────────────────────────────

describe('SwiftRemitSDK — Pact consumer contract (SR-062)', () => {

  // GET /health
  describe('GET /health', () => {
    it('returns service health status', async () => {
      await provider.addInteraction({
        states: [{ description: 'service is running' }],
        uponReceiving: 'SDK health probe',
        withRequest: { method: 'GET', path: '/health' },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            status: string('ok'),
            timestamp: string('2026-01-01T00:00:00.000Z'),
            uptime: decimal(1.0),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/health');
        expect(status).toBe(200);
        expect(body.status).toBe('ok');
      });
    });
  });

  // GET /api/currencies
  describe('GET /api/currencies', () => {
    it('returns a list of supported currencies', async () => {
      await provider.addInteraction({
        states: [{ description: 'currencies exist' }],
        uponReceiving: 'SDK request for all currencies',
        withRequest: { method: 'GET', path: '/api/currencies' },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: eachLike({
              code: string('USD'),
              symbol: string('$'),
              decimal_precision: integer(2),
            }),
            count: integer(1),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/currencies');
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
      });
    });
  });

  // GET /api/currencies/:code
  describe('GET /api/currencies/:code', () => {
    it('returns a single currency', async () => {
      await provider.addInteraction({
        states: [{ description: 'USD currency exists' }],
        uponReceiving: 'SDK request for USD currency',
        withRequest: { method: 'GET', path: '/api/currencies/USD' },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: like({ code: string('USD'), symbol: string('$'), decimal_precision: integer(2) }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/currencies/USD');
        expect(status).toBe(200);
        expect(body.data.code).toBe('USD');
      });
    });

    it('returns 404 for an unknown code', async () => {
      await provider.addInteraction({
        states: [{ description: 'XYZ currency does not exist' }],
        uponReceiving: 'SDK request for unknown currency XYZ',
        withRequest: { method: 'GET', path: '/api/currencies/XYZ' },
        willRespondWith: {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: { success: bool(false), error: like({ code: string('CURRENCY_NOT_FOUND') }) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/currencies/XYZ');
        expect(status).toBe(404);
        expect(body.success).toBe(false);
      });
    });
  });

  // GET /api/anchors
  describe('GET /api/anchors', () => {
    it('returns available anchors', async () => {
      await provider.addInteraction({
        states: [{ description: 'anchors exist' }],
        uponReceiving: 'SDK request for anchor list',
        withRequest: { method: 'GET', path: '/api/anchors' },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: eachLike({
              id: string('anchor-1'),
              name: string('Test Anchor'),
              domain: string('anchor.example.com'),
              status: string('active'),
              verified: bool(true),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/anchors');
        expect(status).toBe(200);
        expect(Array.isArray(body.data)).toBe(true);
      });
    });

    it('filters anchors by currency', async () => {
      await provider.addInteraction({
        states: [{ description: 'anchors exist' }],
        uponReceiving: 'SDK request for USD anchors',
        withRequest: { method: 'GET', path: '/api/anchors', query: { currency: 'USD' } },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: eachLike({
              id: string('anchor-1'),
              supported_currencies: eachLike(string('USD')),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/anchors?currency=USD');
        expect(status).toBe(200);
      });
    });
  });

  // GET /api/anchors/:id
  describe('GET /api/anchors/:id', () => {
    it('returns a single anchor by id', async () => {
      await provider.addInteraction({
        states: [{ description: 'anchor anchor-1 exists' }],
        uponReceiving: 'SDK request for anchor anchor-1',
        withRequest: { method: 'GET', path: '/api/anchors/anchor-1' },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: like({
              id: string('anchor-1'),
              name: string('MoneyGram Access'),
              domain: string('moneygram.stellar.org'),
              status: string('active'),
              fees: like({ deposit_fee_percent: decimal(1.5) }),
              limits: like({ min_amount: integer(10), max_amount: integer(10000) }),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/anchors/anchor-1');
        expect(status).toBe(200);
        expect(body.data.id).toBe('anchor-1');
      });
    });

    it('returns 404 for unknown anchor', async () => {
      await provider.addInteraction({
        states: [{ description: 'anchor unknown-anchor does not exist' }],
        uponReceiving: 'SDK request for non-existent anchor',
        withRequest: { method: 'GET', path: '/api/anchors/unknown-anchor' },
        willRespondWith: {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: { success: bool(false), error: like({ code: string('ANCHOR_NOT_FOUND') }) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await get(mock.url, '/api/anchors/unknown-anchor');
        expect(status).toBe(404);
      });
    });
  });

  // GET /api/remittances
  describe('GET /api/remittances', () => {
    it('returns paginated remittances for authenticated SDK caller', async () => {
      await provider.addInteraction({
        states: [{ description: 'user has remittances' }],
        uponReceiving: 'SDK authenticated request for remittances',
        withRequest: {
          method: 'GET',
          path: '/api/remittances',
          headers: { Authorization: string('Bearer sdk-valid-token') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: eachLike({
              id: integer(1),
              sender: string('GSENDER'),
              agent: string('GAGENT'),
              amount: integer(10000000),
              fee: integer(100000),
              status: string('Pending'),
              created_at: string('2026-01-01T00:00:00.000Z'),
              updated_at: string('2026-01-01T00:00:00.000Z'),
            }),
            has_more: bool(false),
            next_cursor: like(null),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/remittances', {
          Authorization: 'Bearer sdk-valid-token',
        });
        expect(status).toBe(200);
        expect(Array.isArray(body.data)).toBe(true);
      });
    });

    it('returns 401 when no token provided', async () => {
      await provider.addInteraction({
        states: [{ description: 'no auth token provided' }],
        uponReceiving: 'SDK unauthenticated remittances request',
        withRequest: { method: 'GET', path: '/api/remittances' },
        willRespondWith: {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          body: { success: bool(false), error: like({ code: string('UNAUTHORIZED') }) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await get(mock.url, '/api/remittances');
        expect(status).toBe(401);
      });
    });
  });

  // GET /api/limits
  describe('GET /api/limits', () => {
    it('returns corridor daily limits', async () => {
      await provider.addInteraction({
        states: [{ description: 'limits are configured' }],
        uponReceiving: 'SDK request for daily limits',
        withRequest: { method: 'GET', path: '/api/limits' },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: eachLike({
              currency: string('USD'),
              country: string('NG'),
              daily_limit: integer(50000),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/limits');
        expect(status).toBe(200);
        expect(body.success).toBe(true);
      });
    });
  });

  // POST /api/auth/login
  describe('POST /api/auth/login', () => {
    it('returns access token for valid credentials', async () => {
      await provider.addInteraction({
        states: [{ description: 'admin user exists' }],
        uponReceiving: 'SDK login request',
        withRequest: {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: { userId: string('sdk-user'), password: string('secret') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: like({
              access_token: string('eyJ.placeholder'),
              token_type: string('Bearer'),
              expires_in: integer(900),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await post(mock.url, '/api/auth/login', {
          userId: 'sdk-user',
          password: 'secret',
        });
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.access_token).toBeTruthy();
      });
    });
  });

  // POST /api/auth/refresh
  describe('POST /api/auth/refresh', () => {
    it('issues a new access token using a refresh cookie', async () => {
      await provider.addInteraction({
        states: [{ description: 'valid refresh token exists' }],
        uponReceiving: 'SDK token refresh request',
        withRequest: {
          method: 'POST',
          path: '/api/auth/refresh',
          headers: { Cookie: string('refresh_token=valid-refresh') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: like({ access_token: string('eyJ.new'), token_type: string('Bearer') }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const res = await fetch(`${mock.url}/api/auth/refresh`, {
          method: 'POST',
          headers: { Cookie: 'refresh_token=valid-refresh' },
        });
        expect(res.status).toBe(200);
      });
    });
  });

  // GET /api/agents/:id
  describe('GET /api/agents/:id', () => {
    it('returns agent profile for a valid stellar address', async () => {
      const agentAddr = 'GAGENT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      await provider.addInteraction({
        states: [{ description: 'agent exists' }],
        uponReceiving: 'SDK request for agent profile',
        withRequest: { method: 'GET', path: `/api/agents/${agentAddr}` },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: like({
              id: string('agent-uuid'),
              stellar_address: string(agentAddr),
              status: string('active'),
              name: string('Test Agent'),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, `/api/agents/${agentAddr}`);
        expect(status).toBe(200);
        expect(body.data.stellar_address).toBe(agentAddr);
      });
    });
  });

  // GET /api/settlements (read-only simulation)
  describe('GET /api/settlements', () => {
    it('returns settlement simulation result', async () => {
      await provider.addInteraction({
        states: [{ description: 'settlements data exists' }],
        uponReceiving: 'SDK settlement simulation request',
        withRequest: { method: 'GET', path: '/api/settlements' },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { success: bool(true), data: like({}) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await get(mock.url, '/api/settlements');
        expect(status).toBe(200);
      });
    });
  });

  // GET /api/accounts/:address (XLM balance / fee estimation)
  describe('GET /api/accounts/:address', () => {
    it('returns XLM balance and fee estimate', async () => {
      const addr = 'GACCOUNT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      await provider.addInteraction({
        states: [{ description: 'Stellar account exists' }],
        uponReceiving: 'SDK request for account balance',
        withRequest: { method: 'GET', path: `/api/accounts/${addr}` },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            data: like({
              address: string(addr),
              xlm_balance: string('100.0000000'),
              base_fee_stroops: integer(100),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, `/api/accounts/${addr}`);
        expect(status).toBe(200);
        expect(body.data.address).toBe(addr);
      });
    });
  });
});
