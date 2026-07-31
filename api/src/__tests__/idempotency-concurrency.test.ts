/**
 * Idempotency correctness tests (SR-049).
 *
 * The acceptance criteria name four properties. Each has a test here, and each
 * fails against the pre-SR-049 middleware:
 *
 *   1. Concurrent identical requests execute the operation exactly once.
 *   2. Same key with a different body returns 409 IdempotencyConflict.
 *   3. The replayed response is byte-identical to the original.
 *   4. Money-moving POSTs without a key are rejected with 400.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  clearIdempotencyCache,
  createIdempotencyMiddleware,
  hashRequestBody,
  idempotencyMiddleware,
} from '../middleware/idempotency';

let app: Application;
let executions: number;

/** Delay so two in-flight requests genuinely overlap. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  clearIdempotencyCache();
  executions = 0;

  app = express();
  app.use(express.json());
  app.use(idempotencyMiddleware);

  app.post('/api/remittances', async (req, res) => {
    executions += 1;
    // Simulate real work so a concurrent duplicate arrives mid-flight.
    await sleep(40);
    res.status(201).json({
      success: true,
      // Derive the id from the payload, not the shared counter — two concurrent
      // handlers would otherwise both read the counter's final value.
      data: { id: `remittance-${(req.body as { amount: number }).amount}`, amount: (req.body as { amount: number }).amount },
    });
  });
});

describe('SR-049 — concurrency', () => {
  it('executes the operation exactly once for concurrent identical requests', async () => {
    const key = uuidv4();

    const [first, second] = await Promise.all([
      request(app).post('/api/remittances').set('Idempotency-Key', key).send({ amount: 100 }),
      request(app).post('/api/remittances').set('Idempotency-Key', key).send({ amount: 100 }),
    ]);

    // The point of the test: the handler ran once, not twice.
    expect(executions).toBe(1);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toEqual(second.body);
  });

  it('serialises three concurrent duplicates onto one execution', async () => {
    const key = uuidv4();

    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        request(app).post('/api/remittances').set('Idempotency-Key', key).send({ amount: 250 }),
      ),
    );

    expect(executions).toBe(1);
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body).toEqual(responses[0].body);
    }
  });

  it('does not serialise requests using different keys', async () => {
    const [a, b] = await Promise.all([
      request(app).post('/api/remittances').set('Idempotency-Key', uuidv4()).send({ amount: 1 }),
      request(app).post('/api/remittances').set('Idempotency-Key', uuidv4()).send({ amount: 2 }),
    ]);

    expect(executions).toBe(2);
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });
});

describe('SR-049 — body binding', () => {
  it('returns 409 IdempotencyConflict for the same key with a different body', async () => {
    const key = uuidv4();

    const first = await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });
    const second = await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', key)
      .send({ amount: 100_000 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IdempotencyConflict');
    expect(executions).toBe(1);
  });

  it('conflicts even when only a nested value differs', async () => {
    const key = uuidv4();
    await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', key)
      .send({ amount: 100, meta: { memo: 'rent' } });

    const res = await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', key)
      .send({ amount: 100, meta: { memo: 'not rent' } });

    expect(res.status).toBe(409);
  });

  it('treats key order as insignificant — the same body in any order replays', async () => {
    const key = uuidv4();
    const first = await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', key)
      .send({ amount: 100, currency: 'USDC' });

    const second = await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', key)
      .send({ currency: 'USDC', amount: 100 });

    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(executions).toBe(1);
  });

  it('hashes bodies independently of key order', () => {
    expect(hashRequestBody({ a: 1, b: 2 })).toBe(hashRequestBody({ b: 2, a: 1 }));
    expect(hashRequestBody({ a: 1 })).not.toBe(hashRequestBody({ a: 2 }));
  });
});

describe('SR-049 — verbatim replay', () => {
  it('replays the original status, body, and content type', async () => {
    const key = uuidv4();

    const original = await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });

    const replayed = await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });

    // 201, not a flattened 200 — the original status is preserved.
    expect(replayed.status).toBe(original.status);
    expect(replayed.status).toBe(201);
    expect(replayed.text).toBe(original.text);
    expect(replayed.headers['content-type']).toBe(original.headers['content-type']);
    expect(replayed.headers['cache-control']).toBe('private, no-store');
  });

  it('marks a replay so clients can tell it apart', async () => {
    const key = uuidv4();
    await request(app).post('/api/remittances').set('Idempotency-Key', key).send({ amount: 5 });

    const replayed = await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', key)
      .send({ amount: 5 });

    expect(replayed.headers['idempotent-replay']).toBe('true');
  });
});

describe('SR-049 — key requirement and validation', () => {
  it('rejects a money-moving POST with no key', async () => {
    const res = await request(app).post('/api/remittances').send({ amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(executions).toBe(0);
  });

  it('rejects a key that is not a UUID v4', async () => {
    const res = await request(app)
      .post('/api/remittances')
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(executions).toBe(0);
  });

  it('allows opting out of the requirement for non-money-moving routers', async () => {
    const relaxed = express();
    relaxed.use(express.json());
    relaxed.use(createIdempotencyMiddleware({ requiredPathPattern: null }));
    relaxed.post('/api/remittances', (_req, res) => res.json({ success: true }));

    const res = await request(relaxed).post('/api/remittances').send({ amount: 1 });
    expect(res.status).toBe(200);
  });
});
