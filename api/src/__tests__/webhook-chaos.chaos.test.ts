/**
 * Chaos tests for webhook delivery under adverse network conditions.
 *
 * Uses Toxiproxy (https://github.com/Shopify/toxiproxy) for network fault injection.
 *
 * Prerequisites (CI):
 *   docker-compose -f tests/docker/chaos-docker-compose.yml up -d
 *
 * Environment variables:
 *   TOXIPROXY_URL      — Toxiproxy management API  (default: http://localhost:8474)
 *   WEBHOOK_PROXY_PORT — Port for the proxied webhook endpoint (default: 9090)
 *   WEBHOOK_TARGET_URL — Real webhook target behind Toxiproxy (default: http://localhost:3001)
 *
 * Faults tested:
 *   - 1 s added latency (slow endpoint)
 *   - Connection reset mid-stream
 *   - 30 s timeout (hung endpoint)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import axios from 'axios';
import { deliverWebhook, getDLQ, clearDLQ, WebhookPayload } from '../services/webhook';

const TOXIPROXY_URL = process.env.TOXIPROXY_URL ?? 'http://localhost:8474';
const WEBHOOK_PROXY_PORT = process.env.WEBHOOK_PROXY_PORT ?? '9090';
const WEBHOOK_TARGET_URL = process.env.WEBHOOK_TARGET_URL ?? 'http://localhost:3001';
const SKIP_CHAOS = !process.env.TOXIPROXY_URL && !process.env.CI;

const PROXY_NAME = 'webhook-target';
const PROXIED_ENDPOINT = `http://localhost:${WEBHOOK_PROXY_PORT}/webhook`;

const samplePayload: WebhookPayload = {
  event: 'remittance.completed',
  txId: 'CHAOS-TX-001',
  status: 'completed',
  amount: 100,
  currency: 'USDC',
  timestamp: '2024-06-01T10:00:00Z',
};

async function toxiproxyUp() {
  await axios.get(`${TOXIPROXY_URL}/proxies`, { timeout: 5_000 });
}

async function createProxy() {
  await axios
    .post(`${TOXIPROXY_URL}/proxies`, {
      name: PROXY_NAME,
      listen: `0.0.0.0:${WEBHOOK_PROXY_PORT}`,
      upstream: WEBHOOK_TARGET_URL.replace(/^https?:\/\//, ''),
      enabled: true,
    })
    .catch(() => {
      // Proxy may already exist from a previous run.
    });
}

async function deleteAllToxics() {
  const resp = await axios.get<Record<string, { toxics: Array<{ name: string }> }>>(
    `${TOXIPROXY_URL}/proxies`,
  );
  const proxy = resp.data[PROXY_NAME];
  if (!proxy) return;
  for (const toxic of proxy.toxics ?? []) {
    await axios
      .delete(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}/toxics/${toxic.name}`)
      .catch(() => {});
  }
}

async function addToxic(
  toxic: Record<string, unknown>,
) {
  await axios.post(`${TOXIPROXY_URL}/proxies/${PROXY_NAME}/toxics`, toxic);
}

async function resetProxy() {
  await deleteAllToxics();
}

function skipMsg() {
  if (SKIP_CHAOS) {
    console.log(
      'Skipping chaos tests: TOXIPROXY_URL not set and not in CI. ' +
        'Run: docker-compose -f tests/docker/chaos-docker-compose.yml up -d',
    );
  }
  return SKIP_CHAOS;
}

describe('Webhook chaos tests — Toxiproxy fault injection', () => {
  beforeAll(async () => {
    if (SKIP_CHAOS) return;
    await toxiproxyUp();
    await createProxy();
  });

  beforeEach(async () => {
    clearDLQ();
    if (!SKIP_CHAOS) await resetProxy();
  });

  afterAll(async () => {
    if (SKIP_CHAOS) return;
    await resetProxy();
  });

  it('delivers webhook successfully with no faults (baseline)', async () => {
    if (skipMsg()) return;

    const result = await deliverWebhook(PROXIED_ENDPOINT, samplePayload, {
      maxRetries: 3,
      baseDelayMs: 200,
      timeoutMs: 5_000,
    });

    expect(result.success).toBe(true);
    expect(result.dlq).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it('retries under 1s added latency and eventually succeeds', async () => {
    if (skipMsg()) return;

    await addToxic({
      name: 'latency-1s',
      type: 'latency',
      stream: 'downstream',
      toxicity: 1.0,
      attributes: { latency: 1000, jitter: 100 },
    });

    const result = await deliverWebhook(PROXIED_ENDPOINT, samplePayload, {
      maxRetries: 3,
      baseDelayMs: 200,
      timeoutMs: 5_000,
    });

    // With 1s latency added, delivery should still succeed within the 5s timeout.
    expect(result.success).toBe(true);
    expect(result.dlq).toBe(false);
  });

  it('retries on connection reset and sends to DLQ after max retries', async () => {
    if (skipMsg()) return;

    await addToxic({
      name: 'reset-peer',
      type: 'reset_peer',
      stream: 'downstream',
      toxicity: 1.0,
      attributes: { timeout: 0 },
    });

    const result = await deliverWebhook(PROXIED_ENDPOINT, samplePayload, {
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 500,
      timeoutMs: 3_000,
    });

    expect(result.success).toBe(false);
    expect(result.dlq).toBe(true);
    expect(result.attempts).toBe(3);

    const dlq = getDLQ();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].payload.txId).toBe('CHAOS-TX-001');
  });

  it('sends to DLQ after 30s timeout without hanging the test suite', async () => {
    if (skipMsg()) return;

    // Inject a 30s timeout toxic; our webhook timeout is 3s so it triggers immediately.
    await addToxic({
      name: 'timeout-30s',
      type: 'timeout',
      stream: 'downstream',
      toxicity: 1.0,
      attributes: { timeout: 30_000 },
    });

    const result = await deliverWebhook(PROXIED_ENDPOINT, samplePayload, {
      maxRetries: 1,
      baseDelayMs: 100,
      timeoutMs: 3_000,
    });

    expect(result.success).toBe(false);
    expect(result.dlq).toBe(true);
    expect(result.attempts).toBe(2);

    const dlq = getDLQ();
    expect(dlq).toHaveLength(1);
  });

  it('exponential backoff delays grow between retries', async () => {
    if (skipMsg()) return;

    const delays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;

    const spy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((fn, delay, ...args) => {
        if (typeof delay === 'number' && delay > 0) delays.push(delay);
        return origSetTimeout(fn as TimerHandler, 0, ...args);
      });

    await addToxic({
      name: 'reset-peer-backoff',
      type: 'reset_peer',
      stream: 'downstream',
      toxicity: 1.0,
      attributes: { timeout: 0 },
    });

    await deliverWebhook(PROXIED_ENDPOINT, samplePayload, {
      maxRetries: 3,
      baseDelayMs: 200,
      maxDelayMs: 10_000,
      timeoutMs: 3_000,
    });

    spy.mockRestore();

    expect(delays.length).toBeGreaterThan(0);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });
});
