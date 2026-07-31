import { beforeAll, describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { newDb } from 'pg-mem';
import { PostgresAnchorStore } from '../db/anchorStore';
import { DEFAULT_ANCHORS } from '../data/defaultAnchors';

// ── Test constants ────────────────────────────────────────────────────────────

const adminApiKey = 'test-anchor-admin-key';

// Disable live TOML validation for all tests in this file so we don't make
// real HTTP calls to moneygram.stellar.org / circle.com etc.
process.env.ANCHOR_TOML_VALIDATION_DISABLED = 'true';

// ── Shared app / store setup ──────────────────────────────────────────────────

let app: ReturnType<typeof createApp>;
let store: PostgresAnchorStore;

beforeAll(async () => {
  // Use pg-mem so tests are hermetic — no real Postgres required.
  const db = newDb();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  store = new PostgresAnchorStore(pool);

  // initializeSchema creates the table + idempotent TOML-column ALTER (SR-060).
  await store.initializeSchema();

  // Seed from the DEFAULT_ANCHORS array — this is the only place in the test
  // suite where the TS array is consumed; all reads afterwards go via the DB.
  await store.seed(DEFAULT_ANCHORS);

  app = createApp({
    anchorStore: store,
    anchorAdminApiKey: adminApiKey,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── GET /api/anchors ──────────────────────────────────────────────────────────

describe('GET /api/anchors', () => {
  it('returns all active anchors', async () => {
    const response = await request(app)
      .get('/api/anchors?status=active')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeInstanceOf(Array);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.timestamp).toBeDefined();
    expect(response.body.data.map((a: any) => a.id)).toEqual([
      'anchor-1',
      'anchor-2',
      'anchor-3',
    ]);
  });

  it('filters anchors by currency', async () => {
    const response = await request(app)
      .get('/api/anchors?currency=USD')
      .expect(200);

    expect(response.body.success).toBe(true);
    response.body.data.forEach((anchor: any) => {
      expect(anchor.supported_currencies).toContain('USD');
    });
  });

  it('returns anchor with complete structure', async () => {
    const response = await request(app).get('/api/anchors').expect(200);

    const anchor = response.body.data[0];
    expect(anchor).toHaveProperty('id');
    expect(anchor).toHaveProperty('name');
    expect(anchor).toHaveProperty('fees');
    expect(anchor).toHaveProperty('limits');
    expect(anchor).toHaveProperty('compliance');
    expect(anchor.fees).toHaveProperty('deposit_fee_percent');
    expect(anchor.fees).toHaveProperty('withdrawal_fee_percent');
    expect(anchor.limits).toHaveProperty('min_amount');
    expect(anchor.limits).toHaveProperty('max_amount');
    expect(anchor.compliance).toHaveProperty('kyc_required');
    expect(anchor.compliance).toHaveProperty('kyc_level');
  });
});

// ── GET /api/anchors/:id ──────────────────────────────────────────────────────

describe('GET /api/anchors/:id', () => {
  it('returns a specific anchor by id', async () => {
    const response = await request(app).get('/api/anchors/anchor-1').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe('anchor-1');
    expect(response.body.data.name).toBe('MoneyGram Access');
  });

  it('returns 404 for a non-existent anchor', async () => {
    const response = await request(app).get('/api/anchors/non-existent').expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ANCHOR_NOT_FOUND');
  });
});

// ── Admin CRUD ────────────────────────────────────────────────────────────────

describe('Admin anchor management', () => {
  const newAnchor = {
    id: 'anchor-4',
    name: 'SwiftRemit Partner',
    domain: 'partner.swiftremit.io',
    logo_url: 'https://example.com/partner-logo.png',
    description: 'Regional payout partner',
    status: 'active',
    fees: {
      deposit_fee_percent: 1.2,
      withdrawal_fee_percent: 1.7,
    },
    limits: {
      min_amount: 20,
      max_amount: 15000,
      daily_limit: 30000,
    },
    compliance: {
      kyc_required: true,
      kyc_level: 'basic',
      supported_countries: ['NG', 'GH'],
      restricted_countries: ['KP'],
      documents_required: ['government_id'],
    },
    supported_currencies: ['USD', 'NGN'],
    processing_time: 'Same day',
    rating: 4.1,
    total_transactions: 1200,
    verified: true,
  };

  it('rejects admin requests without a valid API key', async () => {
    const response = await request(app)
      .post('/api/anchors/admin')
      .send(newAnchor)
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('full admin lifecycle: create → GET → update → deactivate → delete', async () => {
    // Create
    const createResponse = await request(app)
      .post('/api/anchors/admin')
      .set('x-api-key', adminApiKey)
      .send(newAnchor)
      .expect(201);

    expect(createResponse.body.success).toBe(true);
    expect(createResponse.body.data.id).toBe('anchor-4');

    // GET by id
    const getCreated = await request(app).get('/api/anchors/anchor-4').expect(200);
    expect(getCreated.body.data.name).toBe('SwiftRemit Partner');

    // Update
    const updateResponse = await request(app)
      .put('/api/anchors/admin/anchor-4')
      .set('x-api-key', adminApiKey)
      .send({
        processing_time: 'Next business day',
        supported_currencies: ['USD', 'NGN', 'GHS'],
      })
      .expect(200);

    expect(updateResponse.body.data.processing_time).toBe('Next business day');
    expect(updateResponse.body.data.supported_currencies).toContain('GHS');

    // Deactivate
    const deactivateResponse = await request(app)
      .post('/api/anchors/admin/anchor-4/deactivate')
      .set('x-api-key', adminApiKey)
      .expect(200);

    expect(deactivateResponse.body.data.status).toBe('inactive');

    // Deactivated anchor is not visible to clients
    await request(app).get('/api/anchors/anchor-4').expect(404);

    // Delete
    const deleteResponse = await request(app)
      .delete('/api/anchors/admin/anchor-4')
      .set('x-api-key', adminApiKey)
      .expect(200);

    expect(deleteResponse.body.success).toBe(true);
    expect(deleteResponse.body.data.id).toBe('anchor-4');
  });

  // ── SR-060: immediate availability after admin create ─────────────────────

  it('SR-060: an anchor added via POST /admin is immediately selectable by clients without restart', async () => {
    const immediateAnchor = {
      id: 'anchor-immediate',
      name: 'Immediate Test Anchor',
      domain: 'immediate.example.com',
      description: 'Verifies immediate availability after admin create',
      status: 'active',
      fees: { deposit_fee_percent: 1.0, withdrawal_fee_percent: 1.0 },
      limits: { min_amount: 1, max_amount: 1000 },
      compliance: {
        kyc_required: false,
        kyc_level: 'basic',
        supported_countries: ['US'],
        restricted_countries: [],
        documents_required: [],
      },
      supported_currencies: ['USD'],
      processing_time: 'Instant',
      verified: true,
    };

    // Create via admin API
    const createRes = await request(app)
      .post('/api/anchors/admin')
      .set('x-api-key', adminApiKey)
      .send(immediateAnchor)
      .expect(201);

    expect(createRes.body.success).toBe(true);

    // Immediately queryable via public GET — same process, no restart
    const getRes = await request(app)
      .get('/api/anchors/anchor-immediate')
      .expect(200);

    expect(getRes.body.data.id).toBe('anchor-immediate');
    expect(getRes.body.data.name).toBe('Immediate Test Anchor');

    // Also appears in the full list
    const listRes = await request(app)
      .get('/api/anchors?currency=USD')
      .expect(200);

    const ids = listRes.body.data.map((a: any) => a.id);
    expect(ids).toContain('anchor-immediate');

    // Cleanup
    await request(app)
      .delete('/api/anchors/admin/anchor-immediate')
      .set('x-api-key', adminApiKey)
      .expect(200);
  });

  // ── SR-060: TOML validation blocks creation ───────────────────────────────

  it('SR-060: anchor creation is rejected with 422 when stellar.toml validation fails', async () => {
    // Temporarily re-enable TOML validation and mock fetchAnchorToml to throw.
    delete process.env.ANCHOR_TOML_VALIDATION_DISABLED;

    // Mock the validator module so no real network call is made.
    const validatorModule = await import('../utils/anchor-toml-validator.js');
    vi.spyOn(validatorModule, 'fetchAnchorToml').mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 0.0.0.0:443'),
    );

    const badAnchor = {
      id: 'anchor-toml-fail',
      name: 'Bad TOML Anchor',
      domain: 'unreachable.invalid',
      description: 'Domain with no stellar.toml',
      status: 'active',
      fees: { deposit_fee_percent: 1.0, withdrawal_fee_percent: 1.0 },
      limits: { min_amount: 1, max_amount: 1000 },
      compliance: {
        kyc_required: false,
        kyc_level: 'basic',
        supported_countries: ['US'],
        restricted_countries: [],
        documents_required: [],
      },
      supported_currencies: ['USD'],
      processing_time: 'Instant',
      verified: true,
    };

    const res = await request(app)
      .post('/api/anchors/admin')
      .set('x-api-key', adminApiKey)
      .send(badAnchor)
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ANCHOR_TOML_INVALID');
    expect(res.body.error.message).toContain('unreachable.invalid');

    // Confirm the anchor was NOT persisted
    await request(app).get('/api/anchors/anchor-toml-fail').expect(404);

    // Restore the env flag so other tests remain unaffected
    process.env.ANCHOR_TOML_VALIDATION_DISABLED = 'true';
  });

  it('SR-060: anchor creation is rejected with 422 when stellar.toml is missing required fields', async () => {
    delete process.env.ANCHOR_TOML_VALIDATION_DISABLED;

    const validatorModule = await import('../utils/anchor-toml-validator.js');
    vi.spyOn(validatorModule, 'fetchAnchorToml').mockRejectedValueOnce(
      new Error('stellar.toml missing required fields: SIGNING_KEY'),
    );

    const missingKeyAnchor = {
      id: 'anchor-missing-key',
      name: 'Missing Key Anchor',
      domain: 'no-signing-key.example.com',
      description: 'TOML present but SIGNING_KEY absent',
      status: 'active',
      fees: { deposit_fee_percent: 0.5, withdrawal_fee_percent: 0.5 },
      limits: { min_amount: 1, max_amount: 5000 },
      compliance: {
        kyc_required: false,
        kyc_level: 'basic',
        supported_countries: ['US'],
        restricted_countries: [],
        documents_required: [],
      },
      supported_currencies: ['USD'],
      processing_time: 'Instant',
      verified: false,
    };

    const res = await request(app)
      .post('/api/anchors/admin')
      .set('x-api-key', adminApiKey)
      .send(missingKeyAnchor)
      .expect(422);

    expect(res.body.error.code).toBe('ANCHOR_TOML_INVALID');
    expect(res.body.error.message).toContain('SIGNING_KEY');

    // Anchor must not have been stored
    await request(app).get('/api/anchors/anchor-missing-key').expect(404);

    process.env.ANCHOR_TOML_VALIDATION_DISABLED = 'true';
  });
});
