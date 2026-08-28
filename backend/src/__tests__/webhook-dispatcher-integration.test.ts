/**
 * Integration test for PostgresWebhookStore + WebhookDispatcher against a
 * real, migrated Postgres database.
 *
 * Previously PostgresWebhookStore queried a `webhooks` table with an `events`
 * JSONB column and inserted into webhook_deliveries using columns
 * (webhook_id, attempt, max_retries) — none of which exist. The only
 * migrations that actually run create `webhook_subscribers` (id, url,
 * secret, active) and `webhook_deliveries` (subscriber_id, target_url,
 * event_key, attempt_count, max_attempts). This was entirely masked in
 * webhook-handler-remittance.test.ts, which mocks
 * `PostgresWebhookStore: vi.fn().mockImplementation(() => ({}))` so none of
 * the SQL in the store ever actually executes.
 *
 * This test runs the real migrations against a throwaway schema, then
 * exercises PostgresWebhookStore and WebhookDispatcher directly (mocking
 * only the outbound HTTP call, not the store) to prove the SQL is correct
 * against the real schema.
 *
 * Skipped automatically when DATABASE_URL is not set, matching the pattern
 * used by migration-roundtrip.test.ts. CI sets DATABASE_URL before running
 * this suite (see .github/workflows/migration-tests.yml).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import axios from 'axios';

vi.mock('axios');

import { PostgresWebhookStore } from '../webhooks/store';
import { WebhookDispatcher } from '../webhooks/dispatcher';
import type { WebhookPayload, RemittanceData } from '../webhooks/types';

const DB_URL = process.env.DATABASE_URL;
const RUN_DB_TESTS = !!DB_URL;

describe.skipIf(!RUN_DB_TESTS)('PostgresWebhookStore + WebhookDispatcher (real DB)', () => {
  let pool: Pool;
  let store: PostgresWebhookStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });

    const { migrate } = await import('../migrate');
    await migrate(pool);

    store = new PostgresWebhookStore(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('registers a webhook against webhook_subscribers (not a nonexistent "webhooks" table)', async () => {
    const url = `https://example.test/webhook-${Date.now()}`;
    const subscriber = await store.registerWebhook(url, ['remittance.created'], 'test-secret');

    expect(subscriber.id).toBeTruthy();
    expect(subscriber.url).toBe(url);
    expect(subscriber.active).toBe(true);

    const fetched = await store.getWebhook(subscriber.id);
    expect(fetched?.url).toBe(url);
  });

  it('getSubscribers returns active subscribers without crashing on a missing "events" column', async () => {
    const url = `https://example.test/webhook-${Date.now()}-b`;
    await store.registerWebhook(url, ['remittance.completed'], 'secret2');

    const subscribers = await store.getSubscribers('remittance.completed');
    expect(subscribers.some(s => s.url === url)).toBe(true);
  });

  it('recordDelivery + updateDeliveryStatus + getPendingDeliveries round-trip through webhook_deliveries', async () => {
    const url = `https://example.test/webhook-${Date.now()}-c`;
    const subscriber = await store.registerWebhook(url, ['remittance.failed'], 'secret3');

    const deliveryId = await store.recordDelivery({
      webhookId: subscriber.id,
      eventType: 'remittance.failed',
      payload: { hello: 'world' },
      status: 'pending',
      attempt: 0,
      maxRetries: 5,
    });
    expect(deliveryId).toBeTruthy();

    const pending = await store.getPendingDeliveries(50);
    expect(pending.some(d => d.id === deliveryId)).toBe(true);

    await store.updateDeliveryStatus(deliveryId, 'success', 1);

    const pendingAfter = await store.getPendingDeliveries(50);
    expect(pendingAfter.some(d => d.id === deliveryId)).toBe(false);
  });

  it('WebhookDispatcher.dispatch() delivers through the real store end-to-end', async () => {
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      statusText: 'OK',
    });

    const url = `https://example.test/webhook-${Date.now()}-d`;
    await store.registerWebhook(url, ['remittance.created'], 'secret4');

    const dispatcher = new WebhookDispatcher(store, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any);

    const payload: WebhookPayload<RemittanceData> = {
      event: 'remittance.created',
      timestamp: new Date().toISOString(),
      data: {
        id: 'r-1',
        status: 'pending',
        amount: 100,
        currency: 'USD',
        recipientId: 'rec-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    const result = await dispatcher.dispatch('remittance.created', payload);
    expect(result.failed).toBe(0);
    expect(result.success).toBeGreaterThan(0);
    expect(axios.post).toHaveBeenCalled();
  });
});
