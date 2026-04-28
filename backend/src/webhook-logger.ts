import { Pool } from 'pg';
import { createLogger, getCorrelationId } from './correlation-id';

export interface SuspiciousActivity {
  webhook_id: string;
  anchor_id: string;
  reason: string;
  payload: any;
  timestamp: Date;
}

export class WebhookLogger {
  private logger = createLogger('WebhookLogger');

  constructor(private pool: Pool) {}

  /**
   * Log incoming webhook
   */
  async logWebhook(
    anchorId: string,
    transactionId: string,
    eventType: string,
    payload: any,
    verified: boolean
  ): Promise<string> {
    const correlationId = getCorrelationId();
    this.logger.info('Logging webhook', {
      anchorId,
      transactionId,
      eventType,
      verified,
      correlationId,
    });

    const result = await this.pool.query(
      `INSERT INTO webhook_logs 
       (anchor_id, transaction_id, event_type, payload, verified, received_at, correlation_id)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       RETURNING id`,
      [anchorId, transactionId, eventType, JSON.stringify(payload), verified, correlationId]
    );
    return result.rows[0].id;
  }

  /**
   * Log suspicious activity
   */
  async logSuspiciousActivity(activity: SuspiciousActivity): Promise<void> {
    const correlationId = getCorrelationId();
    this.logger.warn('Logging suspicious activity', {
      webhook_id: activity.webhook_id,
      anchor_id: activity.anchor_id,
      reason: activity.reason,
      correlationId,
    });

    await this.pool.query(
      `INSERT INTO suspicious_webhooks 
       (webhook_id, anchor_id, reason, payload, detected_at, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        activity.webhook_id,
        activity.anchor_id,
        activity.reason,
        JSON.stringify(activity.payload),
        activity.timestamp,
        correlationId
      ]
    );
  }

  /**
   * Check for suspicious patterns
   */
  async checkSuspiciousPatterns(
    anchorId: string,
    transactionId: string
  ): Promise<string[]> {
    const correlationId = getCorrelationId();
    this.logger.info('Checking suspicious patterns', {
      anchorId,
      transactionId,
      correlationId,
    });

    const suspiciousReasons: string[] = [];

    // Check for duplicate webhooks in short time
    const duplicateCheck = await this.pool.query(
      `SELECT COUNT(*) as count FROM webhook_logs
       WHERE anchor_id = $1 AND transaction_id = $2 
       AND received_at > NOW() - INTERVAL '5 minutes'`,
      [anchorId, transactionId]
    );

    if (parseInt(duplicateCheck.rows[0].count) > 3) {
      suspiciousReasons.push('Multiple webhooks for same transaction');
      this.logger.warn('Suspicious pattern detected: multiple webhooks', {
        anchorId,
        transactionId,
        count: duplicateCheck.rows[0].count,
        correlationId,
      });
    }

    // Check for failed verification attempts
    const failedVerifications = await this.pool.query(
      `SELECT COUNT(*) as count FROM webhook_logs
       WHERE anchor_id = $1 AND verified = false
       AND received_at > NOW() - INTERVAL '1 hour'`,
      [anchorId]
    );

    if (parseInt(failedVerifications.rows[0].count) > 10) {
      suspiciousReasons.push('High rate of failed verifications');
      this.logger.warn('Suspicious pattern detected: high failed verifications', {
        anchorId,
        count: failedVerifications.rows[0].count,
        correlationId,
      });
    }

    return suspiciousReasons;
  }
}
