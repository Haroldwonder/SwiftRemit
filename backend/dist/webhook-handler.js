"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookHandler = void 0;
const express_1 = __importDefault(require("express"));
const webhook_verifier_1 = require("./webhook-verifier");
const webhook_logger_1 = require("./webhook-logger");
const transaction_state_1 = require("./transaction-state");
class WebhookHandler {
    pool;
    verifier;
    logger;
    stateManager;
    constructor(pool) {
        this.pool = pool;
        this.verifier = new webhook_verifier_1.WebhookVerifier(300); // 5 minute replay window
        this.logger = new webhook_logger_1.WebhookLogger(pool);
        this.stateManager = new transaction_state_1.TransactionStateManager(pool);
    }
    /**
     * Middleware to capture raw body for signature verification
     */
    rawBodyMiddleware() {
        return express_1.default.json({
            verify: (req, res, buf) => {
                req.rawBody = buf.toString('utf8');
            }
        });
    }
    /**
     * Main webhook endpoint handler
     */
    async handleWebhook(req, res) {
        const startTime = Date.now();
        try {
            // Extract headers
            const signature = req.headers['x-signature'];
            const timestamp = req.headers['x-timestamp'];
            const nonce = req.headers['x-nonce'];
            const anchorId = req.headers['x-anchor-id'];
            if (!signature || !timestamp || !nonce || !anchorId) {
                res.status(400).json({ error: 'Missing required headers' });
                return;
            }
            // Get anchor public key
            const anchorResult = await this.pool.query('SELECT public_key, webhook_secret FROM anchors WHERE id = $1', [anchorId]);
            if (anchorResult.rows.length === 0) {
                res.status(404).json({ error: 'Anchor not found' });
                return;
            }
            const { public_key, webhook_secret } = anchorResult.rows[0];
            // Verify timestamp
            if (!this.verifier.validateTimestamp(timestamp)) {
                await this.logSuspicious(anchorId, 'Invalid timestamp', req.body);
                res.status(401).json({ error: 'Invalid timestamp' });
                return;
            }
            // Verify nonce
            if (!this.verifier.validateNonce(nonce)) {
                await this.logSuspicious(anchorId, 'Duplicate nonce (replay attack)', req.body);
                res.status(401).json({ error: 'Invalid nonce' });
                return;
            }
            // Verify signature
            const rawBody = req.rawBody || JSON.stringify(req.body);
            const signatureValid = webhook_secret
                ? this.verifier.verifyHMAC(rawBody, signature, webhook_secret)
                : this.verifier.verifySignature(rawBody, signature, public_key);
            if (!signatureValid) {
                await this.logSuspicious(anchorId, 'Invalid signature', req.body);
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            // Process webhook
            const { event_type, transaction_id } = req.body;
            // Log webhook
            const webhookId = await this.logger.logWebhook(anchorId, transaction_id, event_type, req.body, true);
            // Check for suspicious patterns
            const suspiciousReasons = await this.logger.checkSuspiciousPatterns(anchorId, transaction_id);
            if (suspiciousReasons.length > 0) {
                await this.logSuspicious(anchorId, suspiciousReasons.join(', '), req.body, webhookId);
            }
            // Route to appropriate handler
            switch (event_type) {
                case 'deposit_update':
                    await this.handleDepositUpdate(req.body);
                    break;
                case 'withdrawal_update':
                    await this.handleWithdrawalUpdate(req.body);
                    break;
                case 'kyc_update':
                    await this.handleKYCUpdate(req.body);
                    break;
                default:
                    res.status(400).json({ error: 'Unknown event type' });
                    return;
            }
            const processingTime = Date.now() - startTime;
            res.status(200).json({
                success: true,
                processing_time_ms: processingTime
            });
        }
        catch (error) {
            console.error('Webhook processing error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    /**
     * Handle deposit update webhook
     */
    async handleDepositUpdate(payload) {
        const update = {
            transaction_id: payload.transaction_id,
            status: payload.status,
            status_eta: payload.status_eta,
            amount_in: payload.amount_in,
            amount_out: payload.amount_out,
            amount_fee: payload.amount_fee,
            stellar_transaction_id: payload.stellar_transaction_id,
            external_transaction_id: payload.external_transaction_id,
            message: payload.message
        };
        // Get current status
        const result = await this.pool.query('SELECT status FROM transactions WHERE transaction_id = $1', [update.transaction_id]);
        if (result.rows.length === 0) {
            throw new Error('Transaction not found');
        }
        const currentStatus = result.rows[0].status;
        // Validate transition
        if (!this.stateManager.validateTransition(currentStatus, update.status, 'deposit')) {
            throw new Error(`Invalid state transition: ${currentStatus} -> ${update.status}`);
        }
        await this.stateManager.updateTransactionState(update, 'deposit');
    }
    /**
     * Handle withdrawal update webhook
     */
    async handleWithdrawalUpdate(payload) {
        const update = {
            transaction_id: payload.transaction_id,
            status: payload.status,
            status_eta: payload.status_eta,
            amount_in: payload.amount_in,
            amount_out: payload.amount_out,
            amount_fee: payload.amount_fee,
            stellar_transaction_id: payload.stellar_transaction_id,
            external_transaction_id: payload.external_transaction_id,
            message: payload.message
        };
        const result = await this.pool.query('SELECT status FROM transactions WHERE transaction_id = $1', [update.transaction_id]);
        if (result.rows.length === 0) {
            throw new Error('Transaction not found');
        }
        const currentStatus = result.rows[0].status;
        if (!this.stateManager.validateTransition(currentStatus, update.status, 'withdrawal')) {
            throw new Error(`Invalid state transition: ${currentStatus} -> ${update.status}`);
        }
        await this.stateManager.updateTransactionState(update, 'withdrawal');
    }
    /**
     * Handle KYC update webhook
     */
    async handleKYCUpdate(payload) {
        const update = {
            transaction_id: payload.transaction_id,
            kyc_status: payload.kyc_status,
            kyc_fields: payload.kyc_fields,
            rejection_reason: payload.rejection_reason
        };
        await this.stateManager.updateKYCStatus(update);
    }
    /**
     * Log suspicious activity
     */
    async logSuspicious(anchorId, reason, payload, webhookId) {
        await this.logger.logSuspiciousActivity({
            webhook_id: webhookId || 'unknown',
            anchor_id: anchorId,
            reason,
            payload,
            timestamp: new Date()
        });
    }
    /**
     * Setup webhook routes
     */
    setupRoutes(app) {
        app.post('/webhooks/anchor', this.rawBodyMiddleware(), this.handleWebhook.bind(this));
    }
    /**
     * Setup health check route
     */
    setupHealthCheck(app) {
        const { WebhookHealthCheck } = require('./webhook-health');
        const healthCheck = new WebhookHealthCheck(this.pool);
        app.get('/webhooks/health', healthCheck.checkHealth.bind(healthCheck));
    }
}
exports.WebhookHandler = WebhookHandler;
