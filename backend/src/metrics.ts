import { Pool } from 'pg';
import { createLogger } from './correlation-id';
import { FxRateCache } from './fx-rate-cache';

export class MetricsService {
  private pool: Pool;
  private logger = createLogger('MetricsService');
  private fxRateCache?: FxRateCache;

  // Metrics storage
  private metrics = {
    swiftremit_settlements_total: {} as Record<string, number>,
    swiftremit_webhook_deliveries_total: {} as Record<string, number>,
    swiftremit_active_remittances: 0,
    swiftremit_accumulated_fees: 0,
  };

  // FX rate staleness metrics
  private fxRateAgeSeconds: Map<string, number> = new Map();
  private fxCacheHitsTotal = 0;
  private fxCacheMissesTotal = 0;

  constructor(pool: Pool, fxRateCache?: FxRateCache) {
    this.pool = pool;
    this.fxRateCache = fxRateCache;
  }

  /** Record a cache hit for a currency pair. */
  recordFxCacheHit(from: string, to: string): void {
    this.fxCacheHitsTotal++;
    // Age is 0 when served from live cache (fresh)
    const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
    this.fxRateAgeSeconds.set(key, 0);
  }

  /** Record a cache miss and the age of the rate that was fetched. */
  recordFxCacheMiss(from: string, to: string, rateTimestamp: Date): void {
    this.fxCacheMissesTotal++;
    const ageSeconds = (Date.now() - rateTimestamp.getTime()) / 1000;
    const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
    this.fxRateAgeSeconds.set(key, ageSeconds);
  }

  /** Update the recorded age for a currency pair (call after each successful fetch). */
  updateFxRateAge(from: string, to: string, rateTimestamp: Date): void {
    const ageSeconds = (Date.now() - rateTimestamp.getTime()) / 1000;
    const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
    this.fxRateAgeSeconds.set(key, ageSeconds);
  }

  /**
   * Update settlement metrics
   */
  async updateSettlementMetrics(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT status, COUNT(*) as count 
         FROM transactions 
         WHERE kind = 'withdrawal' 
         GROUP BY status`
      );

      this.metrics.swiftremit_settlements_total = {};
      result.rows.forEach(row => {
        this.metrics.swiftremit_settlements_total[row.status] = parseInt(row.count);
      });

      this.logger.debug('Settlement metrics updated', {
        metrics: this.metrics.swiftremit_settlements_total,
      });
    } catch (error) {
      this.logger.error('Failed to update settlement metrics', error);
    }
  }

  /**
   * Update webhook delivery metrics
   */
  async updateWebhookDeliveryMetrics(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT status, COUNT(*) as count 
         FROM webhook_deliveries 
         GROUP BY status`
      );

      this.metrics.swiftremit_webhook_deliveries_total = {};
      result.rows.forEach(row => {
        this.metrics.swiftremit_webhook_deliveries_total[row.status] = parseInt(row.count);
      });

      this.logger.debug('Webhook delivery metrics updated', {
        metrics: this.metrics.swiftremit_webhook_deliveries_total,
      });
    } catch (error) {
      this.logger.error('Failed to update webhook delivery metrics', error);
    }
  }

  /**
   * Update active remittances gauge
   */
  async updateActiveRemittances(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) as count 
         FROM transactions 
         WHERE status IN ('pending', 'processing', 'submitted')`
      );

      this.metrics.swiftremit_active_remittances = parseInt(result.rows[0].count);

      this.logger.debug('Active remittances updated', {
        count: this.metrics.swiftremit_active_remittances,
      });
    } catch (error) {
      this.logger.error('Failed to update active remittances', error);
    }
  }

  /**
   * Update accumulated fees gauge
   */
  async updateAccumulatedFees(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COALESCE(SUM(amount_fee), 0) as total_fees 
         FROM transactions 
         WHERE status = 'completed'`
      );

      this.metrics.swiftremit_accumulated_fees = parseFloat(result.rows[0].total_fees);

      this.logger.debug('Accumulated fees updated', {
        fees: this.metrics.swiftremit_accumulated_fees,
      });
    } catch (error) {
      this.logger.error('Failed to update accumulated fees', error);
    }
  }

  /**
   * Update all metrics
   */
  async updateAllMetrics(): Promise<void> {
    await Promise.all([
      this.updateSettlementMetrics(),
      this.updateWebhookDeliveryMetrics(),
      this.updateActiveRemittances(),
      this.updateAccumulatedFees(),
    ]);
  }

  /**
   * Generate Prometheus text format output
   */
  generatePrometheusText(): string {
    const lines: string[] = [];

    // Settlements counter
    lines.push('# HELP swiftremit_settlements_total Total number of settlements by status');
    lines.push('# TYPE swiftremit_settlements_total counter');
    Object.entries(this.metrics.swiftremit_settlements_total).forEach(([status, count]) => {
      lines.push(`swiftremit_settlements_total{status="${status}"} ${count}`);
    });

    // Webhook deliveries counter
    lines.push('# HELP swiftremit_webhook_deliveries_total Total number of webhook deliveries by result');
    lines.push('# TYPE swiftremit_webhook_deliveries_total counter');
    Object.entries(this.metrics.swiftremit_webhook_deliveries_total).forEach(([result, count]) => {
      lines.push(`swiftremit_webhook_deliveries_total{result="${result}"} ${count}`);
    });

    // Active remittances gauge
    lines.push('# HELP swiftremit_active_remittances Number of active remittances');
    lines.push('# TYPE swiftremit_active_remittances gauge');
    lines.push(`swiftremit_active_remittances ${this.metrics.swiftremit_active_remittances}`);

    // Accumulated fees gauge
    lines.push('# HELP swiftremit_accumulated_fees Total accumulated fees from completed transactions');
    lines.push('# TYPE swiftremit_accumulated_fees gauge');
    lines.push(`swiftremit_accumulated_fees ${this.metrics.swiftremit_accumulated_fees}`);

    // FX rate age gauge (per currency pair)
    lines.push('# HELP fx_rate_age_seconds Age of the cached FX rate in seconds');
    lines.push('# TYPE fx_rate_age_seconds gauge');
    this.fxRateAgeSeconds.forEach((ageSeconds, key) => {
      const [from, to] = key.split('_');
      lines.push(`fx_rate_age_seconds{from="${from}",to="${to}"} ${ageSeconds.toFixed(3)}`);
    });

    // FX cache hit counter
    lines.push('# HELP fx_rate_cache_hits_total Total number of FX rate cache hits');
    lines.push('# TYPE fx_rate_cache_hits_total counter');
    lines.push(`fx_rate_cache_hits_total ${this.fxCacheHitsTotal}`);

    // FX cache miss counter
    lines.push('# HELP fx_rate_cache_misses_total Total number of FX rate cache misses');
    lines.push('# TYPE fx_rate_cache_misses_total counter');
    lines.push(`fx_rate_cache_misses_total ${this.fxCacheMissesTotal}`);

    return lines.join('\n') + '\n';
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    await this.updateAllMetrics();
    return this.generatePrometheusText();
  }
}

// Singleton instance
let metricsServiceInstance: MetricsService | null = null;

export function getMetricsService(pool: Pool, fxRateCache?: FxRateCache): MetricsService {
  if (!metricsServiceInstance) {
    metricsServiceInstance = new MetricsService(pool, fxRateCache);
  }
  return metricsServiceInstance;
}
