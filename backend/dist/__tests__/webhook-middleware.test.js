"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const crypto_1 = __importDefault(require("crypto"));
const webhook_middleware_1 = require("../webhook-middleware");
/**
 * Test helper to create HMAC signature
 */
function createHmacSignature(payload, secret) {
    return crypto_1.default
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}
/**
 * Test helper to create app with webhook middleware
 */
function createTestApp(secret, verificationMiddleware) {
    const app = (0, express_1.default)();
    // Parse JSON body
    app.use(express_1.default.json());
    // Apply webhook verification middleware
    app.use('/webhooks', verificationMiddleware);
    // Test endpoint
    app.post('/webhooks/test', (req, res) => {
        res.json({ success: true, received: req.body });
    });
    // Health check (should bypass verification)
    app.get('/webhooks/health', (req, res) => {
        res.json({ status: 'ok' });
    });
    return app;
}
(0, vitest_1.describe)('Webhook Verification Middleware', () => {
    const TEST_SECRET = 'test-webhook-secret-12345';
    let app;
    (0, vitest_1.beforeEach)(() => {
        // Set environment variable for test
        process.env.WEBHOOK_SECRET_TEST_ANCHOR = TEST_SECRET;
    });
    (0, vitest_1.describe)('Valid Requests', () => {
        (0, vitest_1.it)('should accept request with valid signature', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
            });
            app = createTestApp(TEST_SECRET, middleware);
            const payload = JSON.stringify({ event: 'test' });
            const signature = createHmacSignature(payload, TEST_SECRET);
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-signature', signature)
                .set('x-timestamp', new Date().toISOString())
                .set('x-nonce', crypto_1.default.randomUUID())
                .set('x-anchor-id', 'test-anchor')
                .send(payload);
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
        });
        (0, vitest_1.it)('should accept request without signature when requireSignature is false', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
                requireSignature: false,
            });
            app = createTestApp(TEST_SECRET, middleware);
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-anchor-id', 'test-anchor')
                .send({ event: 'test' });
            (0, vitest_1.expect)(response.status).toBe(200);
        });
        (0, vitest_1.it)('should allow health check without verification', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
            });
            app = createTestApp(TEST_SECRET, middleware);
            const response = await (0, supertest_1.default)(app).get('/webhooks/health');
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(response.body.status).toBe('ok');
        });
    });
    (0, vitest_1.describe)('Invalid Signatures', () => {
        (0, vitest_1.it)('should reject request with invalid signature', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
            });
            app = createTestApp(TEST_SECRET, middleware);
            const payload = JSON.stringify({ event: 'test' });
            const invalidSignature = createHmacSignature(payload, 'wrong-secret');
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-signature', invalidSignature)
                .set('x-timestamp', new Date().toISOString())
                .set('x-nonce', crypto_1.default.randomUUID())
                .set('x-anchor-id', 'test-anchor')
                .send(payload);
            (0, vitest_1.expect)(response.status).toBe(401);
            (0, vitest_1.expect)(response.body.code).toBe('INVALID_SIGNATURE');
        });
        (0, vitest_1.it)('should reject request with tampered payload', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
            });
            app = createTestApp(TEST_SECRET, middleware);
            // Create valid signature for original payload
            const originalPayload = JSON.stringify({ event: 'test', amount: 100 });
            const signature = createHmacSignature(originalPayload, TEST_SECRET);
            // Send with different payload but same signature (tampered)
            const tamperedPayload = JSON.stringify({ event: 'test', amount: 999999 });
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-signature', signature)
                .set('x-timestamp', new Date().toISOString())
                .set('x-nonce', crypto_1.default.randomUUID())
                .set('x-anchor-id', 'test-anchor')
                .send(tamperedPayload);
            (0, vitest_1.expect)(response.status).toBe(401);
            (0, vitest_1.expect)(response.body.code).toBe('INVALID_SIGNATURE');
        });
        (0, vitest_1.it)('should reject request with missing signature when required', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
                requireSignature: true,
            });
            app = createTestApp(TEST_SECRET, middleware);
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-anchor-id', 'test-anchor')
                .send({ event: 'test' });
            (0, vitest_1.expect)(response.status).toBe(401);
            (0, vitest_1.expect)(response.body.code).toBe('MISSING_SIGNATURE');
        });
        (0, vitest_1.it)('should reject request with missing anchor-id header', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
            });
            app = createTestApp(TEST_SECRET, middleware);
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .send({ event: 'test' });
            (0, vitest_1.expect)(response.status).toBe(401);
            (0, vitest_1.expect)(response.body.code).toBe('MISSING_ANCHOR_ID');
        });
    });
    (0, vitest_1.describe)('Timestamp Validation', () => {
        (0, vitest_1.it)('should reject request with expired timestamp', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
                timestampWindowSeconds: 300,
            });
            app = createTestApp(TEST_SECRET, middleware);
            const payload = JSON.stringify({ event: 'test' });
            const signature = createHmacSignature(payload, TEST_SECRET);
            // Timestamp from 10 minutes ago (beyond 5-minute window)
            const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-signature', signature)
                .set('x-timestamp', oldTimestamp)
                .set('x-nonce', crypto_1.default.randomUUID())
                .set('x-anchor-id', 'test-anchor')
                .send(payload);
            (0, vitest_1.expect)(response.status).toBe(401);
            (0, vitest_1.expect)(response.body.code).toBe('INVALID_TIMESTAMP');
        });
        (0, vitest_1.it)('should reject request with future-dated timestamp', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
                timestampWindowSeconds: 300,
            });
            app = createTestApp(TEST_SECRET, middleware);
            const payload = JSON.stringify({ event: 'test' });
            const signature = createHmacSignature(payload, TEST_SECRET);
            // Timestamp from 10 minutes in the future
            const futureTimestamp = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-signature', signature)
                .set('x-timestamp', futureTimestamp)
                .set('x-nonce', crypto_1.default.randomUUID())
                .set('x-anchor-id', 'test-anchor')
                .send(payload);
            (0, vitest_1.expect)(response.status).toBe(401);
            (0, vitest_1.expect)(response.body.code).toBe('INVALID_TIMESTAMP');
        });
    });
    (0, vitest_1.describe)('Nonce Validation (Replay Attack Prevention)', () => {
        (0, vitest_1.it)('should reject duplicate nonce', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => TEST_SECRET,
            });
            app = createTestApp(TEST_SECRET, middleware);
            const payload = JSON.stringify({ event: 'test' });
            const signature = createHmacSignature(payload, TEST_SECRET);
            const nonce = crypto_1.default.randomUUID();
            // First request with this nonce - should succeed
            await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-signature', signature)
                .set('x-timestamp', new Date().toISOString())
                .set('x-nonce', nonce)
                .set('x-anchor-id', 'test-anchor')
                .send(payload);
            // Second request with same nonce - should fail (replay attack)
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-signature', signature)
                .set('x-timestamp', new Date().toISOString())
                .set('x-nonce', nonce)
                .set('x-anchor-id', 'test-anchor')
                .send(payload);
            (0, vitest_1.expect)(response.status).toBe(401);
            (0, vitest_1.expect)(response.body.code).toBe('INVALID_NONCE');
        });
    });
    (0, vitest_1.describe)('Anchor Configuration', () => {
        (0, vitest_1.it)('should reject request for unconfigured anchor', async () => {
            const middleware = (0, webhook_middleware_1.createWebhookVerificationMiddleware)({
                getAnchorSecret: async () => null, // No secret for this anchor
            });
            app = createTestApp(TEST_SECRET, middleware);
            const payload = JSON.stringify({ event: 'test' });
            const response = await (0, supertest_1.default)(app)
                .post('/webhooks/test')
                .set('Content-Type', 'application/json')
                .set('x-anchor-id', 'unknown-anchor')
                .send(payload);
            (0, vitest_1.expect)(response.status).toBe(500); // Or 401, depending on implementation
            (0, vitest_1.expect)(response.body.code).toBe('ANCHOR_NOT_CONFIGURED');
        });
    });
});
