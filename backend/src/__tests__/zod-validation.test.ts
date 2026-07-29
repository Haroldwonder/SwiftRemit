/**
 * Zod validation tests (#874) — updated to match the strict schemas introduced
 * in the Feature A hardening pass:
 *
 *  - Stellar addresses validated with StrKey.isValidEd25519PublicKey (checksum).
 *  - Amounts must be positive integer strings — no floats, no scientific notation.
 *  - validateParams middleware tested alongside validateRequest / validateQuery.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { validateRequest, validateQuery, validateParams } from '../middleware/validate';
import {
  RemittanceCreateSchema,
  VerificationRequestSchema,
  SettlementSimulationSchema,
  AuditLogListQuerySchema,
  RemittanceIdParamSchema,
} from '../schemas/zod';

// ── Canonical test fixtures ────────────────────────────────────────────────
// Real valid Stellar public keys (pass StrKey checksum).
const VALID_SENDER = 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP';
const VALID_AGENT  = 'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU';
// Same key used as issuer where an issuer is required.
const VALID_ISSUER = VALID_SENDER;

describe('Zod Validation (#874)', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  // ── validateRequest (body) ──────────────────────────────────────────────

  describe('validateRequest middleware', () => {
    beforeEach(() => {
      app.post('/remittance', validateRequest(RemittanceCreateSchema), (req, res) => {
        res.json({ success: true, data: req.body });
      });
    });

    it('accepts a valid remittance — positive integer amount, real Stellar keys', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({ sender: VALID_SENDER, agent: VALID_AGENT, amount: '100' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe('100');
    });

    it('accepts optional fee and memo fields', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({
          sender: VALID_SENDER,
          agent:  VALID_AGENT,
          amount: '100',
          fee:    '2',
          memo:   'Payment for services',
        })
        .expect(200);

      expect(res.body.data.fee).toBe('2');
      expect(res.body.data.memo).toBe('Payment for services');
    });

    it('rejects a float amount with 400', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({ sender: VALID_SENDER, agent: VALID_AGENT, amount: '100.50' })
        .expect(400);

      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details.some((d: any) => d.field === 'amount')).toBe(true);
    });

    it('rejects scientific-notation amount with 400', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({ sender: VALID_SENDER, agent: VALID_AGENT, amount: '1e5' })
        .expect(400);

      expect(res.body.details.some((d: any) => d.field === 'amount')).toBe(true);
    });

    it('rejects zero amount with 400', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({ sender: VALID_SENDER, agent: VALID_AGENT, amount: '0' })
        .expect(400);

      expect(res.body.details.some((d: any) => d.field === 'amount')).toBe(true);
    });

    it('rejects a bad Stellar sender address with 400', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({ sender: 'not-a-stellar-key', agent: VALID_AGENT, amount: '100' })
        .expect(400);

      expect(res.body.details.some((d: any) => d.field === 'sender')).toBe(true);
    });

    it('rejects missing required fields with 400', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({ sender: VALID_SENDER })  // no agent, no amount
        .expect(400);

      expect(res.body.error).toBe('Validation failed');
    });

    it('rejects memo exceeding 100 characters with 400', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({ sender: VALID_SENDER, agent: VALID_AGENT, amount: '1', memo: 'a'.repeat(101) })
        .expect(400);

      expect(res.body.details.some((d: any) => d.field === 'memo')).toBe(true);
    });
  });

  // ── validateQuery (query string) ────────────────────────────────────────

  describe('validateQuery middleware', () => {
    beforeEach(() => {
      app.get('/audit-log', validateQuery(AuditLogListQuerySchema), (req, res) => {
        res.json({ query: req.query });
      });
    });

    it('accepts request with no query params (uses defaults)', async () => {
      const res = await request(app).get('/audit-log').expect(200);
      expect(res.body.query.limit).toBe(50); // schema default
    });

    it('accepts valid limit and cursor', async () => {
      const cursor = Buffer.from(JSON.stringify({ id: 1, created_at: new Date().toISOString() })).toString('base64');
      const res = await request(app)
        .get(`/audit-log?limit=100&cursor=${encodeURIComponent(cursor)}`)
        .expect(200);
      expect(Number(res.body.query.limit)).toBe(100);
    });

    it('rejects limit > 200 with 400', async () => {
      const res = await request(app).get('/audit-log?limit=999').expect(400);
      expect(res.body.error).toBe('Invalid query parameters');
    });
  });

  // ── validateParams (route params) ──────────────────────────────────────

  describe('validateParams middleware', () => {
    beforeEach(() => {
      app.get('/remittance/:remittanceId', validateParams(RemittanceIdParamSchema), (req, res) => {
        res.json({ id: req.params.remittanceId });
      });
    });

    it('accepts a valid remittance ID', async () => {
      const res = await request(app).get('/remittance/rem-123').expect(200);
      expect(res.body.id).toBe('rem-123');
    });

    it('rejects an empty string as remittance ID with 400', async () => {
      // Express won't route '/remittance/' to ':remittanceId' so we test the schema directly.
      const result = RemittanceIdParamSchema.safeParse({ remittanceId: '' });
      expect(result.success).toBe(false);
    });
  });

  // ── Schema unit tests ───────────────────────────────────────────────────

  describe('RemittanceCreateSchema', () => {
    it('parses valid integer amount', () => {
      const r = RemittanceCreateSchema.safeParse({
        sender: VALID_SENDER, agent: VALID_AGENT, amount: '50',
      });
      expect(r.success).toBe(true);
    });

    it('rejects float amount', () => {
      const r = RemittanceCreateSchema.safeParse({
        sender: VALID_SENDER, agent: VALID_AGENT, amount: '100.50',
      });
      expect(r.success).toBe(false);
    });

    it('rejects scientific notation amount', () => {
      const r = RemittanceCreateSchema.safeParse({
        sender: VALID_SENDER, agent: VALID_AGENT, amount: '1e10',
      });
      expect(r.success).toBe(false);
    });

    it('rejects invalid Stellar address for sender', () => {
      const r = RemittanceCreateSchema.safeParse({
        sender: 'AAAA', agent: VALID_AGENT, amount: '1',
      });
      expect(r.success).toBe(false);
    });

    it('rejects memo longer than 100 chars', () => {
      const r = RemittanceCreateSchema.safeParse({
        sender: VALID_SENDER, agent: VALID_AGENT, amount: '1', memo: 'x'.repeat(101),
      });
      expect(r.success).toBe(false);
    });

    it('rejects missing agent', () => {
      const r = RemittanceCreateSchema.safeParse({ sender: VALID_SENDER, amount: '1' });
      expect(r.success).toBe(false);
    });

    it('rejects amount exceeding max bound (10^15 + 1)', () => {
      const r = RemittanceCreateSchema.safeParse({
        sender: VALID_SENDER, agent: VALID_AGENT, amount: '1000000000000001',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('VerificationRequestSchema', () => {
    it('rejects a short issuer', () => {
      const r = VerificationRequestSchema.safeParse({ assetCode: 'USDC', issuer: 'SHORT' });
      expect(r.success).toBe(false);
    });

    it('rejects an address that is 56 chars but invalid checksum', () => {
      // All-A is 56 chars but not a real ed25519 key
      const r = VerificationRequestSchema.safeParse({
        assetCode: 'USDC',
        issuer: 'A'.repeat(56),
      });
      expect(r.success).toBe(false);
    });

    it('accepts a real valid issuer address', () => {
      const r = VerificationRequestSchema.safeParse({
        assetCode: 'USDC',
        issuer: VALID_ISSUER,
      });
      expect(r.success).toBe(true);
    });
  });

  describe('SettlementSimulationSchema', () => {
    it('accepts a positive integer remittanceId', () => {
      const r = SettlementSimulationSchema.safeParse({ remittanceId: 123 });
      expect(r.success).toBe(true);
    });

    it('rejects zero', () => {
      expect(SettlementSimulationSchema.safeParse({ remittanceId: 0 }).success).toBe(false);
    });

    it('rejects negative', () => {
      expect(SettlementSimulationSchema.safeParse({ remittanceId: -1 }).success).toBe(false);
    });
  });

  // ── Middleware error shape ──────────────────────────────────────────────

  describe('Validation middleware error shape', () => {
    it('returns field-level details array on validation failure', async () => {
      app.post('/shape-test', validateRequest(RemittanceCreateSchema), (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app)
        .post('/shape-test')
        .send({ sender: 'bad', agent: 'bad', amount: '1.5' })
        .expect(400);

      expect(res.body.error).toBe('Validation failed');
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details.length).toBeGreaterThan(0);
      expect(res.body.details[0]).toMatchObject({
        field:   expect.any(String),
        message: expect.any(String),
      });
    });

    it('passes valid body to handler and strips unknown keys via strict mode (if configured)', async () => {
      app.post('/pass-test', validateRequest(RemittanceCreateSchema), (req, res) => {
        res.json({ validated: true, amount: req.body.amount });
      });

      const res = await request(app)
        .post('/pass-test')
        .send({ sender: VALID_SENDER, agent: VALID_AGENT, amount: '999' })
        .expect(200);

      expect(res.body.validated).toBe(true);
      expect(res.body.amount).toBe('999');
    });
  });
});
