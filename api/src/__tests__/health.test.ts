/**
 * Health probe route tests — /healthz and /readyz
 *
 * Issue #1134: SR-064 — Add a database connection pool health gate and readiness probe
 *
 * These tests cover:
 *  - /healthz liveness probe: always 200, returns uptime + timestamp
 *  - /readyz readiness probe: 200 when all checks pass, 503 when any fail
 *  - DB not-configured path (no pool passed)
 *  - Pool saturation path
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { createLivenessRouter, createReadinessRouter, LivenessResponse, ReadinessResponse } from '../routes/health';
import * as poolModule from '../db/pool';
import type { Pool } from 'pg';

// ─── Test app helpers ─────────────────────────────────────────────────────────

function buildLivenessApp(): Application {
  const app = express();
  app.use('/healthz', createLivenessRouter());
  return app;
}

function buildReadinessApp(pool: Pool | null): Application {
  const app = express();
  app.use('/readyz', createReadinessRouter(pool));
  return app;
}

// ─── Mock pool factory ────────────────────────────────────────────────────────

function makeMockPool(overrides: Partial<Pool> = {}): Pool {
  return {
    totalCount: 2,
    idleCount: 2,
    waitingCount: 0,
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ exists: false }] }),
      release: vi.fn(),
    }),
    ...overrides,
  } as unknown as Pool;
}

// ─── /healthz — Liveness probe ────────────────────────────────────────────────

describe('GET /healthz — Liveness probe', () => {
  it('returns 200 with status=ok', async () => {
    const app = buildLivenessApp();
    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('returns a numeric uptime field', async () => {
    const app = buildLivenessApp();
    const response = await request(app).get('/healthz');

    const body = response.body as LivenessResponse;
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns a valid ISO 8601 timestamp', async () => {
    const app = buildLivenessApp();
    const response = await request(app).get('/healthz');

    const body = response.body as LivenessResponse;
    expect(typeof body.timestamp).toBe('string');
    const parsed = new Date(body.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('always returns 200 (never 5xx)', async () => {
    // Even if called many times, liveness should always succeed
    const app = buildLivenessApp();
    for (let i = 0; i < 5; i++) {
      const response = await request(app).get('/healthz');
      expect(response.status).toBe(200);
    }
  });

  it('has JSON content-type', async () => {
    const app = buildLivenessApp();
    const response = await request(app).get('/healthz');
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});

// ─── /readyz — Readiness probe (no pool configured) ──────────────────────────

describe('GET /readyz — Readiness probe (no pool)', () => {
  it('returns 200 when no pool is configured', async () => {
    const app = buildReadinessApp(null);
    const response = await request(app).get('/readyz');

    // No pool means not_configured — not a failure
    expect(response.status).toBe(200);
  });

  it('reports database as not_configured when pool is null', async () => {
    const app = buildReadinessApp(null);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.database.status).toBe('not_configured');
  });

  it('reports migrations as not_checked when pool is null', async () => {
    const app = buildReadinessApp(null);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.migrations.status).toBe('not_checked');
  });

  it('reports pool as not_configured when pool is null', async () => {
    const app = buildReadinessApp(null);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.pool.status).toBe('not_configured');
  });

  it('has a valid ISO 8601 timestamp', async () => {
    const app = buildReadinessApp(null);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });
});

// ─── /readyz — Readiness probe (healthy pool) ────────────────────────────────

describe('GET /readyz — Readiness probe (healthy pool)', () => {
  beforeEach(() => {
    // Stub readPoolMetrics and checkPoolConnectivity so we don't need a real DB
    vi.spyOn(poolModule, 'readPoolMetrics').mockReturnValue({
      total: 3,
      idle: 2,
      active: 1,
      waiting: 0,
      max: 10,
      saturationRatio: 0,
      saturated: false,
      capturedAt: new Date(),
    });

    vi.spyOn(poolModule, 'checkPoolConnectivity').mockResolvedValue({
      ok: true,
      latencyMs: 5,
    });

    vi.spyOn(poolModule, 'checkMigrationsApplied').mockResolvedValue({
      applied: true,
      lastMigration: '20260101000000',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 when all checks pass', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    expect(response.status).toBe(200);
  });

  it('reports status=ok when all checks pass', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.status).toBe('ok');
  });

  it('reports database check as ok', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.database.latencyMs).toBe(5);
  });

  it('reports migration check as ok with lastMigration', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.migrations.status).toBe('ok');
    expect(body.checks.migrations.lastMigration).toBe('20260101000000');
  });

  it('reports pool metrics in check', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.pool.status).toBe('ok');
    expect(body.checks.pool.metrics).toBeDefined();
    expect(body.checks.pool.metrics?.total).toBe(3);
    expect(body.checks.pool.metrics?.idle).toBe(2);
    expect(body.checks.pool.metrics?.active).toBe(1);
    expect(body.checks.pool.metrics?.waiting).toBe(0);
    expect(body.checks.pool.metrics?.max).toBe(10);
  });

  it('returns JSON content-type', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});

// ─── /readyz — Readiness probe (DB failure) ──────────────────────────────────

describe('GET /readyz — Readiness probe (DB failure)', () => {
  beforeEach(() => {
    vi.spyOn(poolModule, 'readPoolMetrics').mockReturnValue({
      total: 0,
      idle: 0,
      active: 0,
      waiting: 0,
      max: 10,
      saturationRatio: 0,
      saturated: false,
      capturedAt: new Date(),
    });

    vi.spyOn(poolModule, 'checkPoolConnectivity').mockResolvedValue({
      ok: false,
      latencyMs: 5001,
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    });

    vi.spyOn(poolModule, 'checkMigrationsApplied').mockResolvedValue({
      applied: false,
      error: 'DB unreachable',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 when DB is unreachable', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    expect(response.status).toBe(503);
  });

  it('reports status=fail when DB is unreachable', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.status).toBe('fail');
  });

  it('reports database check as error', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.database.status).toBe('error');
    expect(body.checks.database.error).toContain('ECONNREFUSED');
  });

  it('skips migration check when DB is down', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    // Migration check is skipped if DB is unreachable
    expect(body.checks.migrations.status).toBe('not_checked');
  });
});

// ─── /readyz — Readiness probe (pool saturated) ──────────────────────────────

describe('GET /readyz — Readiness probe (pool saturated)', () => {
  beforeEach(() => {
    vi.spyOn(poolModule, 'readPoolMetrics').mockReturnValue({
      total: 10,
      idle: 0,
      active: 10,
      waiting: 5,
      max: 10,
      saturationRatio: 0.5,
      saturated: true,  // ← pool is saturated
      capturedAt: new Date(),
    });

    vi.spyOn(poolModule, 'checkPoolConnectivity').mockResolvedValue({
      ok: true,
      latencyMs: 3,
    });

    vi.spyOn(poolModule, 'checkMigrationsApplied').mockResolvedValue({
      applied: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 when pool is saturated', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    expect(response.status).toBe(503);
  });

  it('reports status=fail when pool is saturated', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.status).toBe('fail');
  });

  it('reports pool check as saturated', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.pool.status).toBe('saturated');
  });

  it('includes pool metrics in saturated response', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.pool.metrics?.waiting).toBe(5);
    expect(body.checks.pool.metrics?.saturationRatio).toBe(0.5);
  });

  it('still reports DB as ok when only pool is saturated', async () => {
    const pool = makeMockPool();
    const app = buildReadinessApp(pool);
    const response = await request(app).get('/readyz');

    const body = response.body as ReadinessResponse;
    expect(body.checks.database.status).toBe('ok');
  });
});
