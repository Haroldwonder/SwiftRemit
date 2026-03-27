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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import type { Pool, PoolClient, QueryResult } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted — everything declared here is available inside vi.mock factories
// ─────────────────────────────────────────────────────────────────────────────

const { db, resetDb, seedTransaction, handleQuery, mockPool } = vi.hoisted(() => {
  // ── in-memory tables ──────────────────────────────────────────────────────
  interface KycRow {
    user_id: string; anchor_id: string; kyc_status: string;
    kyc_level: string | null; rejection_reason: string | null;
    verified_at: Date; expires_at: Date | null; updated_at: Date;
  }
  interface FxRow {
    id: number; transaction_id: string; rate: number; provider: string;
    timestamp: Date; from_currency: string; to_currency: string; created_at: Date;
  }
  interface TxRow {
    transaction_id: string; anchor_id: string; kind: string; status: string;
    amount_in: string | null; amount_out: string | null; amount_fee: string | null;
    stellar_transaction_id: string | null; external_transaction_id: string | null;
    kyc_status: string | null; kyc_fields: any; kyc_rejection_reason: string | null;
    message: string | null; created_at: Date; updated_at: Date;
  }

  const db = {
    kyc: new Map<string, KycRow>(),
    fx: new Map<string, FxRow>(),
    tx: new Map<string, TxRow>(),
    anchorConfigs: new Map<string, any>(),
    fxIdSeq: 1,
  };

  function resetDb() {
    db.kyc.clear(); db.fx.clear(); db.tx.clear();
    db.anchorConfigs.clear(); db.fxIdSeq = 1;
  }

  function seedTransaction(row: Partial<TxRow> & { transaction_id: string; kind: string; status: string }) {
    db.tx.set(row.transaction_id, {
      anchor_id: 'anchor-test', amount_in: null, amount_out: null, amount_fee: null,
      stellar_transaction_id: null, external_transaction_id: null,
      kyc_status: null, kyc_fields: null, kyc_rejection_reason: null, message: null,
      created_at: new Date(), updated_at: new Date(), ...row,
    });
  }

  function makeResult<T extends Record<string, any>>(rows: T[]): QueryResult<T> {
    return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
  }

  function handleQuery(sql: string, params: any[]): QueryResult {
    const s = sql.replace(/\s+/g, ' ').trim().toUpperCase();

    // user_kyc_status — upsert (KycUpsertService)
    if (s.includes('INSERT INTO USER_KYC_STATUS') && s.includes('ON CONFLICT')) {
      const [user_id, anchor_id, kyc_status, kyc_level, rejection_reason, verified_at, expires_at] = params;
      const key = `${user_id}:${anchor_id}`;
      const existing = db.kyc.get(key);
      if (existing && existing.verified_at >= new Date(verified_at)) return makeResult([]);
      const row: KycRow = {
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
    if (s.includes('FROM ANCHOR_KYC_CONFIGS')) return makeResult([...db.anchorConfigs.values()]);
    // fx_rates — insert (idempotent)
    if (s.includes('INSERT INTO FX_RATES') && s.includes('DO NOTHING')) {
      const [transaction_id, rate, provider, timestamp, from_currency, to_currency] = params;
      if (db.fx.has(transaction_id)) return makeResult([]);
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
    if (s.includes('INSERT INTO WEBHOOK_LOGS')) return makeResult([{ id: 'wh-mock-id' }]);
    if (s.includes('FROM WEBHOOK_LOGS')) return makeResult([{ count: '0' }]);
    if (s.includes('SUSPICIOUS_WEBHOOKS')) return makeResult([{ count: '0' }]);
    // everything else (state history, verified_assets, etc.)
    return makeResult([]);
  }

  const mockClient = {
    query: async (sql: string, params?: any[]) => handleQuery(sql, params ?? []),
    release: () => {},
  };
  const mockPool = {
    query: async (sql: string, params?: any[]) => handleQuery(sql, params ?? []),
    connect: async () => mockClient,
  } as unknown as Pool;

  return { db, resetDb, seedTransaction, handleQuery, mockPool };
});

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — use mockPool / db from vi.hoisted above
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn().mockResolvedValue(undefined),
  updateKycStatusOnChain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../stellar-kyc', () => ({
  setKycApprovedOnChain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database')>();
  return {
    ...actual,
    initDatabase: vi.fn().mockResolvedValue(undefined),
    getPool: vi.fn(() => mockPool),
    pool: mockPool,
    saveAssetVerification: vi.fn().mockResolvedValue(undefined),
    getAssetVerification: vi.fn().mockResolvedValue(null),
    getVerifiedAssets: vi.fn().mockResolvedValue([]),
    reportSuspiciousAsset: vi.fn().mockResolvedValue(undefined),
    getStaleAssets: vi.fn().mockResolvedValue([]),
    getUsersNeedingKycCheck: vi.fn().mockResolvedValue([]),
    // These close over `db` — safe because vi.hoisted runs first
    saveFxRate: vi.fn(async (fxRate: any) => {
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
    getFxRate: vi.fn(async (txId: string) => db.fx.get(txId) ?? null),
    saveAnchorKycConfig: vi.fn(async (config: any) => {
      db.anchorConfigs.set(config.anchor_id, config);
    }),
    getUserKycStatus: vi.fn(async (userId: string, anchorId: string) =>
      db.kyc.get(`${userId}:${anchorId}`) ?? null
    ),
    saveUserKycStatus: vi.fn(async (record: any) => {
      db.kyc.set(`${record.user_id}:${record.anchor_id}`, { ...record, updated_at: new Date() });
    }),
    getAnchorKycConfigs: vi.fn(async () => [...db.anchorConfigs.values()]),
    getApprovedUsers: vi.fn(async () =>
      [...db.kyc.values()].filter(r => r.kyc_status === 'approved')
    ),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// App + helpers — imported after mocks are wired
// ─────────────────────────────────────────────────────────────────────────────

import app from '../api';
import { WebhookHandler } from '../webhook-handler';

// The webhook routes are registered in index.ts, not api.ts.
// Set them up here so the test app has /webhooks/anchor.
const webhookHandler = new WebhookHandler(mockPool);
webhookHandler.setupRoutes(app);

const WEBHOOK_SECRET = 'test-webhook-secret';
const ANCHOR_ID = 'anchor-test';

/** Build a valid signed webhook request. */
function signWebhook(body: object) {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  return { signature, timestamp, nonce };
}

async function sendWebhook(body: object) {
  const { signature, timestamp, nonce } = signWebhook(body);
  return request(app)
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

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────

describe('Health check', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. FULL HAPPY-PATH LIFECYCLE
//    register agent → register user → approve KYC → lock FX rate →
//    transfer → confirm payout → verify fee accumulation
// ─────────────────────────────────────────────────────────────────────────────

describe('Full remittance lifecycle — happy path', () => {
  const USER_ID = 'user-alice';
  const TX_ID = 'tx-remittance-001';

  it('registers an anchor agent (KYC config)', async () => {
    const res = await request(app).post('/api/kyc/config').send({
      anchorId: ANCHOR_ID,
      kycServerUrl: 'https://kyc.anchor-test.example',
      authToken: 'secret-token',
      pollingIntervalMinutes: 60,
      enabled: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(db.anchorConfigs.has(ANCHOR_ID)).toBe(true);
  });

  it('registers a user for KYC (pending state)', async () => {
    const res = await request(app)
      .post('/api/kyc/register')
      .send({ userId: USER_ID, anchorId: ANCHOR_ID });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const record = db.kyc.get(`${USER_ID}:${ANCHOR_ID}`);
    expect(record).toBeDefined();
    // KycService.registerUserForKyc stores a DbUserKycStatus with `status` field
    expect((record as any)?.status ?? (record as any)?.kyc_status).toBe('pending');
  });

  it('KYC webhook approves the user and triggers on-chain sync', async () => {
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

    expect(res.status).toBe(200);
    expect(db.kyc.get(`${USER_ID}:${ANCHOR_ID}`)?.kyc_status).toBe('approved');

    const { setKycApprovedOnChain } = await import('../stellar-kyc');
    expect(setKycApprovedOnChain).toHaveBeenCalledWith(USER_ID, true, expect.any(Date));
  });

  it('GET /api/kyc/status reflects approval and can_transfer=true', async () => {
    db.kyc.set(`${USER_ID}:${ANCHOR_ID}`, {
      user_id: USER_ID, anchor_id: ANCHOR_ID, kyc_status: 'approved',
      kyc_level: 'basic', rejection_reason: null,
      verified_at: new Date(),
      expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      updated_at: new Date(),
    });

    const res = await request(app).get('/api/kyc/status').set('x-user-id', USER_ID);
    expect(res.status).toBe(200);
    expect(res.body.overall_status).toBe('approved');
    expect(res.body.can_transfer).toBe(true);
    expect(res.body.anchors.length).toBeGreaterThan(0);
  });

  it('locks FX rate for the remittance (immutable)', async () => {
    const res = await request(app).post('/api/fx-rate').send({
      transactionId: TX_ID, rate: 1.085, provider: 'CurrencyAPI',
      fromCurrency: 'USD', toCurrency: 'EUR',
    });
    expect(res.status).toBe(200);
    expect(db.fx.get(TX_ID)?.rate).toBe(1.085);
  });

  it('POST /api/transfer succeeds for KYC-approved user', async () => {
    db.kyc.set(`${USER_ID}:${ANCHOR_ID}`, {
      user_id: USER_ID, anchor_id: ANCHOR_ID, kyc_status: 'approved',
      kyc_level: null, rejection_reason: null,
      verified_at: new Date(),
      expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      updated_at: new Date(),
    });

    const res = await request(app)
      .post('/api/transfer')
      .set('x-user-id', USER_ID)
      .send({ amount: '100', asset: 'USDC' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('deposit_update webhook confirms payout and persists fee', async () => {
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

    expect(res.status).toBe(200);
    const tx = db.tx.get(TX_ID);
    expect(tx?.status).toBe('pending_stellar');
    expect(tx?.amount_fee).toBe('8.50');
    expect(tx?.amount_out).toBe('91.50');
    expect(tx?.stellar_transaction_id).toBe('stellar-hash-abc123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CANCELLATION / REFUND FLOW
// ─────────────────────────────────────────────────────────────────────────────

describe('Cancellation and refund flow', () => {
  const TX_ID = 'tx-cancel-001';

  it('deposit transitions to error via webhook', async () => {
    seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'pending_anchor' });
    const res = await sendWebhook({
      event_type: 'deposit_update', transaction_id: TX_ID,
      status: 'error', message: 'Compliance check failed',
    });
    expect(res.status).toBe(200);
    expect(db.tx.get(TX_ID)?.status).toBe('error');
  });

  it('error → refunded transition succeeds', async () => {
    seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'error' });
    const res = await sendWebhook({
      event_type: 'deposit_update', transaction_id: TX_ID,
      status: 'refunded', message: 'Funds returned to sender',
    });
    expect(res.status).toBe(200);
    expect(db.tx.get(TX_ID)?.status).toBe('refunded');
  });

  it('rejects invalid transition completed → error', async () => {
    seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'completed' });
    const res = await sendWebhook({
      event_type: 'deposit_update', transaction_id: TX_ID, status: 'error',
    });
    expect(res.status).toBe(500);
    expect(db.tx.get(TX_ID)?.status).toBe('completed'); // unchanged
  });

  it('withdrawal cancellation: pending_anchor → error → refunded', async () => {
    seedTransaction({ transaction_id: TX_ID, kind: 'withdrawal', status: 'pending_anchor' });

    await sendWebhook({
      event_type: 'withdrawal_update', transaction_id: TX_ID,
      status: 'error', message: 'Bank rejected transfer',
    });
    expect(db.tx.get(TX_ID)?.status).toBe('error');

    const res = await sendWebhook({
      event_type: 'withdrawal_update', transaction_id: TX_ID, status: 'refunded',
    });
    expect(res.status).toBe(200);
    expect(db.tx.get(TX_ID)?.status).toBe('refunded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DUPLICATE SETTLEMENT REJECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Duplicate settlement rejection', () => {
  const TX_ID = 'tx-dup-001';

  it('stores FX rate on first call', async () => {
    const res = await request(app).post('/api/fx-rate').send({
      transactionId: TX_ID, rate: 1.10, provider: 'FXProvider',
      fromCurrency: 'USD', toCurrency: 'EUR',
    });
    expect(res.status).toBe(200);
    expect(db.fx.get(TX_ID)?.rate).toBe(1.10);
  });

  it('second FX write for same transaction is silently ignored', async () => {
    await request(app).post('/api/fx-rate').send({
      transactionId: TX_ID, rate: 1.10, provider: 'FXProvider',
      fromCurrency: 'USD', toCurrency: 'EUR',
    });
    const res = await request(app).post('/api/fx-rate').send({
      transactionId: TX_ID, rate: 1.99, provider: 'OtherProvider',
      fromCurrency: 'USD', toCurrency: 'EUR',
    });
    expect(res.status).toBe(200);
    expect(db.fx.get(TX_ID)?.rate).toBe(1.10);       // original preserved
    expect(db.fx.get(TX_ID)?.provider).toBe('FXProvider');
  });

  it('GET /api/fx-rate/:id returns the locked rate', async () => {
    db.fx.set(TX_ID, {
      id: 1, transaction_id: TX_ID, rate: 1.10, provider: 'FXProvider',
      timestamp: new Date(), from_currency: 'USD', to_currency: 'EUR', created_at: new Date(),
    });
    const res = await request(app).get(`/api/fx-rate/${TX_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.rate).toBe(1.10);
  });

  it('GET /api/fx-rate/:id returns 404 for unknown transaction', async () => {
    const res = await request(app).get('/api/fx-rate/tx-does-not-exist');
    expect(res.status).toBe(404);
  });

  it('duplicate deposit_update webhook (same invalid transition) returns 500', async () => {
    seedTransaction({ transaction_id: TX_ID, kind: 'deposit', status: 'pending_anchor' });

    const first = await sendWebhook({
      event_type: 'deposit_update', transaction_id: TX_ID, status: 'pending_stellar',
    });
    expect(first.status).toBe(200);

    // pending_stellar → pending_stellar is not a valid transition
    const second = await sendWebhook({
      event_type: 'deposit_update', transaction_id: TX_ID, status: 'pending_stellar',
    });
    expect(second.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. TRANSFER GUARD — KYC ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('Transfer guard — KYC enforcement', () => {
  it('blocks unauthenticated request (no x-user-id header)', async () => {
    const res = await request(app).post('/api/transfer').send({});
    expect(res.status).toBe(401);
  });

  it('blocks transfer when user has no KYC record', async () => {
    const res = await request(app)
      .post('/api/transfer').set('x-user-id', 'user-no-kyc').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_PENDING');
  });

  it('blocks transfer when KYC is pending', async () => {
    db.kyc.set('user-pending:anchor-test', {
      user_id: 'user-pending', anchor_id: 'anchor-test', kyc_status: 'pending',
      kyc_level: null, rejection_reason: null,
      verified_at: new Date(), expires_at: null, updated_at: new Date(),
    });
    const res = await request(app)
      .post('/api/transfer').set('x-user-id', 'user-pending').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_PENDING');
  });

  it('blocks transfer when KYC is rejected', async () => {
    db.kyc.set('user-rejected:anchor-test', {
      user_id: 'user-rejected', anchor_id: 'anchor-test', kyc_status: 'rejected',
      kyc_level: null, rejection_reason: 'Document mismatch',
      verified_at: new Date(), expires_at: null, updated_at: new Date(),
    });
    const res = await request(app)
      .post('/api/transfer').set('x-user-id', 'user-rejected').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_NOT_APPROVED');
  });

  it('blocks transfer when KYC approval has expired', async () => {
    db.kyc.set('user-expired:anchor-test', {
      user_id: 'user-expired', anchor_id: 'anchor-test', kyc_status: 'approved',
      kyc_level: null, rejection_reason: null,
      verified_at: new Date(Date.now() - 400 * 24 * 3600 * 1000),
      expires_at: new Date(Date.now() - 1000), // 1 second ago
      updated_at: new Date(),
    });
    const res = await request(app)
      .post('/api/transfer').set('x-user-id', 'user-expired').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_EXPIRED');
  });

  it('allows transfer when KYC is approved and not expired', async () => {
    db.kyc.set('user-ok:anchor-test', {
      user_id: 'user-ok', anchor_id: 'anchor-test', kyc_status: 'approved',
      kyc_level: null, rejection_reason: null,
      verified_at: new Date(),
      expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      updated_at: new Date(),
    });
    const res = await request(app)
      .post('/api/transfer').set('x-user-id', 'user-ok').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. WEBHOOK SECURITY
// ─────────────────────────────────────────────────────────────────────────────

describe('Webhook security', () => {
  it('rejects webhook with missing required headers', async () => {
    const res = await request(app)
      .post('/webhooks/anchor')
      .send({ event_type: 'deposit_update', transaction_id: 'tx-x' });
    expect(res.status).toBe(400);
  });

  it('rejects webhook with invalid HMAC signature', async () => {
    const body = { event_type: 'deposit_update', transaction_id: 'tx-x', status: 'completed' };
    const { timestamp, nonce } = signWebhook(body);
    const res = await request(app)
      .post('/webhooks/anchor')
      .set('x-signature', 'deadbeef')
      .set('x-timestamp', timestamp)
      .set('x-nonce', nonce)
      .set('x-anchor-id', ANCHOR_ID)
      .send(body);
    expect(res.status).toBe(401);
  });

  it('rejects replay attack — duplicate nonce', async () => {
    seedTransaction({ transaction_id: 'tx-replay', kind: 'deposit', status: 'pending_anchor' });
    const body = { event_type: 'deposit_update', transaction_id: 'tx-replay', status: 'pending_stellar' };
    const { signature, timestamp, nonce } = signWebhook(body);

    const headers = { 'x-signature': signature, 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-anchor-id': ANCHOR_ID };
    await request(app).post('/webhooks/anchor').set(headers).send(body);
    const res = await request(app).post('/webhooks/anchor').set(headers).send(body);
    expect(res.status).toBe(401);
  });

  it('rejects webhook with stale timestamp (>5 min old)', async () => {
    const body = { event_type: 'deposit_update', transaction_id: 'tx-stale', status: 'pending_stellar' };
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const nonce = crypto.randomUUID();
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(body)).digest('hex');
    const res = await request(app)
      .post('/webhooks/anchor')
      .set('x-signature', signature)
      .set('x-timestamp', staleTimestamp)
      .set('x-nonce', nonce)
      .set('x-anchor-id', ANCHOR_ID)
      .send(body);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. KYC LAST-WRITE-WINS UPSERT SEMANTICS
// ─────────────────────────────────────────────────────────────────────────────

describe('KYC last-write-wins upsert', () => {
  const USER_ID = 'user-lww';

  it('does not overwrite a newer record with an older verified_at', async () => {
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
    expect(db.kyc.get(`${USER_ID}:${ANCHOR_ID}`)?.kyc_status).toBe('approved');
  });

  it('overwrites an older record when incoming verified_at is newer', async () => {
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

    expect(db.kyc.get(`${USER_ID}:${ANCHOR_ID}`)?.kyc_status).toBe('approved');
  });
});
