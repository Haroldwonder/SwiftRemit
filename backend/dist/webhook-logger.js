"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookLogger = void 0;
class WebhookLogger {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Log incoming webhook
     */
    async logWebhook(anchorId, transactionId, eventType, payload, verified) {
        const result = await this.pool.query(`INSERT INTO webhook_logs 
       (anchor_id, transaction_id, event_type, payload, verified, received_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`, [anchorId, transactionId, eventType, JSON.stringify(payload), verified]);
        return result.rows[0].id;
    }
    /**
     * Log suspicious activity
     */
    async logSuspiciousActivity(activity) {
        await this.pool.query(`INSERT INTO suspicious_webhooks 
       (webhook_id, anchor_id, reason, payload, detected_at)
       VALUES ($1, $2, $3, $4, $5)`, [
            activity.webhook_id,
            activity.anchor_id,
            activity.reason,
            JSON.stringify(activity.payload),
            activity.timestamp
        ]);
    }
    /**
     * Check for suspicious patterns
     */
    async checkSuspiciousPatterns(anchorId, transactionId) {
        const suspiciousReasons = [];
        // Check for duplicate webhooks in short time
        const duplicateCheck = await this.pool.query(`SELECT COUNT(*) as count FROM webhook_logs
       WHERE anchor_id = $1 AND transaction_id = $2 
       AND received_at > NOW() - INTERVAL '5 minutes'`, [anchorId, transactionId]);
        if (parseInt(duplicateCheck.rows[0].count) > 3) {
            suspiciousReasons.push('Multiple webhooks for same transaction');
        }
        // Check for failed verification attempts
        const failedVerifications = await this.pool.query(`SELECT COUNT(*) as count FROM webhook_logs
       WHERE anchor_id = $1 AND verified = false
       AND received_at > NOW() - INTERVAL '1 hour'`, [anchorId]);
        if (parseInt(failedVerifications.rows[0].count) > 10) {
            suspiciousReasons.push('High rate of failed verifications');
        }
        return suspiciousReasons;
    }
}
exports.WebhookLogger = WebhookLogger;
