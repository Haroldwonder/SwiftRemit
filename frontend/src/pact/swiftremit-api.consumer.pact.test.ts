/**
 * Pact consumer tests for the SwiftRemit API.
 *
 * These tests define the contract that the frontend expects from the API.
 * Running them generates pact JSON files under /pacts/ that the API provider
 * verification job then validates against the real API.
 *
 * Issue #934: Add API endpoint contract tests with Pact.
 */

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, beforeAll, afterAll } from 'vitest';
import { expect } from 'vitest';

const { like, eachLike, string, integer, boolean: booleanMatcher } = MatchersV3;

const PACT_OUTPUT_DIR = path.resolve(__dirname, '../../../../pacts');

const provider = new PactV3({
  consumer: 'SwiftRemitFrontend',
  provider: 'SwiftRemitAPI',
  dir: PACT_OUTPUT_DIR,
  logLevel: 'warn',
});

// ── Minimal HTTP client (no axios dependency in consumer tests) ──────────────

async function get(baseUrl: string, path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  return { status: res.status, body: await res.json() };
}

async function post(baseUrl: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── Consumer tests ───────────────────────────────────────────────────────────

describe('SwiftRemit API — Pact consumer contract', () => {
  describe('GET /api/currencies', () => {
    it('returns a paginated list of supported currencies', async () => {
      await provider.addInteraction({
        state: 'currencies exist',
        uponReceiving: 'a request for all currencies',
        withRequest: {
          method: 'GET',
          path: '/api/currencies',
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: booleanMatcher(true),
            data: eachLike({
              code: string('USD'),
              name: string('US Dollar'),
              symbol: string('$'),
            }),
            count: integer(1),
            total: integer(1),
          },
        },
      });

      await provider.executeTest(async (mockServer) => {
        const { status, body } = await get(mockServer.url, '/api/currencies');
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
        expect(typeof body.count).toBe('number');
        expect(typeof body.total).toBe('number');
      });
    });

    it('returns 400 for invalid limit parameter', async () => {
      await provider.addInteraction({
        state: 'currencies exist',
        uponReceiving: 'a currencies request with an invalid limit',
        withRequest: {
          method: 'GET',
          path: '/api/currencies',
          query: { limit: 'abc' },
        },
        willRespondWith: {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: booleanMatcher(false),
            error: like({
              message: string('Invalid limit parameter: must be a positive integer'),
              code: string('INVALID_PAGINATION_PARAM'),
            }),
          },
        },
      });

      await provider.executeTest(async (mockServer) => {
        const { status, body } = await get(mockServer.url, '/api/currencies?limit=abc');
        expect(status).toBe(400);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_PAGINATION_PARAM');
      });
    });
  });

  describe('GET /api/currencies/:code', () => {
    it('returns a single currency by code', async () => {
      await provider.addInteraction({
        state: 'USD currency exists',
        uponReceiving: 'a request for the USD currency',
        withRequest: {
          method: 'GET',
          path: '/api/currencies/USD',
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: booleanMatcher(true),
            data: like({
              code: string('USD'),
              name: string('US Dollar'),
              symbol: string('$'),
            }),
          },
        },
      });

      await provider.executeTest(async (mockServer) => {
        const { status, body } = await get(mockServer.url, '/api/currencies/USD');
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.code).toBe('USD');
      });
    });

    it('returns 404 for an unknown currency code', async () => {
      await provider.addInteraction({
        state: 'XYZ currency does not exist',
        uponReceiving: 'a request for an unknown currency code',
        withRequest: {
          method: 'GET',
          path: '/api/currencies/XYZ',
        },
        willRespondWith: {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: booleanMatcher(false),
            error: like({
              message: string('Currency not found'),
              code: string('CURRENCY_NOT_FOUND'),
            }),
          },
        },
      });

      await provider.executeTest(async (mockServer) => {
        const { status, body } = await get(mockServer.url, '/api/currencies/XYZ');
        expect(status).toBe(404);
        expect(body.success).toBe(false);
      });
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns an access token for valid credentials', async () => {
      await provider.addInteraction({
        state: 'admin user exists',
        uponReceiving: 'a login request with valid credentials',
        withRequest: {
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: { userId: string('admin') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: booleanMatcher(true),
            accessToken: string('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder'),
          },
        },
      });

      await provider.executeTest(async (mockServer) => {
        const { status, body } = await post(mockServer.url, '/api/auth/login', { userId: 'admin' });
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(typeof body.accessToken).toBe('string');
        expect(body.accessToken.length).toBeGreaterThan(0);
      });
    });
  });

  describe('GET /api/anchors', () => {
    it('returns a list of available anchors', async () => {
      await provider.addInteraction({
        state: 'anchors exist',
        uponReceiving: 'a request for available anchors',
        withRequest: {
          method: 'GET',
          path: '/api/anchors',
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: booleanMatcher(true),
            data: eachLike({
              id: string('anchor-001'),
              name: string('Test Anchor'),
              domain: string('testanchor.stellar.org'),
            }),
          },
        },
      });

      await provider.executeTest(async (mockServer) => {
        const { status, body } = await get(mockServer.url, '/api/anchors');
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
      });
    });
  });

  describe('GET /api/remittances (authenticated)', () => {
    it('returns remittances for an authenticated user', async () => {
      await provider.addInteraction({
        state: 'user has remittances',
        uponReceiving: 'an authenticated request to list remittances',
        withRequest: {
          method: 'GET',
          path: '/api/remittances',
          headers: { Authorization: string('Bearer valid-token') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: booleanMatcher(true),
            data: eachLike({
              id: string('rem-001'),
              status: string('Pending'),
              amount: integer(10000),
            }),
          },
        },
      });

      await provider.executeTest(async (mockServer) => {
        const { status, body } = await get(mockServer.url, '/api/remittances', {
          Authorization: 'Bearer valid-token',
        });
        expect(status).toBe(200);
        expect(body.success).toBe(true);
      });
    });

    it('returns 401 for unauthenticated requests', async () => {
      await provider.addInteraction({
        state: 'no auth token provided',
        uponReceiving: 'an unauthenticated request to list remittances',
        withRequest: {
          method: 'GET',
          path: '/api/remittances',
        },
        willRespondWith: {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: booleanMatcher(false),
            error: like({
              message: string('Unauthorized'),
              code: string('UNAUTHORIZED'),
            }),
          },
        },
      });

      await provider.executeTest(async (mockServer) => {
        const { status, body } = await get(mockServer.url, '/api/remittances');
        expect(status).toBe(401);
        expect(body.success).toBe(false);
      });
    });
  });
});
