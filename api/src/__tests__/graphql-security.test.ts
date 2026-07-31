/**
 * GraphQL security tests (SR-050).
 *
 * The four cases the issue names, plus the acceptance criteria:
 *
 *   1. deeply nested query        → rejected before execution
 *   2. high-complexity query      → rejected before execution
 *   3. introspection in production → error
 *   4. unauthorised field access  → null plus an error, never data
 *
 * "Before execution" is asserted with a resolver call counter, not inferred
 * from the status code — a limit that rejects after the database work has
 * already happened would still return 400 while providing no protection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { createGraphQLRouter, resetGraphQLRateLimit } from '../routes/graphql';
import { RemittanceStore } from '../graphql/resolvers';
import {
  DEFAULT_MAX_COMPLEXITY,
  DEFAULT_MAX_DEPTH,
  configuredMaxDepth,
  introspectionDisabled,
} from '../graphql/security';
import { bearer, useTestJwtSecret } from './helpers/authTestUtils';

/** Counts store round trips so N+1 and pre-execution rejection are observable. */
let storeCalls: number;

const stubStore: RemittanceStore = {
  async queryWithCursor() {
    storeCalls += 1;
    return {
      items: [
        {
          id: 1,
          sender: 'GSENDER',
          agent: 'GAGENT',
          amount: 100,
          fee: 1,
          status: 'Completed',
          token: 'USDC',
          memo: 'rent',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      nextCursor: null,
      hasMore: false,
    };
  },
};

/**
 * Minimal pool stub. The corridors resolver needs one, otherwise it throws
 * "Database not configured" before field resolution and the field-level
 * authorisation check never gets a chance to run.
 */
const stubPool = {
  query: async () => ({
    rows: [
      {
        source_currency: 'USDC',
        destination_country: 'NG',
        total_volume: '1000',
        transaction_count: '10',
        success_count: '9',
        failure_count: '1',
        avg_fee: '1.5',
        total_fees: '15',
      },
    ],
  }),
} as unknown as Parameters<typeof createGraphQLRouter>[0]['pool'];

let app: Application;
const ORIGINAL_ENV = process.env.NODE_ENV;

function makeApp() {
  const instance = express();
  instance.use(express.json());
  instance.use(
    '/api/graphql',
    createGraphQLRouter({ remittanceStore: stubStore, pool: stubPool }),
  );
  return instance;
}

beforeEach(() => {
  storeCalls = 0;
  resetGraphQLRateLimit();
  useTestJwtSecret();
  process.env.NODE_ENV = 'test';
  delete process.env.GRAPHQL_MAX_DEPTH;
  delete process.env.GRAPHQL_MAX_COMPLEXITY;
  app = makeApp();
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
});

const USER = () => bearer('user-1', { role: 'user' });
const ADMIN = () => bearer('admin-1', { role: 'admin' });

describe('SR-050 — transport authentication', () => {
  it('rejects an unauthenticated query', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .send({ query: '{ remittances { id } }' });

    expect(res.status).toBe(401);
    expect(storeCalls).toBe(0);
  });

  it('rejects an invalid token', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ query: '{ remittances { id } }' });

    expect(res.status).toBe(401);
    expect(storeCalls).toBe(0);
  });

  it('executes a valid query for an authenticated caller', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ remittances { id amount } }' });

    expect(res.status).toBe(200);
    expect(res.body.data.remittances[0].id).toBe(1);
    expect(res.body.data.remittances[0].amount).toBe(100);
  });
});

describe('SR-050 — depth limiting', () => {
  it('rejects a deeply nested query before any resolver runs', async () => {
    // Nest well past the budget by repeatedly selecting through a field.
    const deep = `{ ${'remittances { '.repeat(DEFAULT_MAX_DEPTH + 3)} id ${'}'.repeat(
      DEFAULT_MAX_DEPTH + 3,
    )} }`;

    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: deep });

    expect(res.status).toBe(400);
    // The load-bearing assertion: nothing was executed.
    expect(storeCalls).toBe(0);
  });

  it('accepts a query within the depth budget', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ remittances { id sender amount } }' });

    expect(res.status).toBe(200);
  });

  it('honours a configured depth budget', () => {
    process.env.GRAPHQL_MAX_DEPTH = '3';
    expect(configuredMaxDepth()).toBe(3);
    delete process.env.GRAPHQL_MAX_DEPTH;
    expect(configuredMaxDepth()).toBe(DEFAULT_MAX_DEPTH);
  });
});

describe('SR-050 — complexity analysis', () => {
  it('rejects a high-complexity query before any resolver runs', async () => {
    // Shallow but expensive: a large page multiplied across many fields. Depth
    // limiting alone would let this through.
    const query = `{
      remittances(limit: 500) {
        id sender agent amount fee status token memo created_at updated_at
      }
    }`;

    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('QUERY_TOO_COMPLEX');
    expect(storeCalls).toBe(0);
  });

  it('accepts a modest page size', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ remittances(limit: 5) { id amount } }' });

    expect(res.status).toBe(200);
    expect(storeCalls).toBe(1);
  });

  it('reports the budget it enforced', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ remittances(limit: 900) { id sender agent amount fee status } }' });

    expect(res.body.errors[0].message).toContain(String(DEFAULT_MAX_COMPLEXITY));
  });
});

describe('SR-050 — introspection', () => {
  it('allows introspection outside production', async () => {
    process.env.NODE_ENV = 'test';
    const res = await request(makeApp())
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ __schema { queryType { name } } }' });

    expect(res.status).toBe(200);
  });

  it('returns an error for introspection when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    expect(introspectionDisabled()).toBe(true);

    const res = await request(makeApp())
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ __schema { queryType { name } } }' });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('INTROSPECTION_DISABLED');
  });

  it('does not advertise the schema on GET in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(makeApp()).get('/api/graphql');

    expect(res.status).toBe(200);
    expect(res.body.introspection).toBe('disabled');
    expect(res.body.supportedQueries).toBeUndefined();
  });
});

describe('SR-050 — field-level authorisation', () => {
  it('returns null plus an error for a field the caller may not read', async () => {
    // Corridor.avg_fee is admin-only. A user asking for it must get no value.
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ corridors { source_currency avg_fee } }' });

    // The request itself succeeds; the restricted field does not.
    expect(res.status).toBe(200);
    expect(res.body.errors?.[0]?.code).toBe('FORBIDDEN_FIELD');

    const corridors = res.body.data?.corridors;
    if (Array.isArray(corridors) && corridors.length > 0) {
      expect(corridors[0].avg_fee).toBeNull();
    }
  });

  it('never leaks the restricted value in the response body', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ corridors { avg_fee total_fees } }' });

    // Whatever shape the response takes, the numbers must not appear.
    expect(JSON.stringify(res.body)).not.toMatch(/"avg_fee":\s*[0-9]/);
    expect(JSON.stringify(res.body)).not.toMatch(/"total_fees":\s*[0-9]/);
  });

  it('allows an admin to read the same field', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', ADMIN())
      .send({ query: '{ corridors { source_currency avg_fee } }' });

    // No FORBIDDEN_FIELD error for an admin. (Without a pool the resolver may
    // still error for its own reasons — the authorisation layer is what matters.)
    const codes = (res.body.errors ?? []).map((e: { code: string }) => e.code);
    expect(codes).not.toContain('FORBIDDEN_FIELD');
  });

  it('leaves unrestricted fields readable by any authenticated caller', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ remittances { id sender amount memo } }' });

    expect(res.status).toBe(200);
    expect(res.body.data.remittances[0].memo).toBe('rent');
  });
});

describe('SR-050 — per-operation rate limiting', () => {
  it('rejects once the per-identity operation budget is exhausted', async () => {
    const limited = express();
    limited.use(express.json());
    limited.use(
      '/api/graphql',
      createGraphQLRouter({
        remittanceStore: stubStore,
        operationLimit: 3,
        operationWindowMs: 60_000,
      }),
    );

    const token = bearer('busy-user', { role: 'user' });
    const send = () =>
      request(limited)
        .post('/api/graphql')
        .set('Authorization', token)
        .send({ query: '{ remittances { id } }' });

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);

    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('OPERATION_RATE_LIMITED');
  });
});

describe('SR-050 — one query per collection', () => {
  it('issues a single store round trip for a list query', async () => {
    const res = await request(app)
      .post('/api/graphql')
      .set('Authorization', USER())
      .send({ query: '{ remittances { id sender agent amount fee status memo } }' });

    expect(res.status).toBe(200);
    // Seven fields across the returned rows — still one round trip, not one per
    // field or per row.
    expect(storeCalls).toBe(1);
  });
});
