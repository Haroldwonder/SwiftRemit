/**
 * Pact consumer tests — SwiftRemit Mobile app (SR-062)
 *
 * Covers every endpoint that mobile/src/services/api.ts calls:
 *   authService   : POST /api/auth/login
 *   remittanceService: POST /api/remittance, GET /api/remittance/history/:addr,
 *                      GET /api/remittance/:id
 *   kycService    : GET  /api/kyc/status/:userId/:anchorId, POST /api/kyc/register
 *   fxService     : GET  /api/fx-rate/current
 *
 * Generated pact file: pacts/SwiftRemitMobile-SwiftRemitAPI.json
 */

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, expect } from 'vitest';

const { like, eachLike, string, integer, decimal, boolean: bool } = MatchersV3;

const PACT_DIR = path.resolve(__dirname, '../../../../pacts');

const provider = new PactV3({
  consumer: 'SwiftRemitMobile',
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

const AUTH_HEADER = { Authorization: 'Bearer mobile-valid-token' };

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('SwiftRemitMobile — Pact consumer contract (SR-062)', () => {

  describe('authService.login — POST /api/auth/login', () => {
    it('returns token for wallet + signature credentials', async () => {
      await provider.addInteraction({
        state: 'mobile user exists',
        uponReceiving: 'mobile login with walletAddress and signature',
        withRequest: {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: {
            walletAddress: string('GWALLET1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'),
            signature: string('mock-signature-hex'),
          },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            token: string('eyJhbGciOiJIUzI1NiJ9.mobile'),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await post(mock.url, '/api/auth/login', {
          walletAddress: 'GWALLET1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          signature: 'mock-signature-hex',
        });
        expect(status).toBe(200);
        expect(typeof body.token).toBe('string');
      });
    });

    it('returns 400 for missing walletAddress', async () => {
      await provider.addInteraction({
        state: 'mobile login missing walletAddress',
        uponReceiving: 'mobile login request without walletAddress',
        withRequest: {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: { signature: string('sig') },
        },
        willRespondWith: {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: { success: bool(false), error: like({ code: string('MISSING_FIELD') }) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await post(mock.url, '/api/auth/login', { signature: 'sig' });
        expect(status).toBe(400);
      });
    });
  });

  // ── Remittance ────────────────────────────────────────────────────────────

  describe('remittanceService.create — POST /api/remittance', () => {
    it('creates a remittance and returns the new record', async () => {
      await provider.addInteraction({
        state: 'mobile user authenticated',
        uponReceiving: 'mobile create remittance request',
        withRequest: {
          method: 'POST',
          path: '/api/remittance',
          headers: { 'Content-Type': 'application/json', Authorization: string('Bearer mobile-valid-token') },
          body: {
            sender: string('GWALLET1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'),
            agent: string('NG'),
            amount: decimal(100.0),
          },
        },
        willRespondWith: {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            remittance: like({
              id: string('rem-mobile-001'),
              sender: string('GWALLET1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'),
              status: string('Pending'),
              amount: decimal(100.0),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await post(
          mock.url,
          '/api/remittance',
          { sender: 'GWALLET1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', agent: 'NG', amount: 100.0 },
          AUTH_HEADER,
        );
        expect(status).toBe(201);
        expect(body.remittance.status).toBe('Pending');
      });
    });

    it('returns 401 when not authenticated', async () => {
      await provider.addInteraction({
        state: 'no auth token provided',
        uponReceiving: 'mobile unauthenticated create remittance',
        withRequest: {
          method: 'POST',
          path: '/api/remittance',
          headers: { 'Content-Type': 'application/json' },
          body: { sender: string('GWALLET'), agent: string('NG'), amount: decimal(50.0) },
        },
        willRespondWith: {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          body: { success: bool(false), error: like({ code: string('UNAUTHORIZED') }) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await post(mock.url, '/api/remittance', { sender: 'GWALLET', agent: 'NG', amount: 50.0 });
        expect(status).toBe(401);
      });
    });
  });

  describe('remittanceService.getHistory — GET /api/remittance/history/:walletAddress', () => {
    const wallet = 'GWALLET1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

    it('returns remittance history for the wallet', async () => {
      await provider.addInteraction({
        state: 'mobile user has remittances',
        uponReceiving: 'mobile get remittance history',
        withRequest: {
          method: 'GET',
          path: `/api/remittance/history/${wallet}`,
          headers: { Authorization: string('Bearer mobile-valid-token') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            remittances: eachLike({
              id: string('rem-001'),
              status: string('Completed'),
              amount: decimal(100.0),
              created_at: string('2026-01-01T00:00:00.000Z'),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, `/api/remittance/history/${wallet}`, AUTH_HEADER);
        expect(status).toBe(200);
        expect(Array.isArray(body.remittances)).toBe(true);
      });
    });

    it('returns empty array when no history exists', async () => {
      const newWallet = 'GNEWWALLET1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      await provider.addInteraction({
        state: 'mobile user has no remittances',
        uponReceiving: 'mobile get empty remittance history',
        withRequest: {
          method: 'GET',
          path: `/api/remittance/history/${newWallet}`,
          headers: { Authorization: string('Bearer mobile-valid-token') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { success: bool(true), remittances: [] },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, `/api/remittance/history/${newWallet}`, AUTH_HEADER);
        expect(status).toBe(200);
        expect(body.remittances).toHaveLength(0);
      });
    });
  });

  describe('remittanceService.getById — GET /api/remittance/:id', () => {
    it('returns a single remittance by id', async () => {
      await provider.addInteraction({
        state: 'remittance rem-001 exists',
        uponReceiving: 'mobile get remittance by id',
        withRequest: {
          method: 'GET',
          path: '/api/remittance/rem-001',
          headers: { Authorization: string('Bearer mobile-valid-token') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: bool(true),
            remittance: like({
              id: string('rem-001'),
              status: string('Pending'),
              amount: decimal(100.0),
            }),
          },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/remittance/rem-001', AUTH_HEADER);
        expect(status).toBe(200);
        expect(body.remittance.id).toBe('rem-001');
      });
    });

    it('returns 404 for unknown remittance', async () => {
      await provider.addInteraction({
        state: 'remittance rem-unknown does not exist',
        uponReceiving: 'mobile get non-existent remittance',
        withRequest: {
          method: 'GET',
          path: '/api/remittance/rem-unknown',
          headers: { Authorization: string('Bearer mobile-valid-token') },
        },
        willRespondWith: {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: { success: bool(false), error: like({ code: string('NOT_FOUND') }) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await get(mock.url, '/api/remittance/rem-unknown', AUTH_HEADER);
        expect(status).toBe(404);
      });
    });
  });

  // ── KYC ───────────────────────────────────────────────────────────────────

  describe('kycService.getStatus — GET /api/kyc/status/:userId/:anchorId', () => {
    it('returns KYC status for a user and anchor', async () => {
      await provider.addInteraction({
        state: 'KYC record exists for user user-1 at anchor anchor-1',
        uponReceiving: 'mobile get KYC status',
        withRequest: {
          method: 'GET',
          path: '/api/kyc/status/user-1/anchor-1',
          headers: { Authorization: string('Bearer mobile-valid-token') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: like({
            status: string('approved'),
            level: string('basic'),
            anchor_id: string('anchor-1'),
          }),
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/kyc/status/user-1/anchor-1', AUTH_HEADER);
        expect(status).toBe(200);
        expect(body.status).toBe('approved');
      });
    });
  });

  describe('kycService.register — POST /api/kyc/register', () => {
    it('registers KYC fields and returns 200', async () => {
      await provider.addInteraction({
        state: 'KYC registration is open',
        uponReceiving: 'mobile KYC registration request',
        withRequest: {
          method: 'POST',
          path: '/api/kyc/register',
          headers: { 'Content-Type': 'application/json', Authorization: string('Bearer mobile-valid-token') },
          body: { first_name: string('Alice'), last_name: string('Smith'), country: string('US') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: like({ success: bool(true) }),
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await post(
          mock.url,
          '/api/kyc/register',
          { first_name: 'Alice', last_name: 'Smith', country: 'US' },
          AUTH_HEADER,
        );
        expect(status).toBe(200);
      });
    });
  });

  // ── FX rate ───────────────────────────────────────────────────────────────

  describe('fxService.getRate — GET /api/fx-rate/current', () => {
    it('returns exchange rate for a currency pair', async () => {
      await provider.addInteraction({
        state: 'FX rates are available',
        uponReceiving: 'mobile FX rate request USD to NGN',
        withRequest: {
          method: 'GET',
          path: '/api/fx-rate/current',
          query: { from: 'USD', to: 'NGN' },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: like({
            from: string('USD'),
            to: string('NGN'),
            rate: decimal(1620.5),
            timestamp: string('2026-01-01T00:00:00.000Z'),
          }),
        },
      });
      await provider.executeTest(async (mock) => {
        const { status, body } = await get(mock.url, '/api/fx-rate/current?from=USD&to=NGN');
        expect(status).toBe(200);
        expect(typeof body.rate).toBe('number');
      });
    });

    it('returns 400 for unsupported currency pair', async () => {
      await provider.addInteraction({
        state: 'FX rates exist but XYZ is unsupported',
        uponReceiving: 'mobile FX rate request for unsupported pair',
        withRequest: {
          method: 'GET',
          path: '/api/fx-rate/current',
          query: { from: 'USD', to: 'XYZ' },
        },
        willRespondWith: {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: { success: bool(false), error: like({ code: string('UNSUPPORTED_CURRENCY_PAIR') }) },
        },
      });
      await provider.executeTest(async (mock) => {
        const { status } = await get(mock.url, '/api/fx-rate/current?from=USD&to=XYZ');
        expect(status).toBe(400);
      });
    });
  });
});
