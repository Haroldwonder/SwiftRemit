import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsService } from '../metrics';

/**
 * SR-104 — every alert in monitoring/alerts.yml needs a series to evaluate.
 * These tests pin the names and shapes the alert expressions depend on.
 */

/** Minimal pg Pool stand-in: every metrics query resolves to a canned row. */
function stubPool(rows: Record<string, unknown>[] = []) {
  return {
    idleCount: 4,
    waitingCount: 1,
    totalCount: 10,
    query: async () => ({ rows }),
  } as never;
}

describe('MetricsService — SLO and money-at-risk series', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService(stubPool());
  });

  it('exposes the contract pause gauge', () => {
    metrics.setContractPaused(true);
    expect(metrics.generatePrometheusText()).toContain('swiftremit_contract_paused 1');

    metrics.setContractPaused(false);
    expect(metrics.generatePrometheusText()).toContain('swiftremit_contract_paused 0');
  });

  it('exposes the provider circuit-breaker gauge per provider', () => {
    metrics.setCircuitOpen('fx', true);
    expect(metrics.generatePrometheusText()).toContain('swiftremit_circuit_open{provider="fx"} 1');

    metrics.setCircuitOpen('fx', false);
    expect(metrics.generatePrometheusText()).toContain('swiftremit_circuit_open{provider="fx"} 0');
  });

  it('declares the stuck-money and settlement-time gauges', () => {
    const text = metrics.generatePrometheusText();
    expect(text).toContain('# TYPE swiftremit_oldest_pending_remittance_age_seconds gauge');
    expect(text).toContain('# TYPE swiftremit_settlement_seconds_p95 gauge');
    expect(text).toContain('# TYPE swiftremit_failed_migrations gauge');
  });

  it('records HTTP requests as a counter keyed by method, route and status', () => {
    metrics.recordHttpRequest('get', '/api/remittances', 200, 0.12);
    metrics.recordHttpRequest('GET', '/api/remittances', 500, 3.4);

    const text = metrics.generatePrometheusText();
    expect(text).toContain(
      'swiftremit_http_requests_total{method="GET",route="/api/remittances",status="200"} 1',
    );
    expect(text).toContain(
      'swiftremit_http_requests_total{method="GET",route="/api/remittances",status="500"} 1',
    );
  });

  it('emits cumulative histogram buckets, sum and count for request duration', () => {
    metrics.recordHttpRequest('GET', '/health', 200, 0.02);
    metrics.recordHttpRequest('GET', '/health', 200, 0.4);

    const text = metrics.generatePrometheusText();
    const labels = 'method="GET",route="/health"';

    // 0.02s falls into every bucket from 0.025 up; 0.4s from 0.5 up.
    expect(text).toContain(
      `swiftremit_http_request_duration_seconds_bucket{${labels},le="0.01"} 0`,
    );
    expect(text).toContain(
      `swiftremit_http_request_duration_seconds_bucket{${labels},le="0.025"} 1`,
    );
    expect(text).toContain(
      `swiftremit_http_request_duration_seconds_bucket{${labels},le="0.5"} 2`,
    );
    expect(text).toContain(
      `swiftremit_http_request_duration_seconds_bucket{${labels},le="+Inf"} 2`,
    );
    expect(text).toContain(`swiftremit_http_request_duration_seconds_count{${labels}} 2`);
    expect(text).toMatch(
      new RegExp(`swiftremit_http_request_duration_seconds_sum\\{${labels.replace(/[/"]/g, '\\$&')}\\} 0\\.42`),
    );
  });

  it('treats the newest circuit-breaker event as the pause state', async () => {
    const paused = new MetricsService(stubPool([{ event_type: 'paused' }]));
    await paused.updateContractPauseState();
    expect(paused.generatePrometheusText()).toContain('swiftremit_contract_paused 1');

    const unpaused = new MetricsService(stubPool([{ event_type: 'unpaused' }]));
    await unpaused.updateContractPauseState();
    expect(unpaused.generatePrometheusText()).toContain('swiftremit_contract_paused 0');

    const never = new MetricsService(stubPool([]));
    await never.updateContractPauseState();
    expect(never.generatePrometheusText()).toContain('swiftremit_contract_paused 0');
  });
});
