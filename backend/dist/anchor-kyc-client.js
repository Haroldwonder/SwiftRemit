"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnchorKycClient = void 0;
const crypto_1 = __importDefault(require("crypto"));
class AnchorKycClient {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Fetch KYC statuses for all users from this anchor.
     * Signs the request with x-signature, x-timestamp, x-nonce, x-anchor-id headers.
     */
    async fetchKycStatuses() {
        const timestamp = new Date().toISOString();
        const nonce = crypto_1.default.randomUUID();
        const signature = this.computeSignature(timestamp, nonce, this.config.anchor_id);
        const response = await fetch(this.config.kyc_endpoint, {
            method: 'GET',
            headers: {
                'x-signature': signature,
                'x-timestamp': timestamp,
                'x-nonce': nonce,
                'x-anchor-id': this.config.anchor_id,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Anchor KYC endpoint returned ${response.status} for anchor ${this.config.anchor_id}`);
        }
        const data = await response.json();
        const users = data.users ?? (Array.isArray(data) ? data : []);
        return users.map(u => this.parseRecord(u));
    }
    /** HMAC-SHA256 over timestamp + nonce + anchor_id */
    computeSignature(timestamp, nonce, anchorId) {
        return crypto_1.default
            .createHmac('sha256', this.config.webhook_secret)
            .update(`${timestamp}${nonce}${anchorId}`)
            .digest('hex');
    }
    parseRecord(raw) {
        const validStatuses = ['pending', 'approved', 'rejected'];
        const kyc_status = validStatuses.includes(raw.kyc_status)
            ? raw.kyc_status
            : (() => { throw new Error(`Unrecognised kyc_status "${raw.kyc_status}" from anchor ${this.config.anchor_id}`); })();
        return {
            user_id: String(raw.user_id),
            anchor_id: this.config.anchor_id,
            kyc_status,
            kyc_level: raw.kyc_level,
            rejection_reason: raw.rejection_reason,
            verified_at: new Date(raw.verified_at ?? Date.now()),
            expires_at: raw.expires_at ? new Date(raw.expires_at) : undefined,
        };
    }
}
exports.AnchorKycClient = AnchorKycClient;
