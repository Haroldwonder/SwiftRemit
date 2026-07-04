"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const vitest_1 = require("vitest");
const dispatchRemittanceCreated = vitest_1.vi.fn();
vitest_1.vi.mock('../webhook-dispatcher', () => ({
    WebhookDispatcher: vitest_1.vi.fn().mockImplementation(() => ({
        dispatchRemittanceCreated,
    })),
}));
const webhook_handler_1 = require("../webhook-handler");
function buildMockPool(secret) {
    return {
        query: vitest_1.vi.fn(async (sql) => {
            const normalized = sql.toUpperCase();
            if (normalized.includes('FROM ANCHORS')) {
                return { rows: [{ public_key: null, webhook_secret: secret }] };
            }
            if (normalized.includes('INSERT INTO WEBHOOK_LOGS')) {
                return { rows: [{ id: 'wh-log-1' }] };
            }
            if (normalized.includes('FROM WEBHOOK_LOGS')) {
                return { rows: [{ count: '0' }] };
            }
            if (normalized.includes('SUSPICIOUS_WEBHOOKS')) {
                return { rows: [] };
            }
            return { rows: [] };
        }),
    };
}
(0, vitest_1.describe)('WebhookHandler remittance created flow', () => {
    (0, vitest_1.it)('dispatches remittance.created payload with required fields', async () => {
        dispatchRemittanceCreated.mockReset();
        const secret = 'handler-remittance-secret';
        const body = {
            event_type: 'contract_created',
            remittance_id: '99',
            sender: 'GSENDERADDRESS',
            agent: 'GAGENTADDRESS',
            amount: '10000000',
            fee: '100000',
            expiry: '1777777777',
        };
        const rawBody = JSON.stringify(body);
        const signature = crypto_1.default.createHmac('sha256', secret).update(rawBody).digest('hex');
        const req = {
            headers: {
                'x-signature': signature,
                'x-timestamp': new Date().toISOString(),
                'x-nonce': crypto_1.default.randomUUID(),
                'x-anchor-id': 'anchor-test',
            },
            body,
            rawBody,
        };
        const res = {
            status: vitest_1.vi.fn().mockReturnThis(),
            json: vitest_1.vi.fn().mockReturnThis(),
        };
        const handler = new webhook_handler_1.WebhookHandler(buildMockPool(secret));
        await handler.handleWebhook(req, res);
        (0, vitest_1.expect)(dispatchRemittanceCreated).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(dispatchRemittanceCreated).toHaveBeenCalledWith({
            remittance_id: '99',
            sender: 'GSENDERADDRESS',
            agent: 'GAGENTADDRESS',
            amount: '10000000',
            fee: '100000',
            expiry: '1777777777',
        });
        (0, vitest_1.expect)(res.status).toHaveBeenCalledWith(200);
    });
});
