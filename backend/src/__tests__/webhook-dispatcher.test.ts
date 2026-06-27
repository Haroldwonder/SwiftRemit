import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookDispatcher } from '../webhook-dispatcher';

describe('WebhookDispatcher Exponential Backoff', () => {
  let dispatcher: WebhookDispatcher;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    dispatcher = new WebhookDispatcher(mockFetch as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should calculate exponential backoff with jitter', () => {
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const delay = (dispatcher as any).retryDelayMs(attempt);
      delays.push(delay);
      expect(delay).toBeGreaterThanOrEqual(0);
    }

    // Verify exponential growth (with jitter, values should roughly follow exponential pattern)
    expect(delays[1]).toBeGreaterThanOrEqual(delays[0]); // 2^1 * base >= 2^0 * base (with jitter variance)
    expect(delays[4]).toBeLessThanOrEqual(300000); // Should be capped at max (300s)
  });

  it('should respect max retry delay cap (300s)', () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = (dispatcher as any).retryDelayMs(attempt);
      expect(delay).toBeLessThanOrEqual(300000 + 300000 * 0.2); // max + jitter
    }
  });

  it('should apply ±20% jitter by default', () => {
    const baseMsBefore = process.env.WEBHOOK_RETRY_BASE_MS;
    process.env.WEBHOOK_RETRY_BASE_MS = '1000';
    process.env.WEBHOOK_RETRY_MAX_MS = '300000';
    process.env.WEBHOOK_RETRY_JITTER_PERCENT = '20';

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push((dispatcher as any).retryDelayMs(2)); // 2^1 * 1000 = 2000
    }

    // With 20% jitter, range should be ~1600-2400
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThanOrEqual(1600 - 100); // Some variance ok
    expect(max).toBeLessThanOrEqual(2400 + 100);

    if (baseMsBefore !== undefined) {
      process.env.WEBHOOK_RETRY_BASE_MS = baseMsBefore;
    }
  });

  it('should log retry attempts with calculated intervals', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    (dispatcher as any).retryDelayMs(1);
    expect(consoleSpy).toHaveBeenCalled();
    const logMessage = consoleSpy.mock.calls[0][0];
    expect(logMessage).toContain('Webhook retry attempt 1');
    expect(logMessage).toContain('exponential=');
    expect(logMessage).toContain('jitter=');
  });

  it('should handle config from environment variables', () => {
    process.env.WEBHOOK_RETRY_BASE_MS = '500';
    process.env.WEBHOOK_RETRY_MAX_MS = '60000';

    const newDispatcher = new WebhookDispatcher(mockFetch as any);
    const delay = (newDispatcher as any).retryDelayMs(1);
    
    // Base should be 500, so attempt 1 = 2^0 * 500 = 500
    expect(delay).toBeGreaterThanOrEqual(400); // 500 - 20% jitter
    expect(delay).toBeLessThanOrEqual(600); // 500 + 20% jitter
  });
});
