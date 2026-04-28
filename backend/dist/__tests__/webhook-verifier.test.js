"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const webhook_verifier_1 = require("../webhook-verifier");
const stellar_sdk_1 = require("@stellar/stellar-sdk");
(0, vitest_1.describe)('WebhookVerifier', () => {
    let verifier;
    let keypair;
    (0, vitest_1.beforeEach)(() => {
        verifier = new webhook_verifier_1.WebhookVerifier(300);
        keypair = stellar_sdk_1.Keypair.random();
    });
    (0, vitest_1.describe)('verifySignature', () => {
        (0, vitest_1.it)('should verify valid signature', () => {
            const payload = JSON.stringify({ transaction_id: 'test123', status: 'completed' });
            const signature = keypair.sign(Buffer.from(payload)).toString('base64');
            const result = verifier.verifySignature(payload, signature, keypair.publicKey());
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should reject invalid signature', () => {
            const payload = JSON.stringify({ transaction_id: 'test123' });
            const wrongKeypair = stellar_sdk_1.Keypair.random();
            const signature = wrongKeypair.sign(Buffer.from(payload)).toString('base64');
            const result = verifier.verifySignature(payload, signature, keypair.publicKey());
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
    (0, vitest_1.describe)('verifyHMAC', () => {
        (0, vitest_1.it)('should verify valid HMAC', () => {
            const payload = 'test payload';
            const secret = 'test-secret';
            const crypto = require('crypto');
            const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
            const result = verifier.verifyHMAC(payload, signature, secret);
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should reject invalid HMAC', () => {
            const payload = 'test payload';
            const result = verifier.verifyHMAC(payload, 'invalid-signature', 'test-secret');
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
    (0, vitest_1.describe)('validateTimestamp', () => {
        (0, vitest_1.it)('should accept recent timestamp', () => {
            const timestamp = new Date().toISOString();
            const result = verifier.validateTimestamp(timestamp);
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should reject old timestamp', () => {
            const oldDate = new Date(Date.now() - 400 * 1000); // 400 seconds ago
            const result = verifier.validateTimestamp(oldDate.toISOString());
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should reject future timestamp', () => {
            const futureDate = new Date(Date.now() + 400 * 1000);
            const result = verifier.validateTimestamp(futureDate.toISOString());
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should reject invalid timestamp', () => {
            const result = verifier.validateTimestamp('invalid-date');
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
    (0, vitest_1.describe)('validateNonce', () => {
        (0, vitest_1.it)('should accept new nonce', () => {
            const result = verifier.validateNonce('nonce-123');
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should reject duplicate nonce', () => {
            const nonce = 'nonce-456';
            verifier.validateNonce(nonce);
            const result = verifier.validateNonce(nonce);
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
});
