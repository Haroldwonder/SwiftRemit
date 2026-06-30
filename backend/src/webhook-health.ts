import { Request, Response } from 'express';
import { Pool } from 'pg';

export class WebhookHealthCheck {
  constructor(private pool: Pool) {}

  /**
   * Health check endpoint for webhook system
   */
  async checkHealth(req: Request, res: Response): Promise<void> {
    const checks = {
      database: false,
      webhook_logs: false,
      anchors: false,
      recent_activity: false
    };

    const metrics = {
      total_webhooks_24h: 0,
      verified_webhooks_24h: 0,
      success_rate: 0,
      suspicious_count: 0,
      active_anchors: 0,
      avg_processing_time_ms: 0
    };

    try {
      // Check database connection
      await this.pool.query('SELECT 1');
      checks.database = true;

      // Check webhook_logs table
      const logsResult = await this.pool.query(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN verified = true THEN 1 ELSE 0 END) as verified,
          AVG(processing_time_ms) as avg_time
         FROM webhook_logs 
         WHERE received_at > NOW() - INTERVAL '24 hours'`
      );
      
      if (logsResult.rows.length > 0) {
        checks.webhook_logs = true;
        metrics.total_webhooks_24h = parseInt(logsResult.rows[0].total);
        metrics.verified_webhooks_24h = parseInt(logsResult.rows[0].verified || 0);
        metrics.success_rate = metrics.total_webhooks_24h > 0
          ? Math.round((metrics.verified_webhooks_24h / metrics.total_webhooks_24h) * 100)
          : 100;
        metrics.avg_processing_time_ms = Math.round(parseFloat(logsResult.rows[0].avg_time || 0));
      }

      // Check anchors
      const anchorsResult = await this.pool.query(
        'SELECT COUNT(*) as count FROM anchors WHERE enabled = true'
      );
      checks.anchors = true;
      metrics.active_anchors = parseInt(anchorsResult.rows[0].count);

      // Check suspicious activity
      const suspiciousResult = await this.pool.query(
        `SELECT COUNT(*) as count FROM suspicious_webhooks 
         WHERE detected_at > NOW() - INTERVAL '24 hours'`
      );
      metrics.suspicious_count = parseInt(suspiciousResult.rows[0].count);

      // Check recent activity
      checks.recent_activity = metrics.total_webhooks_24h > 0;

      // Determine overall health
      const allChecksPass = Object.values(checks).every(check => check === true);
      const status = allChecksPass ? 'healthy' : 'degraded';
      const httpStatus = allChecksPass ? 200 : 503;

      res.status(httpStatus).json({
        status,
        timestamp: new Date().toISOString(),
        checks,
        metrics,
        warnings: this.generateWarnings(metrics)
      });

    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        checks,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Generate warnings based on metrics
   */
  private generateWarnings(metrics: any): string[] {
    const warnings: string[] = [];

    if (metrics.success_rate < 90) {
      warnings.push(`Low success rate: ${metrics.success_rate}%`);
    }

    if (metrics.suspicious_count > 10) {
      warnings.push(`High suspicious activity: ${metrics.suspicious_count} incidents`);
    }

    if (metrics.avg_processing_time_ms > 500) {
      warnings.push(`Slow processing: ${metrics.avg_processing_time_ms}ms average`);
    }

    if (metrics.active_anchors === 0) {
      warnings.push('No active anchors registered');
    }

    return warnings;
  }
}
