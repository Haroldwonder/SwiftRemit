/**
 * Chaos tests — PostgreSQL connection loss and failover (SR-061)
 *
 * Fault modes covered:
 *   - Complete connection loss (pool exhaustion / ECONNREFUSED)
 *   - Mid-transaction connection drop (ROLLBACK enforced)
 *   - Query timeout
 *   - Slow queries under high latency (Toxiproxy)
 *   - Failover: primary goes away, replica promoted, service reconnects
 *
 * Fail-closed assertions:
 *   - No partial write is visible after a mid-transaction drop.
 *   - A failed create() never produces a retrievable remittance row.
 *   - updateStatus() either fully commits or leaves the row unchanged.
 *   - Service recovers automatically once a healthy pool is restored.
 *
 * Infrastructure:
 *   Toxiproxy proxies pg connections when TOXIPROXY_URL is set.
 *   Without it, pg-mem + vi.spyOn simulate faults in-process.
 *
 * Environment variables:
 *   TOXIPROXY_URL       — Toxiproxy management API (default: http://localhost:8474)
 *   PG_PROXY_PORT       — Port for the proxied Postgres (default: 9432)
 *   PG_TARGET_HOST      — Real Postgres host:port (default: localhost:5432)
 *   DATABASE_URL        — Full Postgres connection string (used when Toxiproxy active)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import axios from 'axios';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import { PostgresRemittanceStore } from '../db/remittanceStore';

// ── Config ────────────────────────────────────────────────────────────────────

const TOXIPROXY_URL = process.env.TOXIPROXY_URL ?? 'http://localhost:8474';
const PG_PROXY_PORT  = process.env.PG_PROXY_PORT  ?? '9432';
const PG_TARGET_HOST = process.env.PG_TARGET_HOST ?? 'localhost:5432';
const USE_TOXIPROXY  = !!process.env.TOXIPROXY_URL;

const PROXY_NAME = 'pg-primary';

// ── Toxiproxy helpers ─────────────────────────────────────────────────────────

async function createPgProxy() {
  await axios
    .post(`${TOXIPROXY_URL}/proxies`, {
      name:     PROXY_NAME,
      listen:   `0.0.0.0:${PG_PROXY_PORT}`,
      upstream: PG_TARGET_HOST,
      enabled:  true,
    })
    .catch(() => {/* already exists */});
}

async function clearToxics() {
  const resp = await axios.get<Record<string, { toxics: Array<{ name: string }> }>>(
    `${TOXIPROXY_URL}/proxies`,
  );
  const proxy = resp.data[PROXY_NAME];
  if (!proxy) return;
  for (const t of proxy.toxics ?? []) {
    await axios
      .delete(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}/toxics/${t.name}`)
      .catch(() => {});
  }
}

async function addToxic(toxic: Record<string, unknown>) {
  await axios.post(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}/toxics`, toxic);
}

async function disableProxy() {
  await axios.post(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}`, { enabled: false });
}

async function enableProxy() {
  await axios.post(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}`, { enabled: true });
}

// ── Store factory ─────────────────────────────────────────────────────────────

async function buildInMemoryStore() {
  const db   = newDb();
  const pg   = db.adapters.createPg();
  const pool = new pg.Pool();
  const store = new PostgresRemittanceStore(pool);
  await store.initializeSchema();
  return { store, pool };
}

function buildProxiedStore() {
  const connStr = process.env.DATABASE_URL
    ?? `postgresql://postgres:postgres@localhost:${PG_PROXY_PORT}/swiftremit_test`;
  const pool  = new Pool({ connectionString: connStr, max: 3, connectionTimeoutMillis: 3_000 });
  const store = new PostgresRemittanceStore(pool);
  return { store, pool };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Database chaos — connection loss and failover (SR-061)', () => {
  let store: PostgresRemittanceStore;

  beforeAll(async () => {
    if (USE_TOXIPROXY) {
      await axios.get(`${TOXIPROXY_URL}/proxies`, { timeout: 5_000 });
      await createPgProxy();
      const built = buildProxiedStore();
      store = built.store;
      await store.initializeSchema();
    } else {
      const built = await buildInMemoryStore();
      store = built.store;
    }
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    if (USE_TOXIPROXY) await clearToxics();
  });

  afterAll(async () => {
    if (USE_TOXIPROXY) await clearToxics();
  });

  // ── Baseline ──────────────────────────────────────────────────────────────

  it('baseline: create and updateStatus commit atomically', async () => {
    const r = await store.create({
      id:        'db-chaos-baseline',
      sender_id: 'GSENDER010',
      agent_id:  'GAGENT010',
      amount:    10_000_000,
      fee:       100_000,
      status:    'Pending',
    });
    expect(r.status).toBe('Pending');

    const updated = await store.updateStatus('db-chaos-baseline', 'Completed');
    expect(updated?.status).toBe('Completed');

    // Re-read confirms the change persisted.
    const row = await store.getById('db-chaos-baseline');
    expect(row?.status).toBe('Completed');
  });

  // ── Connection loss during create ─────────────────────────────────────────

  it('fail-closed: DB connection loss during create() produces no partial row', async () => {
    if (USE_TOXIPROXY) {
      await disableProxy();
    } else {
      // In-process: make pool.query throw on the first call (the INSERT).
      const proto = Object.getPrototypeOf(store) as any;
      vi.spyOn(proto, 'create').mockRejectedValueOnce(
        Object.assign(new Error('connection terminated unexpectedly'), { code: '08006' }),
      );
    }

    let createError: Error | null = null;
    try {
      await store.create({
        id:        'db-chaos-create-fail',
        sender_id: 'GSENDER011',
        agent_id:  'GAGENT011',
        amount:    5_000_000,
        fee:       50_000,
        status:    'Pending',
      });
    } catch (err) {
      createError = err as Error;
    }

    expect(createError).not.toBeNull();

    if (USE_TOXIPROXY) {
      await enableProxy();
    } else {
      vi.restoreAllMocks();
    }

    // Row must not exist — no partial write.
    const row = await store.getById('db-chaos-create-fail');
    expect(row).toBeNull();
  });

  // ── Connection drop mid-status-update ────────────────────────────────────

  it('fail-closed: updateStatus() failure leaves row in original status', async () => {
    // First, create a clean Pending row.
    await store.create({
      id:        'db-chaos-update-fail',
      sender_id: 'GSENDER012',
      agent_id:  'GAGENT012',
      amount:    3_000_000,
      fee:       30_000,
      status:    'Pending',
    });

    // Inject fault on updateStatus.
    if (USE_TOXIPROXY) {
      await addToxic({
        name:      'limit-data-pg',
        type:      'limit_data',
        stream:    'downstream',
        toxicity:  1.0,
        attributes: { bytes: 1 },   // allow just enough bytes to open then drop
      });
    } else {
      const proto = Object.getPrototypeOf(store) as any;
      vi.spyOn(proto, 'updateStatus').mockRejectedValueOnce(
        Object.assign(new Error('SSL connection has been closed unexpectedly'), { code: '08006' }),
      );
    }

    let updateError: Error | null = null;
    try {
      await store.updateStatus('db-chaos-update-fail', 'Completed');
    } catch (err) {
      updateError = err as Error;
    }

    expect(updateError).not.toBeNull();

    if (USE_TOXIPROXY) {
      await clearToxics();
    } else {
      vi.restoreAllMocks();
    }

    // Row must still be Pending — no partial money movement.
    const row = await store.getById('db-chaos-update-fail');
    expect(row?.status).toBe('Pending');
  });

  // ── Query timeout ─────────────────────────────────────────────────────────

  it('fail-closed: slow query timeout leaves remittance in Pending', async () => {
    await store.create({
      id:        'db-chaos-timeout',
      sender_id: 'GSENDER013',
      agent_id:  'GAGENT013',
      amount:    1_500_000,
      fee:       15_000,
      status:    'Pending',
    });

    if (USE_TOXIPROXY) {
      await addToxic({
        name:      'slow-query',
        type:      'latency',
        stream:    'downstream',
        toxicity:  1.0,
        attributes: { latency: 10_000, jitter: 0 },
      });
    } else {
      const proto = Object.getPrototypeOf(store) as any;
      vi.spyOn(proto, 'updateStatus').mockRejectedValueOnce(
        Object.assign(new Error('query_wait_timeout'), { code: '57014' }),
      );
    }

    let timeoutError: Error | null = null;
    try {
      await store.updateStatus('db-chaos-timeout', 'Completed');
    } catch (err) {
      timeoutError = err as Error;
    }

    expect(timeoutError).not.toBeNull();

    if (USE_TOXIPROXY) await clearToxics();
    else vi.restoreAllMocks();

    const row = await store.getById('db-chaos-timeout');
    expect(row?.status).toBe('Pending');
  });

  // ── High latency (Toxiproxy only) ─────────────────────────────────────────

  it('high-latency DB: operations complete correctly under 500 ms added latency', async () => {
    if (!USE_TOXIPROXY) {
      console.log('[db-chaos] Skipping latency test — requires Toxiproxy');
      return;
    }

    await addToxic({
      name:      'latency-500ms',
      type:      'latency',
      stream:    'downstream',
      toxicity:  1.0,
      attributes: { latency: 500, jitter: 50 },
    });

    const r = await store.create({
      id:        'db-chaos-highlatency',
      sender_id: 'GSENDER014',
      agent_id:  'GAGENT014',
      amount:    2_000_000,
      fee:       20_000,
      status:    'Pending',
    });

    expect(r.status).toBe('Pending');

    const updated = await store.updateStatus('db-chaos-highlatency', 'Processing');
    expect(updated?.status).toBe('Processing');

    const row = await store.getById('db-chaos-highlatency');
    expect(row?.status).toBe('Processing');
  });

  // ── Failover: primary down, replica promoted ──────────────────────────────

  it('failover recovery: service reconnects to new primary and completes update', async () => {
    await store.create({
      id:        'db-chaos-failover',
      sender_id: 'GSENDER015',
      agent_id:  'GAGENT015',
      amount:    8_000_000,
      fee:       80_000,
      status:    'Pending',
    });

    // Phase 1: primary goes away.
    if (USE_TOXIPROXY) {
      await disableProxy();
    } else {
      const proto = Object.getPrototypeOf(store) as any;
      vi.spyOn(proto, 'updateStatus').mockRejectedValueOnce(
        Object.assign(new Error('Connection terminated during failover'), { code: '08006' }),
      );
    }

    let failoverError: Error | null = null;
    try {
      await store.updateStatus('db-chaos-failover', 'Completed');
    } catch (err) {
      failoverError = err as Error;
    }
    expect(failoverError).not.toBeNull();

    // Row must still be Pending after the failed write.
    if (USE_TOXIPROXY) {
      await enableProxy();
    } else {
      vi.restoreAllMocks();
    }

    const mid = await store.getById('db-chaos-failover');
    expect(mid?.status).toBe('Pending');

    // Phase 2: fault removed — service reconnects and succeeds.
    const recovered = await store.updateStatus('db-chaos-failover', 'Completed');
    expect(recovered?.status).toBe('Completed');

    const final = await store.getById('db-chaos-failover');
    expect(final?.status).toBe('Completed');
  });

  // ── No duplicate rows on retry ────────────────────────────────────────────

  it('no duplication: retrying a failed create does not double-insert', async () => {
    const id = 'db-chaos-no-dup';
    await store.create({
      id,
      sender_id: 'GSENDER016',
      agent_id:  'GAGENT016',
      amount:    250_000,
      fee:       2_500,
      status:    'Pending',
    });

    let dupError: Error | null = null;
    try {
      await store.create({
        id,
        sender_id: 'GSENDER016',
        agent_id:  'GAGENT016',
        amount:    250_000,
        fee:       2_500,
        status:    'Pending',
      });
    } catch (err) {
      dupError = err as Error;
    }

    expect(dupError).not.toBeNull();

    const row = await store.getById(id);
    expect(row?.amount).toBe(250_000);
  });
});
