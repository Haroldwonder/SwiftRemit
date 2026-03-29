import { Pool } from 'pg';
import { getCorrelationId } from './correlation-id';

export interface SuspiciousActivity {
  webhook_id: string;
  anchor_id: string;
  reason: string;
  payload: any;
  timestamp: Date;
  correlation_id?: string;
}

export class WebhookLogger {
  constructor(private pool: Pool) {}

  /**
   * Get correlation ID for logging
   */
  private getLogContext(): { correlation_id?: string } {
    const correlationId = getCorrelationId();
    return correlationId ? { correlation_id: correlationId } : {};
  }

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
    const logContext = this.getLogContext();
    console.log('Logging webhook', {
      anchorId,
      transactionId,
      eventType,
      verified,
      ...logContext
    });

    const result = await this.pool.query(
      `INSERT INTO webhook_logs 
       (anchor_id, transaction_id, event_type, payload, verified, received_at, correlation_id)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       RETURNING id`,
      [anchorId, transactionId, eventType, JSON.stringify(payload), verified, logContext.correlation_id]
    );
    return result.rows[0].id;
  }

  /**
   * Log suspicious activity
   */
  async logSuspiciousActivity(activity: SuspiciousActivity): Promise<void> {
    const logContext = this.getLogContext();
    console.log('Logging suspicious activity', {
      webhook_id: activity.webhook_id,
      anchor_id: activity.anchor_id,
      reason: activity.reason,
      ...logContext
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
        logContext.correlation_id || activity.correlation_id
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
    const logContext = this.getLogContext();
    console.log('Checking suspicious patterns', {
      anchorId,
      transactionId,
      ...logContext
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
      console.log('Suspicious pattern detected: Multiple webhooks for same transaction', {
        anchorId,
        transactionId,
        count: duplicateCheck.rows[0].count,
        ...logContext
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
      console.log('Suspicious pattern detected: High rate of failed verifications', {
        anchorId,
        failedCount: failedVerifications.rows[0].count,
        ...logContext
      });
    }

    return suspiciousReasons;
  }
}
