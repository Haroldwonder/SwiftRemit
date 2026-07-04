"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebhookVerificationMiddleware = createWebhookVerificationMiddleware;
exports.captureRawBody = captureRawBody;
exports.applyWebhookSecurity = applyWebhookSecurity;
const webhook_verifier_1 = require("./webhook-verifier");
/**
 * Create webhook verification middleware
 *
 * This middleware verifies HMAC signatures on all incoming webhook requests.
 * It must be applied AFTER express.json() middleware to access raw body.
 *
 * @param options - Configuration options
 * @returns Express middleware function
 */
function createWebhookVerificationMiddleware(options = {}) {
    const { timestampWindowSeconds = 300, requireSignature = true, getAnchorSecret, } = options;
    const verifier = new webhook_verifier_1.WebhookVerifier(timestampWindowSeconds);
    /**
     * Express middleware for webhook signature verification
     */
    return async (req, res, next) => {
        try {
            // Extract headers
            const signature = req.headers['x-signature'];
            const timestamp = req.headers['x-timestamp'];
            const nonce = req.headers['x-nonce'];
            const anchorId = req.headers['x-anchor-id'];
            // Check required headers
            if (!anchorId) {
                res.status(401).json({
                    error: 'Missing required header: x-anchor-id',
                    code: 'MISSING_ANCHOR_ID',
                });
                return;
            }
            // Store anchor ID for handlers
            req.anchorId = anchorId;
            // Check for signature if required
            if (requireSignature && !signature) {
                res.status(401).json({
                    error: 'Missing required header: x-signature',
                    code: 'MISSING_SIGNATURE',
                });
                return;
            }
            // Get anchor's secret
            let anchorSecret = null;
            if (getAnchorSecret) {
                anchorSecret = await getAnchorSecret(anchorId);
            }
            else {
                // Fallback: try to get from environment variable
                anchorSecret = process.env[`WEBHOOK_SECRET_${anchorId.toUpperCase()}`] || null;
            }
            if (!anchorSecret) {
                console.warn(`No secret configured for anchor: ${anchorId}`);
                res.status(500).json({
                    error: 'Anchor not configured for webhook verification',
                    code: 'ANCHOR_NOT_CONFIGURED',
                });
                return;
            }
            // Validate timestamp if provided
            if (timestamp) {
                if (!verifier.validateTimestamp(timestamp)) {
                    res.status(401).json({
                        error: 'Timestamp outside valid window',
                        code: 'INVALID_TIMESTAMP',
                    });
                    return;
                }
            }
            // Validate nonce if provided
            if (nonce) {
                if (!verifier.validateNonce(nonce)) {
                    res.status(401).json({
                        error: 'Duplicate nonce detected (replay attack)',
                        code: 'INVALID_NONCE',
                    });
                    return;
                }
            }
            // Verify signature if provided
            if (signature) {
                // Get raw body for verification
                const rawBody = req.rawBody || JSON.stringify(req.body);
                if (!verifier.verifyHMAC(rawBody, signature, anchorSecret)) {
                    res.status(401).json({
                        error: 'Invalid signature',
                        code: 'INVALID_SIGNATURE',
                    });
                    return;
                }
            }
            // All checks passed
            next();
        }
        catch (error) {
            console.error('Webhook verification error:', error);
            res.status(500).json({
                error: 'Webhook verification failed',
                code: 'VERIFICATION_ERROR',
            });
        }
    };
}
/**
 * Middleware to capture raw body for signature verification
 *
 * Must be applied BEFORE body-parsing middleware
 */
function captureRawBody() {
    return (req, res, next) => {
        // Store raw body as chunks
        const chunks = [];
        req.on('data', (chunk) => {
            chunks.push(chunk);
        });
        req.on('end', () => {
            req.rawBody = Buffer.concat(chunks).toString('utf8');
            next();
        });
        req.on('error', () => {
            next();
        });
    };
}
/**
 * Create webhook routes with verification middleware
 *
 * Helper to apply verification to all webhook routes
 *
 * @param app - Express application
 * @param webhookRouter - Router with webhook handlers
 * @param options - Verification options
 */
function applyWebhookSecurity(app, webhookRouter, options = {}) {
    // Apply verification middleware to all webhook routes
    const verificationMiddleware = createWebhookVerificationMiddleware(options);
    // Apply to the webhook router
    app.use('/webhooks', verificationMiddleware);
    app.use('/webhooks', (req, res, next) => {
        // Allow health check without verification
        if (req.path === '/health') {
            next();
        }
        else {
            verificationMiddleware(req, res, next);
        }
    });
}
