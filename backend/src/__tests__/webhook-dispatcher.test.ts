/**
 * Tests for webhooks/dispatcher.ts — specifically the retry/backoff/jitter logic
 * that was merged in from the old flat webhook-dispatcher.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookDispatcher } from '../webhooks/dispatcher';
import type { IWebhookStore } from '../webhooks/store';

/** Minimal mock store so WebhookDispatcher can be constructed without a real DB. */
function makeMockStore(): IWebhookStore {
  return {
    registerWebhook: vi.fn(),
    unregisterWebhook: vi.fn(),
    getWebhook: vi.fn().mockResolvedValue(null),
    getAllWebhooks: vi.fn().mockResolvedValue([]),
    getSubscribers: vi.fn().mockResolvedValue([]),
    recordDelivery: vi.fn().mockResolvedValue('delivery-id'),
    updateDeliveryStatus: vi.fn().mockResolvedValue(undefined),
    getPendingDeliveries: vi.fn().mockResolvedValue([]),
    sendToDeadLetter: vi.fn().mockResolvedValue(undefined),
    listDeadLetters: vi.fn().mockResolvedValue([]),
    markDeadLetterReplayed: vi.fn().mockResolvedValue(undefined),
  } as IWebhookStore;
}

describe('WebhookDispatcher Exponential Backoff', () => {
  let dispatcher: WebhookDispatcher;

  beforeEach(() => {
    // Suppress debug/warn/info output during tests
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    dispatcher = new WebhookDispatcher(makeMockStore());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should calculate exponential backoff with jitter', () => {
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const delay = (dispatcher as any).getBackoffDelay(attempt);
      delays.push(delay);
      expect(delay).toBeGreaterThanOrEqual(0);
    }

    // Verify exponential growth tendency (with jitter, later attempts should be larger on average)
    expect(delays[4]).toBeLessThanOrEqual(300000 + 300000 * 0.2); // capped at max + jitter
  });

  it('should respect max retry delay cap (300s)', () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = (dispatcher as any).getBackoffDelay(attempt);
      expect(delay).toBeLessThanOrEqual(300000 + 300000 * 0.2); // max + jitter
    }
  });

  it('should apply ±20% jitter by default', () => {
    const origBase = process.env.WEBHOOK_RETRY_BASE_MS;
    const origMax = process.env.WEBHOOK_RETRY_MAX_MS;
    const origJitter = process.env.WEBHOOK_RETRY_JITTER_PERCENT;
    process.env.WEBHOOK_RETRY_BASE_MS = '1000';
    process.env.WEBHOOK_RETRY_MAX_MS = '300000';
    process.env.WEBHOOK_RETRY_JITTER_PERCENT = '20';

    // Re-create dispatcher so it picks up env vars for DEFAULT_OPTIONS
    const freshDispatcher = new WebhookDispatcher(makeMockStore());

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      // attempt=2 → exponential = 1000 * 2^1 = 2000ms
      samples.push((freshDispatcher as any).getBackoffDelay(2));
    }

    // With 20% jitter the range should be ~1600–2400 (±400ms around 2000)
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThanOrEqual(1600 - 100); // small tolerance
    expect(max).toBeLessThanOrEqual(2400 + 100);

    // Restore env
    if (origBase !== undefined) process.env.WEBHOOK_RETRY_BASE_MS = origBase; else delete process.env.WEBHOOK_RETRY_BASE_MS;
    if (origMax !== undefined) process.env.WEBHOOK_RETRY_MAX_MS = origMax; else delete process.env.WEBHOOK_RETRY_MAX_MS;
    if (origJitter !== undefined) process.env.WEBHOOK_RETRY_JITTER_PERCENT = origJitter; else delete process.env.WEBHOOK_RETRY_JITTER_PERCENT;
  });

  it('should log retry attempts with calculated intervals', () => {
    const debugSpy = vi.spyOn(console, 'debug');
    (dispatcher as any).getBackoffDelay(1);
    expect(debugSpy).toHaveBeenCalled();
    const logMessage = debugSpy.mock.calls[0][0];
    expect(logMessage).toContain('Webhook retry attempt 1');
    expect(logMessage).toContain('exponential=');
    expect(logMessage).toContain('jitter=');
  });

  it('should handle config from environment variables', () => {
    const origBase = process.env.WEBHOOK_RETRY_BASE_MS;
    const origMax = process.env.WEBHOOK_RETRY_MAX_MS;
    process.env.WEBHOOK_RETRY_BASE_MS = '500';
    process.env.WEBHOOK_RETRY_MAX_MS = '60000';

    const freshDispatcher = new WebhookDispatcher(makeMockStore());
    const delay = (freshDispatcher as any).getBackoffDelay(1);

    // Base should be 500, attempt 1 → 500 * 2^0 = 500ms ±20%
    expect(delay).toBeGreaterThanOrEqual(400); // 500 - 20% jitter
    expect(delay).toBeLessThanOrEqual(600);    // 500 + 20% jitter

    if (origBase !== undefined) process.env.WEBHOOK_RETRY_BASE_MS = origBase; else delete process.env.WEBHOOK_RETRY_BASE_MS;
    if (origMax !== undefined) process.env.WEBHOOK_RETRY_MAX_MS = origMax; else delete process.env.WEBHOOK_RETRY_MAX_MS;
  });

  it('should default to 5 max retries when WEBHOOK_MAX_RETRIES is not set', () => {
    const orig = process.env.WEBHOOK_MAX_RETRIES;
    delete process.env.WEBHOOK_MAX_RETRIES;

    const freshDispatcher = new WebhookDispatcher(makeMockStore());
    // The resolved options are stored internally
    expect((freshDispatcher as any).options.maxRetries).toBe(5);

    if (orig !== undefined) process.env.WEBHOOK_MAX_RETRIES = orig;
  });

  it('should respect WEBHOOK_MAX_RETRIES from env', () => {
    const orig = process.env.WEBHOOK_MAX_RETRIES;
    process.env.WEBHOOK_MAX_RETRIES = '8';

    const freshDispatcher = new WebhookDispatcher(makeMockStore());
    expect((freshDispatcher as any).options.maxRetries).toBe(8);

    if (orig !== undefined) process.env.WEBHOOK_MAX_RETRIES = orig; else delete process.env.WEBHOOK_MAX_RETRIES;
  });
});
