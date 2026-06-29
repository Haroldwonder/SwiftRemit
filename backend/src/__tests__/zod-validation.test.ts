import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { validateRequest, validateQuery } from '../middleware/validate';
import {
  RemittanceCreateSchema,
  VerificationRequestSchema,
  SettlementSimulationSchema,
} from '../schemas/zod';

describe('Zod Validation (#874)', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('validateRequest middleware', () => {
    beforeEach(() => {
      app.post('/remittance', validateRequest(RemittanceCreateSchema), (req, res) => {
        res.json({ success: true, data: req.body });
      });
    });

    it('should accept valid remittance creation request', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({
          sender: 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP',
          agent: 'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU',
          amount: '100.50',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe('100.50');
    });

    it('should accept optional fee and memo fields', async () => {
      const res = await request(app)
        .post('/remittance')
        .send({
          sender: 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP',
          agent: 'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU',
          amount: '100.50',
          fee: '2.50',
          memo: 'Payment for services',
        })
        .expect(200);

      expect(res.body.data.fee).toBe('2.50');
      expect(res.body.data.memo).toBe('Payment for services');
    });
  });

  describe('Zod schemas', () => {
    it('RemittanceCreateSchema should parse valid data', () => {
      const data = {
        sender: 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP',
        agent: 'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU',
        amount: '100.50',
      };
      const result = RemittanceCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('VerificationRequestSchema should enforce issuer length', () => {
      const data = {
        assetCode: 'USDC',
        issuer: 'SHORT',
      };
      const result = VerificationRequestSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('SettlementSimulationSchema should accept positive integers', () => {
      const data = { remittanceId: 123 };
      const result = SettlementSimulationSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('SettlementSimulationSchema should reject zero or negative', () => {
      expect(SettlementSimulationSchema.safeParse({ remittanceId: 0 }).success).toBe(false);
      expect(SettlementSimulationSchema.safeParse({ remittanceId: -1 }).success).toBe(false);
    });

    it('RemittanceCreateSchema should reject missing required fields', () => {
      const data = { sender: 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP' };
      const result = RemittanceCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('RemittanceCreateSchema should reject invalid amount', () => {
      const data = {
        sender: 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP',
        agent: 'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU',
        amount: 'invalid',
      };
      const result = RemittanceCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('RemittanceCreateSchema should reject memo exceeding 100 characters', () => {
      const data = {
        sender: 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP',
        agent: 'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU',
        amount: '100.50',
        memo: 'a'.repeat(101),
      };
      const result = RemittanceCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('VerificationRequestSchema should accept valid data', () => {
      const data = {
        assetCode: 'USDC',
        issuer: 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP1', // 56 chars
      };
      const result = VerificationRequestSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('Validation middleware behavior', () => {
    it('should pass valid data to next middleware', async () => {
      app.post('/test', validateRequest(RemittanceCreateSchema), (req, res) => {
        expect(req.body.amount).toBeDefined();
        res.json({ validated: true });
      });

      await request(app)
        .post('/test')
        .send({
          sender: 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP',
          agent: 'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU',
          amount: '50.00',
        })
        .expect(200);
    });
  });
});
