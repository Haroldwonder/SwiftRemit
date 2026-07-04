"use strict";
/**
 * Tests for the optional memo field on remittance creation.
 *
 * Covers:
 * - Remittance with memo saves and returns correctly
 * - Remittance without memo works as before (backward compat)
 * - Memo exceeding 100 chars is rejected with 400
 * - Memo is sanitized before storage
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
// ── mock pool ──────────────────────────────────────────────────────────────
const { mockPool, insertedRows } = vitest_1.vi.hoisted(() => {
    const insertedRows = [];
    const mockPool = {
        query: vitest_1.vi.fn(async (sql, params) => {
            const s = sql.toUpperCase();
            if (s.includes('INSERT INTO TRANSACTIONS')) {
                const row = {
                    transaction_id: params[0],
                    anchor_id: params[1],
                    amount_in: params[2],
                    memo: params[3],
                    status: 'pending_user_transfer_start',
                    created_at: new Date().toISOString(),
                };
                insertedRows.push(row);
                return { rows: [row], rowCount: 1 };
            }
            if (s.includes('SELECT') && s.includes('FROM TRANSACTIONS')) {
                const found = insertedRows.find((r) => r.transaction_id === params[0]);
                return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
            }
            return { rows: [], rowCount: 0 };
        }),
    };
    return { mockPool, insertedRows };
});
vitest_1.vi.mock('../database', () => ({
    getPool: () => mockPool,
    getAssetVerification: vitest_1.vi.fn(),
    saveAssetVerification: vitest_1.vi.fn(),
    reportSuspiciousAsset: vitest_1.vi.fn(),
    getVerifiedAssets: vitest_1.vi.fn(),
    saveFxRate: vitest_1.vi.fn(),
    getFxRate: vitest_1.vi.fn(),
    saveAnchorKycConfig: vitest_1.vi.fn(),
    getUserKycStatus: vitest_1.vi.fn(),
    saveUserKycStatus: vitest_1.vi.fn(),
    saveAssetReport: vitest_1.vi.fn(),
    getActiveWebhookSubscribers: vitest_1.vi.fn().mockResolvedValue([]),
    getPendingWebhookDeliveries: vitest_1.vi.fn().mockResolvedValue([]),
}));
vitest_1.vi.mock('../stellar', () => ({
    storeVerificationOnChain: vitest_1.vi.fn(),
    simulateSettlement: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../metrics', () => ({
    getMetricsService: () => ({ getMetrics: vitest_1.vi.fn().mockResolvedValue('') }),
}));
vitest_1.vi.mock('../fx-rate-cache', () => ({
    getFxRateCache: () => ({ getCurrentRate: vitest_1.vi.fn() }),
}));
vitest_1.vi.mock('../kyc-upsert-service', () => ({
    KycUpsertService: vitest_1.vi.fn().mockImplementation(() => ({
        getStatusForUser: vitest_1.vi.fn(),
    })),
}));
vitest_1.vi.mock('../transfer-guard', () => ({
    createTransferGuard: () => (_req, _res, next) => next(),
}));
vitest_1.vi.mock('../sep24-service', () => ({
    Sep24Service: vitest_1.vi.fn().mockImplementation(() => ({
        initialize: vitest_1.vi.fn(),
        initiateFlow: vitest_1.vi.fn(),
        getTransactionStatus: vitest_1.vi.fn(),
    })),
    Sep24ConfigError: class Sep24ConfigError extends Error {
    },
    Sep24AnchorError: class Sep24AnchorError extends Error {
    },
}));
const api_1 = __importDefault(require("../api"));
const AUTH_HEADER = { 'x-user-id': 'user-test-1' };
const BASE_BODY = {
    sender: 'GSENDERADDRESS000000000000000000000000000000000000000000',
    agent: 'anchor-test',
    amount: '100.00',
};
(0, vitest_1.beforeEach)(() => {
    insertedRows.length = 0;
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)('POST /api/remittance — memo field', () => {
    (0, vitest_1.it)('creates remittance with memo and returns it in the response', async () => {
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/remittance')
            .set(AUTH_HEADER)
            .send({ ...BASE_BODY, memo: 'Invoice #1234' });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.success).toBe(true);
        (0, vitest_1.expect)(res.body.remittance.memo).toBe('Invoice #1234');
    });
    (0, vitest_1.it)('creates remittance without memo (backward compat)', async () => {
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/remittance')
            .set(AUTH_HEADER)
            .send(BASE_BODY);
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.success).toBe(true);
        (0, vitest_1.expect)(res.body.remittance.memo).toBeNull();
    });
    (0, vitest_1.it)('creates remittance with empty memo string (treated as no memo)', async () => {
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/remittance')
            .set(AUTH_HEADER)
            .send({ ...BASE_BODY, memo: '' });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.remittance.memo).toBeNull();
    });
    (0, vitest_1.it)('rejects memo exceeding 100 characters with 400', async () => {
        const longMemo = 'A'.repeat(101);
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/remittance')
            .set(AUTH_HEADER)
            .send({ ...BASE_BODY, memo: longMemo });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.error).toMatch(/100/);
    });
    (0, vitest_1.it)('accepts memo of exactly 100 characters', async () => {
        const exactMemo = 'B'.repeat(100);
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/remittance')
            .set(AUTH_HEADER)
            .send({ ...BASE_BODY, memo: exactMemo });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.remittance.memo).toBe(exactMemo);
    });
    (0, vitest_1.it)('sanitizes memo before storage (strips HTML tags)', async () => {
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/remittance')
            .set(AUTH_HEADER)
            .send({ ...BASE_BODY, memo: '<script>alert(1)</script>Invoice #99' });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.remittance.memo).not.toContain('<script>');
        (0, vitest_1.expect)(res.body.remittance.memo).toContain('Invoice #99');
    });
});
(0, vitest_1.describe)('GET /api/remittance/:id — memo field', () => {
    (0, vitest_1.it)('returns memo on the remittance detail response', async () => {
        // Create first
        const createRes = await (0, supertest_1.default)(api_1.default)
            .post('/api/remittance')
            .set(AUTH_HEADER)
            .send({ ...BASE_BODY, memo: 'REF-2024-001' });
        const { remittance_id } = createRes.body.remittance;
        const getRes = await (0, supertest_1.default)(api_1.default).get(`/api/remittance/${remittance_id}`);
        (0, vitest_1.expect)(getRes.status).toBe(200);
        (0, vitest_1.expect)(getRes.body.memo).toBe('REF-2024-001');
    });
    (0, vitest_1.it)('returns null memo when none was set', async () => {
        const createRes = await (0, supertest_1.default)(api_1.default)
            .post('/api/remittance')
            .set(AUTH_HEADER)
            .send(BASE_BODY);
        const { remittance_id } = createRes.body.remittance;
        const getRes = await (0, supertest_1.default)(api_1.default).get(`/api/remittance/${remittance_id}`);
        (0, vitest_1.expect)(getRes.status).toBe(200);
        (0, vitest_1.expect)(getRes.body.memo).toBeNull();
    });
});
