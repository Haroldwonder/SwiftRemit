"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsService = void 0;
exports.getMetricsService = getMetricsService;
const correlation_id_1 = require("./correlation-id");
class MetricsService {
    pool;
    logger = (0, correlation_id_1.createLogger)('MetricsService');
    // Metrics storage
    metrics = {
        swiftremit_settlements_total: {},
        swiftremit_webhook_deliveries_total: {},
        swiftremit_active_remittances: 0,
        swiftremit_accumulated_fees: 0,
        swiftremit_fx_rate_staleness_seconds: {},
    };
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Update settlement metrics
     */
    async updateSettlementMetrics() {
        try {
            const result = await this.pool.query(`SELECT status, COUNT(*) as count 
         FROM transactions 
         WHERE kind = 'withdrawal' 
         GROUP BY status`);
            this.metrics.swiftremit_settlements_total = {};
            result.rows.forEach(row => {
                this.metrics.swiftremit_settlements_total[row.status] = parseInt(row.count);
            });
            this.logger.debug('Settlement metrics updated', {
                metrics: this.metrics.swiftremit_settlements_total,
            });
        }
        catch (error) {
            this.logger.error('Failed to update settlement metrics', error);
        }
    }
    /**
     * Update webhook delivery metrics
     */
    async updateWebhookDeliveryMetrics() {
        try {
            const result = await this.pool.query(`SELECT status, COUNT(*) as count 
         FROM webhook_deliveries 
         GROUP BY status`);
            this.metrics.swiftremit_webhook_deliveries_total = {};
            result.rows.forEach(row => {
                this.metrics.swiftremit_webhook_deliveries_total[row.status] = parseInt(row.count);
            });
            this.logger.debug('Webhook delivery metrics updated', {
                metrics: this.metrics.swiftremit_webhook_deliveries_total,
            });
        }
        catch (error) {
            this.logger.error('Failed to update webhook delivery metrics', error);
        }
    }
    /**
     * Update active remittances gauge
     */
    async updateActiveRemittances() {
        try {
            const result = await this.pool.query(`SELECT COUNT(*) as count 
         FROM transactions 
         WHERE status IN ('pending', 'processing', 'submitted')`);
            this.metrics.swiftremit_active_remittances = parseInt(result.rows[0].count);
            this.logger.debug('Active remittances updated', {
                count: this.metrics.swiftremit_active_remittances,
            });
        }
        catch (error) {
            this.logger.error('Failed to update active remittances', error);
        }
    }
    /**
     * Update accumulated fees gauge
     */
    async updateAccumulatedFees() {
        try {
            const result = await this.pool.query(`SELECT COALESCE(SUM(amount_fee), 0) as total_fees 
         FROM transactions 
         WHERE status = 'completed'`);
            this.metrics.swiftremit_accumulated_fees = parseFloat(result.rows[0].total_fees);
            this.logger.debug('Accumulated fees updated', {
                fees: this.metrics.swiftremit_accumulated_fees,
            });
        }
        catch (error) {
            this.logger.error('Failed to update accumulated fees', error);
        }
    }
    setFxRateStalenessMetric(from, to, stalenessSeconds) {
        const pairKey = `${from.toUpperCase()}/${to.toUpperCase()}`;
        this.metrics.swiftremit_fx_rate_staleness_seconds[pairKey] = stalenessSeconds;
    }
    /**
     * Update all metrics
     */
    async updateAllMetrics() {
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
    generatePrometheusText() {
        const lines = [];
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
        // FX rate staleness gauge by currency pair
        lines.push('# HELP swiftremit_fx_rate_staleness_seconds FX rate staleness in seconds by currency pair');
        lines.push('# TYPE swiftremit_fx_rate_staleness_seconds gauge');
        Object.entries(this.metrics.swiftremit_fx_rate_staleness_seconds).forEach(([pair, stalenessSeconds]) => {
            const [fromCurrency, toCurrency] = pair.split('/');
            lines.push(`swiftremit_fx_rate_staleness_seconds{from_currency="${fromCurrency}",to_currency="${toCurrency}"} ${stalenessSeconds}`);
        });
        return lines.join('\n') + '\n';
    }
    /**
     * Get metrics in Prometheus format
     */
    async getMetrics() {
        await this.updateAllMetrics();
        return this.generatePrometheusText();
    }
}
exports.MetricsService = MetricsService;
// Singleton instance
let metricsServiceInstance = null;
function getMetricsService(pool) {
    if (!metricsServiceInstance) {
        metricsServiceInstance = new MetricsService(pool);
    }
    return metricsServiceInstance;
}
