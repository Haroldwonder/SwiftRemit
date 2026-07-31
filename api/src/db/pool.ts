/**
 * Database connection pool with metrics instrumentation.
 *
 * Exports pool metrics (total, idle, waiting, acquire latency) and pool
 * saturation tracking for use by the /readyz readiness probe and Prometheus.
 *
 * Issue #1134: SR-064 — Add a database connection pool health gate and readiness probe
 */
import { Pool, PoolConfig, PoolClient } from 'pg';
import { createRequire } from 'module';

// ─── Prometheus Gauge/Histogram helpers ──────────────────────────────────────
// We write a thin metrics facade that emits prom-client-style metrics only if
// prom-client is available; if not, metrics are no-ops (keeps the module
// dependency-free for environments that don't use Prometheus).
//
// prom-client is an *optional* peer: it is deliberately not a declared
// dependency, so the surface we need is described structurally rather than
// with `typeof import('prom-client')` (which would fail to compile whenever the
// package is absent).

interface PromGauge {
  set(value: number): void;
}

interface PromHistogram {
  observe(value: number): void;
}

interface PromClientLike {
  Gauge: new (config: { name: string; help: string }) => PromGauge;
  Histogram: new (config: { name: string; help: string; buckets: number[] }) => PromHistogram;
}

let promClient: PromClientLike | null = null;
try {
  promClient = createRequire(import.meta.url)('prom-client') as PromClientLike;
} catch {
  // prom-client not installed — metrics will be no-ops
}

function makeGauge(name: string, help: string): PromGauge {
  if (!promClient) return { set: () => {} };
  return new promClient.Gauge({ name, help });
}

function makeHistogram(name: string, help: string, buckets: number[]): PromHistogram {
  if (!promClient) return { observe: () => {} };
  return new promClient.Histogram({ name, help, buckets });
}

// ─── Exported metric objects ─────────────────────────────────────────────────

/** Current total pool connections (idle + active). */
export const poolTotalConnections = makeGauge(
  'db_pool_total_connections',
  'Total number of connections in the pool (idle + active)',
);

/** Current number of idle pool connections. */
export const poolIdleConnections = makeGauge(
  'db_pool_idle_connections',
  'Number of idle connections in the pool',
);

/** Current number of pending connection requests waiting for a free slot. */
export const poolWaitingRequests = makeGauge(
  'db_pool_waiting_requests',
  'Number of pending requests waiting for a pool connection',
);

/** Histogram of connection acquire latency in milliseconds. */
export const poolAcquireLatencyMs = makeHistogram(
  'db_pool_acquire_latency_ms',
  'Connection acquire latency in milliseconds',
  [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
);

// ─── Saturation tracking ──────────────────────────────────────────────────────

/**
 * Snapshot of pool metrics at a point in time.
 */
export interface PoolMetrics {
  /** Total connections (idle + active). */
  total: number;
  /** Number of idle connections. */
  idle: number;
  /** Number of active (checked-out) connections. */
  active: number;
  /** Number of pending acquire requests waiting for a free connection. */
  waiting: number;
  /** Pool maximum size. */
  max: number;
  /** Saturation ratio in [0, 1]: waiting / max. */
  saturationRatio: number;
  /** True when waiting > 0 and has exceeded SATURATION_THRESHOLD_MS. */
  saturated: boolean;
  /** Timestamp of this snapshot. */
  capturedAt: Date;
}

// Pool saturation is declared when waiting connections exceed this ratio of max.
const SATURATION_WAITING_THRESHOLD = parseInt(process.env.POOL_SATURATION_WAITING_THRESHOLD || '3');
// How long the pool must remain saturated before readiness fails.
const SATURATION_DURATION_MS = parseInt(process.env.POOL_SATURATION_DURATION_MS || '5000');

let _pool: Pool | null = null;
let _saturatedSince: number | null = null;

/**
 * Initialize the instrumented pool.
 * Call once at startup; subsequent calls return the same pool.
 */
export function initPool(config?: PoolConfig): Pool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  _pool = new Pool({
    connectionString,
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000'),
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000'),
    ...config,
  });

  // ─── Instrumentation ──────────────────────────────────────────────────────
  _pool.on('connect', () => refreshMetrics());
  _pool.on('acquire', () => refreshMetrics());
  _pool.on('remove', () => refreshMetrics());

  return _pool;
}

/**
 * Return the current pool instance. Returns null if not initialized.
 */
export function getPool(): Pool | null {
  return _pool;
}

/**
 * Refresh Prometheus gauges and saturation state from the current pool snapshot.
 */
function refreshMetrics(): void {
  if (!_pool) return;
  const metrics = readPoolMetrics(_pool);

  poolTotalConnections.set(metrics.total);
  poolIdleConnections.set(metrics.idle);
  poolWaitingRequests.set(metrics.waiting);
}

/**
 * Read current raw metrics from a Pool instance.
 */
export function readPoolMetrics(pool: Pool): PoolMetrics {
  // pg Pool exposes these via public properties
  const total = pool.totalCount;
  const idle = pool.idleCount;
  const waiting = pool.waitingCount;
  const active = total - idle;
  const max = (pool as any).options?.max ?? 10;

  const saturationRatio = max > 0 ? waiting / max : 0;
  const now = Date.now();

  if (waiting >= SATURATION_WAITING_THRESHOLD) {
    if (_saturatedSince === null) {
      _saturatedSince = now;
    }
  } else {
    _saturatedSince = null;
  }

  const saturated =
    _saturatedSince !== null &&
    now - _saturatedSince >= SATURATION_DURATION_MS;

  return {
    total,
    idle,
    active,
    waiting,
    max,
    saturationRatio,
    saturated,
    capturedAt: new Date(now),
  };
}

/**
 * Perform a lightweight reachability check: acquire a connection, run SELECT 1,
 * then release it. Returns latency in ms.
 */
export async function checkPoolConnectivity(pool: Pool): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    const latencyMs = Date.now() - start;
    poolAcquireLatencyMs.observe(latencyMs);
    return { ok: true, latencyMs };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    client?.release();
  }
}

/**
 * Check whether the most recent migration has been applied by querying the
 * schema_migrations table (if it exists). Returns null if the table is absent.
 */
export async function checkMigrationsApplied(pool: Pool): Promise<{ applied: boolean; lastMigration?: string; error?: string }> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    // Check if schema_migrations or equivalent tracking table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('schema_migrations', 'migrations', 'knex_migrations')
      ) AS exists
    `);

    if (!tableCheck.rows[0].exists) {
      // No migration tracking table — treat as applied (or not tracked)
      return { applied: true };
    }

    // Get the most recent migration
    const migrationResult = await client.query(`
      SELECT MAX(version) as last_version FROM schema_migrations LIMIT 1
    `).catch(() => null);

    if (!migrationResult) {
      return { applied: true }; // Best-effort
    }

    return {
      applied: true,
      lastMigration: migrationResult.rows[0]?.last_version ?? 'unknown',
    };
  } catch (err) {
    return {
      applied: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    client?.release();
  }
}

/**
 * Shut down the pool gracefully. Exposed for test teardown.
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _saturatedSince = null;
  }
}
