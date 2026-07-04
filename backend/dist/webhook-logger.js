"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookLogger = void 0;
const correlation_id_1 = require("./correlation-id");
class WebhookLogger {
    pool;
    logger = (0, correlation_id_1.createLogger)('WebhookLogger');
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Log incoming webhook
     */
    async logWebhook(anchorId, transactionId, eventType, payload, verified) {
        const correlationId = (0, correlation_id_1.getCorrelationId)();
        this.logger.info('Logging webhook', {
            anchorId,
            transactionId,
            eventType,
            verified,
            correlationId,
        });
        const result = await this.pool.query(`INSERT INTO webhook_logs 
       (anchor_id, transaction_id, event_type, payload, verified, received_at, correlation_id)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       RETURNING id`, [anchorId, transactionId, eventType, JSON.stringify(payload), verified, correlationId]);
        return result.rows[0].id;
    }
    /**
     * Log suspicious activity
     */
    async logSuspiciousActivity(activity) {
        const correlationId = (0, correlation_id_1.getCorrelationId)();
        this.logger.warn('Logging suspicious activity', {
            webhook_id: activity.webhook_id,
            anchor_id: activity.anchor_id,
            reason: activity.reason,
            correlationId,
        });
        await this.pool.query(`INSERT INTO suspicious_webhooks 
       (webhook_id, anchor_id, reason, payload, detected_at, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6)`, [
            activity.webhook_id,
            activity.anchor_id,
            activity.reason,
            JSON.stringify(activity.payload),
            activity.timestamp,
            correlationId
        ]);
    }
    /**
     * Check for suspicious patterns
     */
    async checkSuspiciousPatterns(anchorId, transactionId) {
        const correlationId = (0, correlation_id_1.getCorrelationId)();
        this.logger.info('Checking suspicious patterns', {
            anchorId,
            transactionId,
            correlationId,
        });
        const suspiciousReasons = [];
        // Check for duplicate webhooks in short time
        const duplicateCheck = await this.pool.query(`SELECT COUNT(*) as count FROM webhook_logs
       WHERE anchor_id = $1 AND transaction_id = $2 
       AND received_at > NOW() - INTERVAL '5 minutes'`, [anchorId, transactionId]);
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
        const failedVerifications = await this.pool.query(`SELECT COUNT(*) as count FROM webhook_logs
       WHERE anchor_id = $1 AND verified = false
       AND received_at > NOW() - INTERVAL '1 hour'`, [anchorId]);
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
exports.WebhookLogger = WebhookLogger;
