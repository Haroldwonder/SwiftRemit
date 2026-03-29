import { Pool } from 'pg';
import { Counter, Gauge, Registry } from 'prom-client';

// Create a registry to hold all metrics
const register = new Registry();

// Add default metrics (CPU, memory, etc.)
// register.setDefaultLabels({ app: 'swiftremit' });

// Define metrics
const settlementsTotal = new Counter({
  name: 'swiftremit_settlements_total',
  help: 'Total number of settlements by status',
  labelNames: ['status', 'kind'] as const,
  registers: [register],
});

const webhookDeliveriesTotal = new Counter({
  name: 'swiftremit_webhook_deliveries_total',
  help: 'Total number of webhook deliveries by result',
  labelNames: ['result', 'event_type', 'anchor_id'] as const,
  registers: [register],
});

const activeRemittances = new Gauge({
  name: 'swiftremit_active_remittances',
  help: 'Number of active remittances (not completed, refunded, expired, or error)',
  registers: [register],
});

const accumulatedFees = new Gauge({
  name: 'swiftremit_accumulated_fees',
  help: 'Total accumulated fees from all transactions',
  registers: [register],
});

export class MetricsService {
  private pool: Pool;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Start periodic metrics updates
   */
  startPeriodicUpdates(intervalMs: number = 60000): void {
    console.log('Starting metrics periodic updates', { intervalMs });
    
    // Initial update
    this.updateMetrics();
    
    // Set up periodic updates
    this.updateInterval = setInterval(() => {
      this.updateMetrics();
    }, intervalMs);
  }

  /**
   * Stop periodic metrics updates
   */
  stopPeriodicUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('Stopped metrics periodic updates');
    }
  }

  /**
   * Update all metrics from database
   */
  async updateMetrics(): Promise<void> {
    try {
      await Promise.all([
        this.updateActiveRemittances(),
        this.updateAccumulatedFees(),
      ]);
    } catch (error) {
      console.error('Error updating metrics:', error);
    }
  }

  /**
   * Update active remittances gauge
   */
  private async updateActiveRemittances(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) as count 
         FROM transactions 
         WHERE status NOT IN ('completed', 'refunded', 'expired', 'error')`
      );
      
      const count = parseInt(result.rows[0].count) || 0;
      activeRemittances.set(count);
      
      console.log('Updated active remittances metric', { count });
    } catch (error) {
      console.error('Error updating active remittances metric:', error);
    }
  }

  /**
   * Update accumulated fees gauge
   */
  private async updateAccumulatedFees(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT COALESCE(SUM(amount_fee), 0) as total_fees 
         FROM transactions 
         WHERE status = 'completed'`
      );
      
      const totalFees = parseFloat(result.rows[0].total_fees) || 0;
      accumulatedFees.set(totalFees);
      
      console.log('Updated accumulated fees metric', { totalFees });
    } catch (error) {
      console.error('Error updating accumulated fees metric:', error);
    }
  }

  /**
   * Increment settlements counter
   */
  incrementSettlements(status: string, kind: string): void {
    settlementsTotal.inc({ status, kind });
    console.log('Incremented settlements metric', { status, kind });
  }

  /**
   * Increment webhook deliveries counter
   */
  incrementWebhookDeliveries(result: string, eventType: string, anchorId: string): void {
    webhookDeliveriesTotal.inc({ result, event_type: eventType, anchor_id: anchorId });
    console.log('Incremented webhook deliveries metric', { result, eventType, anchorId });
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  /**
   * Get metrics registry
   */
  getRegistry(): Registry {
    return register;
  }
}

export { register, settlementsTotal, webhookDeliveriesTotal, activeRemittances, accumulatedFees };
