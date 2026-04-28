"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookVerifier = void 0;
const crypto_1 = __importDefault(require("crypto"));
const stellar_sdk_1 = require("@stellar/stellar-sdk");
class WebhookVerifier {
    replayWindow;
    processedNonces;
    constructor(replayWindowSeconds = 300) {
        this.replayWindow = replayWindowSeconds * 1000;
        this.processedNonces = new Set();
        this.cleanupOldNonces();
    }
    /**
     * Verify webhook signature using anchor's public key
     */
    verifySignature(payload, signature, anchorPublicKey) {
        try {
            const keypair = stellar_sdk_1.Keypair.fromPublicKey(anchorPublicKey);
            const payloadBuffer = Buffer.from(payload, 'utf8');
            const signatureBuffer = Buffer.from(signature, 'base64');
            return keypair.verify(payloadBuffer, signatureBuffer);
        }
        catch (error) {
            console.error('Signature verification failed:', error);
            return false;
        }
    }
    /**
     * Verify HMAC signature (alternative method)
     */
    verifyHMAC(payload, signature, secret) {
        try {
            const expectedSignature = crypto_1.default
                .createHmac('sha256', secret)
                .update(payload)
                .digest('hex');
            // Ensure both signatures are the same length before comparison
            if (signature.length !== expectedSignature.length) {
                return false;
            }
            return crypto_1.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
        }
        catch (error) {
            console.error('HMAC verification failed:', error);
            return false;
        }
    }
    /**
     * Validate timestamp to prevent replay attacks
     */
    validateTimestamp(timestamp) {
        const webhookTime = new Date(timestamp).getTime();
        const now = Date.now();
        if (isNaN(webhookTime)) {
            return false;
        }
        const timeDiff = Math.abs(now - webhookTime);
        return timeDiff <= this.replayWindow;
    }
    /**
     * Check and record nonce to prevent replay attacks
     */
    validateNonce(nonce) {
        if (this.processedNonces.has(nonce)) {
            return false;
        }
        this.processedNonces.add(nonce);
        return true;
    }
    /**
     * Cleanup old nonces periodically
     */
    cleanupOldNonces() {
        setInterval(() => {
            this.processedNonces.clear();
        }, this.replayWindow);
    }
}
exports.WebhookVerifier = WebhookVerifier;
