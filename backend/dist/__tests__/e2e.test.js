"use strict";
/**
 * End-to-end integration tests for the SwiftRemit remittance lifecycle.
 *
 * All external I/O (PostgreSQL, Stellar/Soroban) is replaced with an
 * in-memory mock so the suite runs in CI with zero infrastructure.
 *
 * Scenarios covered
 * -----------------
 * 1. Full happy path  – register agent → register user → approve KYC →
 *    lock FX rate → transfer → confirm payout → verify fee accumulation
 * 2. Cancellation / refund flow
 * 3. Duplicate settlement rejection (idempotent FX rate + state machine)
 * 4. Transfer blocked for pending / rejected / expired KYC
 * 5. Webhook security (bad signature, replay, stale timestamp)
 * 6. KYC last-write-wins upsert semantics
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const crypto_1 = __importDefault(require("crypto"));
// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted — everything declared here is available inside vi.mock factories
// ─────────────────────────────────────────────────────────────────────────────
const { db, resetDb, seedTransaction, handleQuery, mockPool } = vitest_1.vi.hoisted(() => {
    const db = {
        kyc: new Map(),
        fx: new Map(),
        tx: new Map(),
        anchorConfigs: new Map(),
        fxIdSeq: 1,
    };
    function resetDb() {
        db.kyc.clear();
        db.fx.clear();
        db.tx.clear();
        db.anchorConfigs.clear();
        db.fxIdSeq = 1;
    }
    function seedTransaction(row) {
        db.tx.set(row.transaction_id, {
            anchor_id: 'anchor-test', amount_in: null, amount_out: null, amount_fee: null,
            stellar_transaction_id: null, external_transaction_id: null,
            kyc_status: null, kyc_fields: null, kyc_rejection_reason: null, message: null,
            created_at: new Date(), updated_at: new Date(), ...row,
        });
    }
    function makeResult(rows) {
        return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
    }
    function handleQuery(sql, params) {
        const s = sql.replace(/\s+/g, ' ').trim().toUpperCase();
        // user_kyc_status — upsert (KycUpsertService)
        if (s.includes('INSERT INTO USER_KYC_STATUS') && s.includes('ON CONFLICT')) {
            const [user_id, anchor_id, kyc_status, kyc_level, rejection_reason, verified_at, expires_at] = params;
            const key = `${user_id}:${anchor_id}`;
            const existing = db.kyc.get(key);
            if (existing && existing.verified_at >= new Date(verified_at))
                return makeResult([]);
            const row = {
                user_id, anchor_id, kyc_status,
                kyc_level: kyc_level ?? null, rejection_reason: rejection_reason ?? null,
                verified_at: new Date(verified_at),
                expires_at: expires_at ? new Date(expires_at) : null,
                updated_at: new Date(),
            };
            db.kyc.set(key, row);
            return makeResult([row]);
        }
        // user_kyc_status — select by user_id (getStatusForUser)
        if (s.includes('FROM USER_KYC_STATUS') && s.includes('WHERE USER_ID = $1')) {
            return makeResult([...db.kyc.values()].filter(r => r.user_id === params[0]));
        }
        // anchor_kyc_configs — upsert
        if (s.includes('INSERT INTO ANCHOR_KYC_CONFIGS') && s.includes('ON CONFLICT')) {
            const [anchor_id, kyc_server_url, auth_token, polling_interval_minutes, enabled] = params;
            db.anchorConfigs.set(anchor_id, { anchor_id, kyc_server_url, auth_token, polling_interval_minutes, enabled });
            return makeResult([]);
        }
        if (s.includes('FROM ANCHOR_KYC_CONFIGS'))
            return makeResult([...db.anchorConfigs.values()]);
        // fx_rates — insert (idempotent)
        if (s.includes('INSERT INTO FX_RATES') && s.includes('DO NOTHING')) {
            const [transaction_id, rate, provider, timestamp, from_currency, to_currency] = params;
            if (db.fx.has(transaction_id))
                return makeResult([]);
            db.fx.set(transaction_id, {
                id: db.fxIdSeq++, transaction_id, rate: Number(rate), provider,
                timestamp: new Date(timestamp), from_currency, to_currency, created_at: new Date(),
            });
            return makeResult([]);
        }
        // fx_rates — select
        if (s.includes('FROM FX_RATES') && s.includes('WHERE TRANSACTION_ID = $1')) {
            const row = db.fx.get(params[0]);
            return makeResult(row ? [row] : []);
        }
        // transactions — select status
        if (s.includes('FROM TRANSACTIONS') && s.includes('WHERE TRANSACTION_ID = $1')) {
            const row = db.tx.get(params[0]);
            return makeResult(row ? [{ status: row.status }] : []);
        }
        // transactions — update status
        if (s.includes('UPDATE TRANSACTIONS') && s.includes('SET STATUS')) {
            const txId = params[params.length - 2];
            const row = db.tx.get(txId);
            if (row) {
                row.status = params[0];
                row.amount_in = params[2] ?? row.amount_in;
                row.amount_out = params[3] ?? row.amount_out;
                row.amount_fee = params[4] ?? row.amount_fee;
                row.stellar_transaction_id = params[5] ?? row.stellar_transaction_id;
                row.updated_at = new Date();
            }
            return makeResult(row ? [row] : []);
        }
        // transactions — update kyc_status
        if (s.includes('UPDATE TRANSACTIONS') && s.includes('SET KYC_STATUS')) {
            const txId = params[params.length - 1];
            const row = db.tx.get(txId);
            if (row) {
                row.kyc_status = params[0];
                row.kyc_fields = params[1] ? JSON.parse(params[1]) : row.kyc_fields;
                row.kyc_rejection_reason = params[2] ?? row.kyc_rejection_reason;
                row.updated_at = new Date();
            }
            return makeResult(row ? [row] : []);
        }
        // anchors — webhook handler looks up secret
        if (s.includes('FROM ANCHORS') && s.includes('WHERE ID = $1')) {
            return makeResult([{ public_key: null, webhook_secret: 'test-webhook-secret' }]);
        }
        // webhook_logs
        if (s.includes('INSERT INTO WEBHOOK_LOGS'))
            return makeResult([{ id: 'wh-mock-id' }]);
        if (s.includes('FROM WEBHOOK_LOGS'))
            return makeResult([{ count: '0' }]);
        if (s.includes('SUSPICIOUS_WEBHOOKS'))
            return makeResult([{ count: '0' }]);
        // everything else (state history, verified_assets, etc.)
        return makeResult([]);
    }
    const mockClient = {
        query: async (sql, params) => handleQuery(sql, params ?? []),
        release: () => { },
    };
    const mockPool = {
        query: async (sql, params) => handleQuery(sql, params ?? []),
        connect: async () => mockClient,
    };
    return { db, resetDb, seedTransaction, handleQuery, mockPool };
});
// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — use mockPool / db from vi.hoisted above
// ─────────────────────────────────────────────────────────────────────────────
vitest_1.vi.mock('../stellar', () => ({
    storeVerificationOnChain: vitest_1.vi.fn().mockResolvedValue(undefined),
    updateKycStatusOnChain: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
vitest_1.vi.mock('../stellar-kyc', () => ({
    setKycApprovedOnChain: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
vitest_1.vi.mock('../database', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        initDatabase: vitest_1.vi.fn().mockResolvedValue(undefined),
        getPool: vitest_1.vi.fn(() => mockPool),
        pool: mockPool,
        saveAssetVerification: vitest_1.vi.fn().mockResolvedValue(undefined),
        getAssetVerification: vitest_1.vi.fn().mockResolvedValue(null),
        getVerifiedAssets: vitest_1.vi.fn().mockResolvedValue([]),
        reportSuspiciousAsset: vitest_1.vi.fn().mockResolvedValue(undefined),
        getStaleAssets: vitest_1.vi.fn().mockResolvedValue([]),
        getUsersNeedingKycCheck: vitest_1.vi.fn().mockResolvedValue([]),
        // These close over `db` — safe because vi.hoisted runs first
        saveFxRate: vitest_1.vi.fn(async (fxRate) => {
            if (!db.fx.has(fxRate.transaction_id)) {
                db.fx.set(fxRate.transaction_id, {
                    id: db.fxIdSeq++,
                    transaction_id: fxRate.transaction_id,
                    rate: Number(fxRate.rate),
                    provider: fxRate.provider,
                    timestamp: new Date(fxRate.timestamp),
                    from_currency: fxRate.from_currency,
                    to_currency: fxRate.to_currency,
                    created_at: new Date(),
                });
            }
        }),
        getFxRate: vitest_1.vi.fn(async (txId) => db.fx.get(txId) ?? null),
        saveAnchorKycConfig: vitest_1.vi.fn(async (config) => {
            db.anchorConfigs.set(config.anchor_id, config);
        }),
        getUserKycStatus: vitest_1.vi.fn(async (userId, anchorId) => db.kyc.get(`${userId}:${anchorId}`) ?? null),
        saveUserKycStatus: vitest_1.vi.fn(async (record) => {
            db.kyc.set(`${record.user_id}:${record.anchor_id}`, { ...record, updated_at: new Date() });
        }),
        getAnchorKycConfigs: vitest_1.vi.fn(async () => [...db.anchorConfigs.values()]),
        getApprovedUsers: vitest_1.vi.fn(async () => [...db.kyc.values()].filter(r => r.kyc_status === 'approved')),
    };
});
// ─────────────────────────────────────────────────────────────────────────────
// App + helpers — imported after mocks are wired
// ─────────────────────────────────────────────────────────────────────────────
const api_1 = __importDefault(require("../api"));
const webhook_handler_1 = require("../webhook-handler");
// The webhook routes are registered in index.ts, not api.ts.
// Set them up here so the test app has /webhooks/anchor.
const webhookHandler = new webhook_handler_1.WebhookHandler(mockPool);
webhookHandler.setupRoutes(api_1.default);
const WEBHOOK_SECRET = 'test-webhook-secret';
const ANCHOR_ID = 'anchor-test';
/** Build a valid signed webhook request. */
function signWebhook(body) {
    const timestamp = new Date().toISOString();
    const nonce = crypto_1.default.randomUUID();
    const raw = JSON.stringify(body);
    const signature = crypto_1.default.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    return { signature, timestamp, nonce };
}
async function sendWebhook(body) {
    const { signature, timestamp, nonce } = signWebhook(body);
    return (0, supertest_1.default)(api_1.default)
        .post('/webhooks/anchor')
        .set('content-type', 'application/json')
        .set('x-signature', signature)
        .set('x-timestamp', timestamp)
        .set('x-nonce', nonce)
        .set('x-anchor-id', ANCHOR_ID)
        .send(body);
}
// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.beforeEach)(() => {
    resetDb();
    vitest_1.vi.clearAllMocks();
});
// ─────────────────────────────────────────────────────────────────────────────
// 1. HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Health check', () => {
    (0, vitest_1.it)('GET /health returns ok', async () => {
        const res = await (0, supertest_1.default)(api_1.default).get('/health');
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('ok');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 2. FULL HAPPY-PATH LIFECYCLE
//    register agent → register user → approve KYC → lock FX rate →
//    transfer → confirm payout → verify fee accumulation
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Full remittance lifecycle — happy path', () => {
    const USER_ID = 'user-alice';
    const TX_ID = 'tx-remittance-001';
    (0, vitest_1.it)('registers an anchor agent (KYC config)', async () => {
        const res = await (0, supertest_1.default)(api_1.default).post('/api/kyc/config').send({
            anchorId: ANCHOR_ID,
            kycServerUrl: 'https://kyc.anchor-test.example',
            authToken: 'secret-token',
            pollingIntervalMinutes: 60,
            enabled: true,
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
        (0, vitest_1.expect)(db.anchorConfigs.has(ANCHOR_ID)).toBe(true);
    });
    (0, vitest_1.it)('registers a user for KYC (pending state)', async () => {
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/kyc/register')
            .send({ userId: USER_ID, anchorId: ANCHOR_ID });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
        const record = db.kyc.get(`${USER_ID}:${ANCHOR_ID}`);
        (0, vitest_1.expect)(record).toBeDefined();
        // KycService.registerUserForKyc stores a DbUserKycStatus with `status` field
        (0, vitest_1.expect)(record?.status ?? record?.kyc_status).toBe('pending');
    });
    (0, vitest_1.it)('KYC webhook approves the user and triggers on-chain sync', async () => {
        db.kyc.set(`${USER_ID}:${ANCHOR_ID}`, {
            user_id: USER_ID, anchor_id: ANCHOR_ID, kyc_status: 'pending',
            kyc_level: null, rejection_reason: null,
            verified_at: new Date(Date.now() - 60_000), expires_at: null, updated_at: new Date(),
        });
        seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'pending_user_transfer_start' });
        const res = await sendWebhook({
            event_type: 'kyc_update',
            transaction_id: TX_ID,
            kyc_status: 'approved',
            kyc_fields: { full_name: 'Alice Example' },
            user_id: USER_ID,
            anchor_id: ANCHOR_ID,
            verified_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(db.kyc.get(`${USER_ID}:${ANCHOR_ID}`)?.kyc_status).toBe('approved');
        const { setKycApprovedOnChain } = await Promise.resolve().then(() => __importStar(require('../stellar-kyc')));
        (0, vitest_1.expect)(setKycApprovedOnChain).toHaveBeenCalledWith(USER_ID, true, vitest_1.expect.any(Date));
    });
    (0, vitest_1.it)('GET /api/kyc/status reflects approval and can_transfer=true', async () => {
        db.kyc.set(`${USER_ID}:${ANCHOR_ID}`, {
            user_id: USER_ID, anchor_id: ANCHOR_ID, kyc_status: 'approved',
            kyc_level: 'basic', rejection_reason: null,
            verified_at: new Date(),
            expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            updated_at: new Date(),
        });
        const res = await (0, supertest_1.default)(api_1.default).get('/api/kyc/status').set('x-user-id', USER_ID);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.overall_status).toBe('approved');
        (0, vitest_1.expect)(res.body.can_transfer).toBe(true);
        (0, vitest_1.expect)(res.body.anchors.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('locks FX rate for the remittance (immutable)', async () => {
        const res = await (0, supertest_1.default)(api_1.default).post('/api/fx-rate').send({
            transactionId: TX_ID, rate: 1.085, provider: 'CurrencyAPI',
            fromCurrency: 'USD', toCurrency: 'EUR',
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(db.fx.get(TX_ID)?.rate).toBe(1.085);
    });
    (0, vitest_1.it)('POST /api/transfer succeeds for KYC-approved user', async () => {
        db.kyc.set(`${USER_ID}:${ANCHOR_ID}`, {
            user_id: USER_ID, anchor_id: ANCHOR_ID, kyc_status: 'approved',
            kyc_level: null, rejection_reason: null,
            verified_at: new Date(),
            expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            updated_at: new Date(),
        });
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/transfer')
            .set('x-user-id', USER_ID)
            .send({ amount: '100', asset: 'USDC' });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
    });
    (0, vitest_1.it)('deposit_update webhook confirms payout and persists fee', async () => {
        seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'pending_anchor' });
        const res = await sendWebhook({
            event_type: 'deposit_update',
            transaction_id: TX_ID,
            status: 'pending_stellar',
            amount_in: '100.00',
            amount_out: '91.50',
            amount_fee: '8.50',
            stellar_transaction_id: 'stellar-hash-abc123',
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        const tx = db.tx.get(TX_ID);
        (0, vitest_1.expect)(tx?.status).toBe('pending_stellar');
        (0, vitest_1.expect)(tx?.amount_fee).toBe('8.50');
        (0, vitest_1.expect)(tx?.amount_out).toBe('91.50');
        (0, vitest_1.expect)(tx?.stellar_transaction_id).toBe('stellar-hash-abc123');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 3. CANCELLATION / REFUND FLOW
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Cancellation and refund flow', () => {
    const TX_ID = 'tx-cancel-001';
    (0, vitest_1.it)('deposit transitions to error via webhook', async () => {
        seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'pending_anchor' });
        const res = await sendWebhook({
            event_type: 'deposit_update', transaction_id: TX_ID,
            status: 'error', message: 'Compliance check failed',
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(db.tx.get(TX_ID)?.status).toBe('error');
    });
    (0, vitest_1.it)('error → refunded transition succeeds', async () => {
        seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'error' });
        const res = await sendWebhook({
            event_type: 'deposit_update', transaction_id: TX_ID,
            status: 'refunded', message: 'Funds returned to sender',
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(db.tx.get(TX_ID)?.status).toBe('refunded');
    });
    (0, vitest_1.it)('rejects invalid transition completed → error', async () => {
        seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'completed' });
        const res = await sendWebhook({
            event_type: 'deposit_update', transaction_id: TX_ID, status: 'error',
        });
        (0, vitest_1.expect)(res.status).toBe(500);
        (0, vitest_1.expect)(db.tx.get(TX_ID)?.status).toBe('completed'); // unchanged
    });
    (0, vitest_1.it)('withdrawal cancellation: pending_anchor → error → refunded', async () => {
        seedTransaction({ transaction_id: TX_ID, kind: 'withdrawal', status: 'pending_anchor' });
        await sendWebhook({
            event_type: 'withdrawal_update', transaction_id: TX_ID,
            status: 'error', message: 'Bank rejected transfer',
        });
        (0, vitest_1.expect)(db.tx.get(TX_ID)?.status).toBe('error');
        const res = await sendWebhook({
            event_type: 'withdrawal_update', transaction_id: TX_ID, status: 'refunded',
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(db.tx.get(TX_ID)?.status).toBe('refunded');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 4. DUPLICATE SETTLEMENT REJECTION
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Duplicate settlement rejection', () => {
    const TX_ID = 'tx-dup-001';
    (0, vitest_1.it)('stores FX rate on first call', async () => {
        const res = await (0, supertest_1.default)(api_1.default).post('/api/fx-rate').send({
            transactionId: TX_ID, rate: 1.10, provider: 'FXProvider',
            fromCurrency: 'USD', toCurrency: 'EUR',
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(db.fx.get(TX_ID)?.rate).toBe(1.10);
    });
    (0, vitest_1.it)('second FX write for same transaction is silently ignored', async () => {
        await (0, supertest_1.default)(api_1.default).post('/api/fx-rate').send({
            transactionId: TX_ID, rate: 1.10, provider: 'FXProvider',
            fromCurrency: 'USD', toCurrency: 'EUR',
        });
        const res = await (0, supertest_1.default)(api_1.default).post('/api/fx-rate').send({
            transactionId: TX_ID, rate: 1.99, provider: 'OtherProvider',
            fromCurrency: 'USD', toCurrency: 'EUR',
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(db.fx.get(TX_ID)?.rate).toBe(1.10); // original preserved
        (0, vitest_1.expect)(db.fx.get(TX_ID)?.provider).toBe('FXProvider');
    });
    (0, vitest_1.it)('GET /api/fx-rate/:id returns the locked rate', async () => {
        db.fx.set(TX_ID, {
            id: 1, transaction_id: TX_ID, rate: 1.10, provider: 'FXProvider',
            timestamp: new Date(), from_currency: 'USD', to_currency: 'EUR', created_at: new Date(),
        });
        const res = await (0, supertest_1.default)(api_1.default).get(`/api/fx-rate/${TX_ID}`);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.rate).toBe(1.10);
    });
    (0, vitest_1.it)('GET /api/fx-rate/:id returns 404 for unknown transaction', async () => {
        const res = await (0, supertest_1.default)(api_1.default).get('/api/fx-rate/tx-does-not-exist');
        (0, vitest_1.expect)(res.status).toBe(404);
    });
    (0, vitest_1.it)('duplicate deposit_update webhook (same invalid transition) returns 500', async () => {
        seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'pending_anchor' });
        const first = await sendWebhook({
            event_type: 'deposit_update', transaction_id: TX_ID, status: 'pending_stellar',
        });
        (0, vitest_1.expect)(first.status).toBe(200);
        // pending_stellar → pending_stellar is not a valid transition
        const second = await sendWebhook({
            event_type: 'deposit_update', transaction_id: TX_ID, status: 'pending_stellar',
        });
        (0, vitest_1.expect)(second.status).toBe(500);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 5. TRANSFER GUARD — KYC ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Transfer guard — KYC enforcement', () => {
    (0, vitest_1.it)('blocks unauthenticated request (no x-user-id header)', async () => {
        const res = await (0, supertest_1.default)(api_1.default).post('/api/transfer').send({});
        (0, vitest_1.expect)(res.status).toBe(401);
    });
    (0, vitest_1.it)('blocks transfer when user has no KYC record', async () => {
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/transfer').set('x-user-id', 'user-no-kyc').send({});
        (0, vitest_1.expect)(res.status).toBe(403);
        (0, vitest_1.expect)(res.body.error.code).toBe('KYC_PENDING');
    });
    (0, vitest_1.it)('blocks transfer when KYC is pending', async () => {
        db.kyc.set('user-pending:anchor-test', {
            user_id: 'user-pending', anchor_id: 'anchor-test', kyc_status: 'pending',
            kyc_level: null, rejection_reason: null,
            verified_at: new Date(), expires_at: null, updated_at: new Date(),
        });
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/transfer').set('x-user-id', 'user-pending').send({});
        (0, vitest_1.expect)(res.status).toBe(403);
        (0, vitest_1.expect)(res.body.error.code).toBe('KYC_PENDING');
    });
    (0, vitest_1.it)('blocks transfer when KYC is rejected', async () => {
        db.kyc.set('user-rejected:anchor-test', {
            user_id: 'user-rejected', anchor_id: 'anchor-test', kyc_status: 'rejected',
            kyc_level: null, rejection_reason: 'Document mismatch',
            verified_at: new Date(), expires_at: null, updated_at: new Date(),
        });
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/transfer').set('x-user-id', 'user-rejected').send({});
        (0, vitest_1.expect)(res.status).toBe(403);
        (0, vitest_1.expect)(res.body.error.code).toBe('KYC_NOT_APPROVED');
    });
    (0, vitest_1.it)('blocks transfer when KYC approval has expired', async () => {
        db.kyc.set('user-expired:anchor-test', {
            user_id: 'user-expired', anchor_id: 'anchor-test', kyc_status: 'approved',
            kyc_level: null, rejection_reason: null,
            verified_at: new Date(Date.now() - 400 * 24 * 3600 * 1000),
            expires_at: new Date(Date.now() - 1000), // 1 second ago
            updated_at: new Date(),
        });
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/transfer').set('x-user-id', 'user-expired').send({});
        (0, vitest_1.expect)(res.status).toBe(403);
        (0, vitest_1.expect)(res.body.error.code).toBe('KYC_EXPIRED');
    });
    (0, vitest_1.it)('allows transfer when KYC is approved and not expired', async () => {
        db.kyc.set('user-ok:anchor-test', {
            user_id: 'user-ok', anchor_id: 'anchor-test', kyc_status: 'approved',
            kyc_level: null, rejection_reason: null,
            verified_at: new Date(),
            expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            updated_at: new Date(),
        });
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/api/transfer').set('x-user-id', 'user-ok').send({});
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 6. WEBHOOK SECURITY
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Webhook security', () => {
    (0, vitest_1.it)('rejects webhook with missing required headers', async () => {
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/webhooks/anchor')
            .send({ event_type: 'deposit_update', transaction_id: 'tx-x' });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    (0, vitest_1.it)('rejects webhook with invalid HMAC signature', async () => {
        const body = { event_type: 'deposit_update', transaction_id: 'tx-x', status: 'completed' };
        const { timestamp, nonce } = signWebhook(body);
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/webhooks/anchor')
            .set('x-signature', 'deadbeef')
            .set('x-timestamp', timestamp)
            .set('x-nonce', nonce)
            .set('x-anchor-id', ANCHOR_ID)
            .send(body);
        (0, vitest_1.expect)(res.status).toBe(401);
    });
    (0, vitest_1.it)('rejects replay attack — duplicate nonce', async () => {
        seedTransaction({ transaction_id: 'tx-replay', kind: 'deposit', status: 'pending_anchor' });
        const body = { event_type: 'deposit_update', transaction_id: 'tx-replay', status: 'pending_stellar' };
        const { signature, timestamp, nonce } = signWebhook(body);
        const headers = { 'x-signature': signature, 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-anchor-id': ANCHOR_ID };
        await (0, supertest_1.default)(api_1.default).post('/webhooks/anchor').set(headers).send(body);
        const res = await (0, supertest_1.default)(api_1.default).post('/webhooks/anchor').set(headers).send(body);
        (0, vitest_1.expect)(res.status).toBe(401);
    });
    (0, vitest_1.it)('rejects webhook with stale timestamp (>5 min old)', async () => {
        const body = { event_type: 'deposit_update', transaction_id: 'tx-stale', status: 'pending_stellar' };
        const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const nonce = crypto_1.default.randomUUID();
        const signature = crypto_1.default.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(body)).digest('hex');
        const res = await (0, supertest_1.default)(api_1.default)
            .post('/webhooks/anchor')
            .set('x-signature', signature)
            .set('x-timestamp', staleTimestamp)
            .set('x-nonce', nonce)
            .set('x-anchor-id', ANCHOR_ID)
            .send(body);
        (0, vitest_1.expect)(res.status).toBe(401);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 7. KYC LAST-WRITE-WINS UPSERT SEMANTICS
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('KYC last-write-wins upsert', () => {
    const USER_ID = 'user-lww';
    (0, vitest_1.it)('does not overwrite a newer record with an older verified_at', async () => {
        const newerDate = new Date();
        const olderDate = new Date(newerDate.getTime() - 60_000);
        db.kyc.set(`${USER_ID}:${ANCHOR_ID}`, {
            user_id: USER_ID, anchor_id: ANCHOR_ID, kyc_status: 'approved',
            kyc_level: null, rejection_reason: null,
            verified_at: newerDate, expires_at: null, updated_at: new Date(),
        });
        seedTransaction({ transaction_id: 'tx-lww-1', kind: 'deposit', status: 'pending_anchor' });
        await sendWebhook({
            event_type: 'kyc_update', transaction_id: 'tx-lww-1',
            kyc_status: 'rejected', user_id: USER_ID, anchor_id: ANCHOR_ID,
            verified_at: olderDate.toISOString(),
        });
        // Approved record must survive — older rejected write is discarded
        (0, vitest_1.expect)(db.kyc.get(`${USER_ID}:${ANCHOR_ID}`)?.kyc_status).toBe('approved');
    });
    (0, vitest_1.it)('overwrites an older record when incoming verified_at is newer', async () => {
        const olderDate = new Date(Date.now() - 60_000);
        const newerDate = new Date();
        db.kyc.set(`${USER_ID}:${ANCHOR_ID}`, {
            user_id: USER_ID, anchor_id: ANCHOR_ID, kyc_status: 'pending',
            kyc_level: null, rejection_reason: null,
            verified_at: olderDate, expires_at: null, updated_at: new Date(),
        });
        seedTransaction({ transaction_id: 'tx-lww-2', kind: 'deposit', status: 'pending_anchor' });
        await sendWebhook({
            event_type: 'kyc_update', transaction_id: 'tx-lww-2',
            kyc_status: 'approved', user_id: USER_ID, anchor_id: ANCHOR_ID,
            verified_at: newerDate.toISOString(),
            expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        });
        (0, vitest_1.expect)(db.kyc.get(`${USER_ID}:${ANCHOR_ID}`)?.kyc_status).toBe('approved');
    });
});
