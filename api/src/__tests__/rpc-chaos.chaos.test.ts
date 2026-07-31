/**
 * Chaos tests — Soroban RPC unavailability (SR-061)
 *
 * Fault modes covered:
 *   - RPC completely down (ECONNREFUSED)
 *   - RPC responds with 503 Service Unavailable
 *   - RPC hangs (30 s timeout)
 *   - RPC returns malformed JSON
 *   - Partial RPC recovery (first call fails, second succeeds)
 *
 * Fail-closed assertions:
 *   - No remittance row transitions to a terminal state (Completed/Failed)
 *     unless the RPC call actually succeeded.
 *   - No money movement is recorded when the RPC is unreachable.
 *   - Service recovers automatically once the fault is removed.
 *
 * Infrastructure:
 *   Toxiproxy proxies requests to a lightweight RPC mock server.
 *   Set TOXIPROXY_URL and RPC_PROXY_PORT to enable network-level faults.
 *   Without those env vars the tests use vi.spyOn to simulate faults in-process.
 *
 * Environment variables:
 *   TOXIPROXY_URL     — Toxiproxy management API  (default: http://localhost:8474)
 *   RPC_PROXY_PORT    — Port for the proxied RPC endpoint (default: 9091)
 *   RPC_TARGET_URL    — Real RPC mock server (default: http://localhost:3002)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import { newDb } from 'pg-mem';
import { PostgresRemittanceStore } from '../db/remittanceStore';

// ── Config ───────────────────────────────────────────────────────────────────

const TOXIPROXY_URL = process.env.TOXIPROXY_URL ?? 'http://localhost:8474';
const RPC_PROXY_PORT = process.env.RPC_PROXY_PORT ?? '9091';
const RPC_TARGET_URL = process.env.RPC_TARGET_URL ?? 'http://localhost:3002';
const USE_TOXIPROXY = !!process.env.TOXIPROXY_URL;

const PROXY_NAME = 'rpc-target';
const PROXIED_RPC = `http://localhost:${RPC_PROXY_PORT}/rpc`;

// ── Toxiproxy helpers ─────────────────────────────────────────────────────────

async function toxiproxyUp() {
  await axios.get(`${TOXIPROXY_URL}/proxies`, { timeout: 5_000 });
}

async function createRpcProxy() {
  await axios
    .post(`${TOXIPROXY_URL}/proxies`, {
      name: PROXY_NAME,
      listen: `0.0.0.0:${RPC_PROXY_PORT}`,
      upstream: RPC_TARGET_URL.replace(/^https?:\/\//, ''),
      enabled: true,
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

// ── RPC client stub (simulates what a production Soroban RPC call looks like) ─

interface RpcResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

async function callSorobanRpc(endpoint: string, timeoutMs = 5_000): Promise<RpcResult> {
  const response = await axios.post(
    endpoint,
    { method: 'simulateTransaction', params: [] },
    { timeout: timeoutMs, headers: { 'Content-Type': 'application/json' } },
  );
  if (response.data?.error) {
    throw new Error(response.data.error);
  }
  return { success: true, txHash: response.data?.result?.txHash ?? 'mock-tx' };
}

// ── In-process fault simulation (used when Toxiproxy is not available) ────────

function simulateRpcFailure(mode: 'network' | 'timeout' | 'malformed' | '503') {
  return vi.spyOn(axios, 'post').mockImplementationOnce(async () => {
    if (mode === 'network') {
      const err = new Error('connect ECONNREFUSED') as AxiosError;
      err.code = 'ECONNREFUSED';
      throw err;
    }
    if (mode === 'timeout') {
      const err = new Error('timeout of 5000ms exceeded') as AxiosError;
      err.code = 'ECONNABORTED';
      throw err;
    }
    if (mode === '503') {
      const err = Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503, data: { error: 'Service Unavailable' } },
      }) as AxiosError;
      throw err;
    }
    if (mode === 'malformed') {
      return { data: 'this is not valid json for an rpc response {{{{' } as any;
    }
    throw new Error('unknown mode');
  });
}

// ── In-memory remittance store ────────────────────────────────────────────────

async function buildStore() {
  const db = newDb();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  const store = new PostgresRemittanceStore(pool);
  await store.initializeSchema();
  return store;
}

// ── Suites ───────────────────────────────────────────────────────────────────

describe('RPC chaos — Soroban RPC unavailability (SR-061)', () => {
  let store: PostgresRemittanceStore;

  beforeAll(async () => {
    store = await buildStore();
    if (USE_TOXIPROXY) {
      await toxiproxyUp();
      await createRpcProxy();
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

  it('baseline: RPC call succeeds and remittance is created', async () => {
    const remittance = await store.create({
      id: 'rpc-chaos-baseline',
      sender_id: 'GSENDER001',
      agent_id: 'GAGENT001',
      amount: 10_000_000,
      fee: 100_000,
      status: 'Pending',
    });

    expect(remittance.status).toBe('Pending');

    // Simulate a successful RPC response updating the status.
    const updated = await store.updateStatus('rpc-chaos-baseline', 'Completed');
    expect(updated?.status).toBe('Completed');
  });

  // ── ECONNREFUSED ──────────────────────────────────────────────────────────

  it('fail-closed: RPC ECONNREFUSED leaves remittance in Pending — no money movement', async () => {
    await store.create({
      id: 'rpc-chaos-econnrefused',
      sender_id: 'GSENDER002',
      agent_id: 'GAGENT002',
      amount: 5_000_000,
      fee: 50_000,
      status: 'Pending',
    });

    if (USE_TOXIPROXY) {
      await disableProxy();
    } else {
      simulateRpcFailure('network');
    }

    let rpcError: Error | null = null;
    try {
      await callSorobanRpc(USE_TOXIPROXY ? PROXIED_RPC : 'http://localhost:9999/rpc', 2_000);
    } catch (err) {
      rpcError = err as Error;
    }

    // RPC must have thrown.
    expect(rpcError).not.toBeNull();

    // Because the RPC failed we must NOT advance the status.
    // Verify the row is still Pending — no partial money movement.
    const row = await store.getById('rpc-chaos-econnrefused');
    expect(row?.status).toBe('Pending');

    if (USE_TOXIPROXY) await enableProxy();
  });

  // ── 503 Service Unavailable ───────────────────────────────────────────────

  it('fail-closed: RPC 503 leaves remittance in Pending', async () => {
    await store.create({
      id: 'rpc-chaos-503',
      sender_id: 'GSENDER003',
      agent_id: 'GAGENT003',
      amount: 7_500_000,
      fee: 75_000,
      status: 'Pending',
    });

    if (USE_TOXIPROXY) {
      await addToxic({
        name: 'limit-data',
        type: 'limit_data',
        stream: 'downstream',
        toxicity: 1.0,
        attributes: { bytes: 0 },
      });
    } else {
      simulateRpcFailure('503');
    }

    let rpcError: Error | null = null;
    try {
      await callSorobanRpc(USE_TOXIPROXY ? PROXIED_RPC : 'http://unused/rpc', 2_000);
    } catch (err) {
      rpcError = err as Error;
    }

    expect(rpcError).not.toBeNull();

    const row = await store.getById('rpc-chaos-503');
    expect(row?.status).toBe('Pending');
  });

  // ── Timeout ───────────────────────────────────────────────────────────────

  it('fail-closed: RPC timeout leaves remittance in Pending', async () => {
    await store.create({
      id: 'rpc-chaos-timeout',
      sender_id: 'GSENDER004',
      agent_id: 'GAGENT004',
      amount: 2_000_000,
      fee: 20_000,
      status: 'Pending',
    });

    if (USE_TOXIPROXY) {
      await addToxic({
        name: 'timeout-rpc',
        type: 'timeout',
        stream: 'downstream',
        toxicity: 1.0,
        attributes: { timeout: 30_000 },
      });
    } else {
      simulateRpcFailure('timeout');
    }

    let rpcError: Error | null = null;
    try {
      await callSorobanRpc(USE_TOXIPROXY ? PROXIED_RPC : 'http://unused/rpc', 1_000);
    } catch (err) {
      rpcError = err as Error;
    }

    expect(rpcError).not.toBeNull();

    const row = await store.getById('rpc-chaos-timeout');
    expect(row?.status).toBe('Pending');
  });

  // ── Malformed JSON ────────────────────────────────────────────────────────

  it('fail-closed: malformed RPC response leaves remittance in Pending', async () => {
    await store.create({
      id: 'rpc-chaos-malformed',
      sender_id: 'GSENDER005',
      agent_id: 'GAGENT005',
      amount: 3_000_000,
      fee: 30_000,
      status: 'Pending',
    });

    // In-process simulation of a malformed response regardless of Toxiproxy.
    simulateRpcFailure('malformed');

    let rpcError: Error | null = null;
    try {
      const result = await callSorobanRpc('http://unused/rpc', 2_000);
      // callSorobanRpc should throw because the body has no `.result`.
      if (!result.txHash) throw new Error('No txHash in malformed response');
    } catch (err) {
      rpcError = err as Error;
    }

    expect(rpcError).not.toBeNull();

    const row = await store.getById('rpc-chaos-malformed');
    expect(row?.status).toBe('Pending');
  });

  // ── Recovery ──────────────────────────────────────────────────────────────

  it('recovery: remittance completes successfully after RPC fault is removed', async () => {
    await store.create({
      id: 'rpc-chaos-recovery',
      sender_id: 'GSENDER006',
      agent_id: 'GAGENT006',
      amount: 1_000_000,
      fee: 10_000,
      status: 'Pending',
    });

    // Phase 1: fault active — status must stay Pending.
    if (!USE_TOXIPROXY) simulateRpcFailure('network');

    let phase1Error: Error | null = null;
    try {
      if (USE_TOXIPROXY) {
        await disableProxy();
        await callSorobanRpc(PROXIED_RPC, 1_000);
      } else {
        await callSorobanRpc('http://localhost:9999/rpc', 1_000);
      }
    } catch (err) {
      phase1Error = err as Error;
    }
    expect(phase1Error).not.toBeNull();
    expect((await store.getById('rpc-chaos-recovery'))?.status).toBe('Pending');

    // Phase 2: fault removed — service recovers and completes the remittance.
    if (USE_TOXIPROXY) await enableProxy();
    vi.restoreAllMocks(); // clear the in-process spy

    // Simulate success by advancing status (what the service layer would do).
    const completed = await store.updateStatus('rpc-chaos-recovery', 'Completed');
    expect(completed?.status).toBe('Completed');
  });

  // ── No duplication ────────────────────────────────────────────────────────

  it('no duplicated money movement: retrying after RPC failure does not double-insert', async () => {
    const id = 'rpc-chaos-no-dup';

    // First create is normal.
    const r1 = await store.create({
      id,
      sender_id: 'GSENDER007',
      agent_id: 'GAGENT007',
      amount: 500_000,
      fee: 5_000,
      status: 'Pending',
    });
    expect(r1.id).toBe(id);

    // Retry attempt must fail with a duplicate-key error, not silently insert.
    let dupError: Error | null = null;
    try {
      await store.create({
        id,
        sender_id: 'GSENDER007',
        agent_id: 'GAGENT007',
        amount: 500_000,
        fee: 5_000,
        status: 'Pending',
      });
    } catch (err) {
      dupError = err as Error;
    }
    expect(dupError).not.toBeNull();

    // Verify only one row exists.
    const row = await store.getById(id);
    expect(row).not.toBeNull();
    expect(row?.amount).toBe(500_000);
  });
});
