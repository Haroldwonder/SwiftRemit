/**
 * Health probe routes — /healthz and /readyz
 *
 * Issue #1134: SR-064 — Add a database connection pool health gate and readiness probe
 *
 *  /healthz  — Liveness probe:  process is alive, event loop is unblocked.
 *              No external dependency checks. A failing liveness probe causes
 *              Kubernetes to restart the container.
 *
 *  /readyz   — Readiness probe: DB is reachable, migrations applied, pool not
 *              saturated. A failing readiness probe removes the replica from
 *              the load-balancer without killing it, letting the pool drain.
 */
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { readPoolMetrics, checkPoolConnectivity, checkMigrationsApplied, PoolMetrics } from '../db/pool';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface LivenessResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

export interface ReadinessResponse {
  status: 'ok' | 'fail';
  timestamp: string;
  checks: {
    database: {
      status: 'ok' | 'error' | 'not_configured';
      latencyMs?: number;
      error?: string;
    };
    migrations: {
      status: 'ok' | 'error' | 'not_checked';
      lastMigration?: string;
      error?: string;
    };
    pool: {
      status: 'ok' | 'saturated' | 'not_configured';
      metrics?: {
        total: number;
        idle: number;
        active: number;
        waiting: number;
        max: number;
        saturationRatio: number;
      };
    };
  };
}

// ─── /healthz — Liveness probe ───────────────────────────────────────────────

/**
 * Create the liveness router.
 * GET /healthz → 200 if the process is alive; never returns 5xx.
 */
export function createLivenessRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const body: LivenessResponse = {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(body);
  });

  return router;
}

// ─── /readyz — Readiness probe ────────────────────────────────────────────────

/**
 * Create the readiness router.
 * GET /readyz → 200 if DB is reachable, migrations applied, pool not saturated.
 *               503 if any check fails.
 *
 * @param pool - The instrumented pg Pool. If null, the database check is skipped.
 */
export function createReadinessRouter(pool: Pool | null): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    const timestamp = new Date().toISOString();

    // ── Pool saturation check ─────────────────────────────────────────────
    let poolCheck: ReadinessResponse['checks']['pool'];
    if (!pool) {
      poolCheck = { status: 'not_configured' };
    } else {
      const metrics: PoolMetrics = readPoolMetrics(pool);
      if (metrics.saturated) {
        poolCheck = {
          status: 'saturated',
          metrics: {
            total: metrics.total,
            idle: metrics.idle,
            active: metrics.active,
            waiting: metrics.waiting,
            max: metrics.max,
            saturationRatio: Number(metrics.saturationRatio.toFixed(4)),
          },
        };
      } else {
        poolCheck = {
          status: 'ok',
          metrics: {
            total: metrics.total,
            idle: metrics.idle,
            active: metrics.active,
            waiting: metrics.waiting,
            max: metrics.max,
            saturationRatio: Number(metrics.saturationRatio.toFixed(4)),
          },
        };
      }
    }

    // ── DB connectivity check ─────────────────────────────────────────────
    let dbCheck: ReadinessResponse['checks']['database'];
    if (!pool) {
      dbCheck = { status: 'not_configured' };
    } else {
      const result = await checkPoolConnectivity(pool);
      dbCheck = result.ok
        ? { status: 'ok', latencyMs: result.latencyMs }
        : { status: 'error', latencyMs: result.latencyMs, error: result.error };
    }

    // ── Migration check ───────────────────────────────────────────────────
    let migrationCheck: ReadinessResponse['checks']['migrations'];
    if (!pool) {
      migrationCheck = { status: 'not_checked' };
    } else if (dbCheck.status !== 'ok') {
      // Skip migration check if DB is unreachable
      migrationCheck = { status: 'not_checked' };
    } else {
      const result = await checkMigrationsApplied(pool);
      migrationCheck = result.applied
        ? { status: 'ok', lastMigration: result.lastMigration }
        : { status: 'error', error: result.error };
    }

    // ── Aggregate status ──────────────────────────────────────────────────
    const allOk =
      (dbCheck.status === 'ok' || dbCheck.status === 'not_configured') &&
      (migrationCheck.status === 'ok' || migrationCheck.status === 'not_checked') &&
      (poolCheck.status === 'ok' || poolCheck.status === 'not_configured');

    const body: ReadinessResponse = {
      status: allOk ? 'ok' : 'fail',
      timestamp,
      checks: {
        database: dbCheck,
        migrations: migrationCheck,
        pool: poolCheck,
      },
    };

    res.status(allOk ? 200 : 503).json(body);
  });

  return router;
}
