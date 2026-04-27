import { describe, it, expect, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { MetricsService } from '../metrics';

const createMockPool = (): Pool => ({}) as Pool;

describe('MetricsService — FX staleness metrics', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService(createMockPool());
  });

  it('exposes fx_rate_age_seconds gauge per currency pair', () => {
    const ts = new Date(Date.now() - 120_000); // 2 minutes ago
    service.updateFxRateAge('USD', 'PHP', ts);

    const output = service.generatePrometheusText();
    expect(output).toContain('fx_rate_age_seconds{from="USD",to="PHP"}');
    // Age should be approximately 120 s
    const match = output.match(/fx_rate_age_seconds\{from="USD",to="PHP"\} ([\d.]+)/);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeGreaterThanOrEqual(119);
  });

  it('increments fx_rate_cache_hits_total on recordFxCacheHit', () => {
    service.recordFxCacheHit('USD', 'EUR');
    service.recordFxCacheHit('USD', 'EUR');

    const output = service.generatePrometheusText();
    expect(output).toContain('fx_rate_cache_hits_total 2');
  });

  it('increments fx_rate_cache_misses_total on recordFxCacheMiss', () => {
    service.recordFxCacheMiss('USD', 'GBP', new Date());

    const output = service.generatePrometheusText();
    expect(output).toContain('fx_rate_cache_misses_total 1');
  });

  it('exposes multiple currency pairs independently', () => {
    service.updateFxRateAge('USD', 'EUR', new Date(Date.now() - 10_000));
    service.updateFxRateAge('USD', 'PHP', new Date(Date.now() - 400_000));

    const output = service.generatePrometheusText();
    expect(output).toContain('fx_rate_age_seconds{from="USD",to="EUR"}');
    expect(output).toContain('fx_rate_age_seconds{from="USD",to="PHP"}');

    const phpMatch = output.match(/fx_rate_age_seconds\{from="USD",to="PHP"\} ([\d.]+)/);
    expect(phpMatch).not.toBeNull();
    // PHP rate is >300 s old — would trigger the Prometheus alert
    expect(parseFloat(phpMatch![1])).toBeGreaterThan(300);
  });
});
