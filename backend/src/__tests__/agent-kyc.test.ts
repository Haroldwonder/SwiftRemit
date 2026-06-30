import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../database', () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  getPool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn() })),
  upsertAgentKyc: vi.fn().mockResolvedValue(undefined),
  getAgentKyc: vi.fn(),
  // other DB fns imported by api.ts
  getAssetVerification: vi.fn().mockResolvedValue(null),
  saveAssetVerification: vi.fn().mockResolvedValue(undefined),
  reportSuspiciousAsset: vi.fn().mockResolvedValue(undefined),
  getVerifiedAssets: vi.fn().mockResolvedValue([]),
  saveFxRate: vi.fn().mockResolvedValue(undefined),
  getFxRate: vi.fn().mockResolvedValue(null),
  saveAnchorKycConfig: vi.fn().mockResolvedValue(undefined),
  getUserKycStatus: vi.fn().mockResolvedValue(null),
  saveUserKycStatus: vi.fn().mockResolvedValue(undefined),
  saveAssetReport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('axios');

vi.mock('../verifier', () => ({
  AssetVerifier: vi.fn().mockImplementation(() => ({
    verifyAsset: vi.fn().mockResolvedValue({ status: 'verified', reputation_score: 90 }),
  })),
}));

vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn().mockResolvedValue(undefined),
  simulateSettlement: vi.fn().mockResolvedValue({}),
  updateKycStatusOnChain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../fx-rate-cache', () => ({
  getFxRateCache: vi.fn(() => ({
    getCachedRate: vi.fn().mockReturnValue(null),
    setCachedRate: vi.fn(),
    getProviderRates: vi.fn().mockReturnValue([]),
    setBestRate: vi.fn(),
  })),
}));

vi.mock('../metrics', () => ({
  getMetricsService: vi.fn(() => ({
    getMetrics: vi.fn().mockResolvedValue(''),
    recordRequest: vi.fn(),
  })),
}));

vi.mock('../kyc-upsert-service', () => ({
  KycUpsertService: vi.fn().mockImplementation(() => ({
    getUserKycStatus: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../transfer-guard', () => ({
  createTransferGuard: vi.fn(() => vi.fn((_req: any, _res: any, next: any) => next())),
}));

vi.mock('../sep24-service', () => ({
  Sep24Service: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../routes/docs', async () => {
  const { Router } = await import('express');
  const r = Router();
  return { default: r };
});

vi.mock('../correlation-id', () => ({
  correlationIdMiddleware: (_req: any, _res: any, next: any) => next(),
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks are set up)
// ---------------------------------------------------------------------------

import * as db from '../database';
import { sendEmail } from '../email';
import { AgentKycService } from '../agent-kyc-service';
import app from '../api';
import axios from 'axios';

const mockedGetAgentKyc = db.getAgentKyc as ReturnType<typeof vi.fn>;
const mockedUpsertAgentKyc = db.upsertAgentKyc as ReturnType<typeof vi.fn>;
const mockedSendEmail = sendEmail as ReturnType<typeof vi.fn>;
const mockedAxios = axios as unknown as { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

const sampleRecord = {
  agent_id: 'agent-001',
  business_registration: { name: 'Acme Ltd', reg_no: 'RC12345' },
  owner_id: 'owner-xyz',
  operating_country: 'NG',
  payout_address: 'GABCDE...',
  contact_email: 'agent@acme.com',
  status: 'submitted' as const,
  rejection_reason: undefined,
  submitted_at: new Date('2024-01-01T00:00:00Z'),
  reviewed_at: undefined,
};

// ---------------------------------------------------------------------------
// AgentKycService unit tests
// ---------------------------------------------------------------------------

describe('AgentKycService', () => {
  let service: AgentKycService;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SEP12_KYC_SERVER;
    delete process.env.SEP12_AUTH_TOKEN;
    service = new AgentKycService();
  });

  describe('submitKyc', () => {
    it('saves record with status submitted and sends confirmation email', async () => {
      const result = await service.submitKyc({ ...sampleRecord });

      expect(mockedUpsertAgentKyc).toHaveBeenCalledOnce();
      const saved = mockedUpsertAgentKyc.mock.calls[0][0];
      expect(saved.agent_id).toBe('agent-001');
      expect(saved.status).toBe('submitted');
      expect(mockedSendEmail).toHaveBeenCalledWith(
        'agent@acme.com',
        'Agent KYC submitted',
        expect.stringContaining('agent-001')
      );
      expect(result.agent_id).toBe('agent-001');
    });

    it('does not send email when contact_email is absent', async () => {
      await service.submitKyc({ ...sampleRecord, contact_email: null });
      expect(mockedSendEmail).not.toHaveBeenCalled();
    });

    describe('with SEP-12 configured', () => {
      beforeEach(() => {
        process.env.SEP12_KYC_SERVER = 'https://kyc.anchor.example.com';
        process.env.SEP12_AUTH_TOKEN = 'test-token';
        vi.spyOn(axios, 'put').mockResolvedValue({ data: { id: 'sep12-cust-42' } } as any);
      });

      it('calls SEP-12 PUT /customer with type=business and stores customer id', async () => {
        const result = await service.submitKyc({ ...sampleRecord });

        expect(axios.put).toHaveBeenCalledWith(
          'https://kyc.anchor.example.com/customer',
          expect.objectContaining({ type: 'business', country_code: 'NG' }),
          expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
        );
        expect((result as any).sep12_customer_id).toBe('sep12-cust-42');
        expect(result.status).toBe('under_review');
      });

      it('falls back to submitted status when SEP-12 PUT fails', async () => {
        vi.spyOn(axios, 'put').mockRejectedValue(new Error('network error'));
        const result = await service.submitKyc({ ...sampleRecord });
        expect(result.status).toBe('submitted');
      });
    });
  });

  describe('getKyc', () => {
    it('returns the record from the database', async () => {
      mockedGetAgentKyc.mockResolvedValue(sampleRecord);
      const result = await service.getKyc('agent-001');
      expect(result).toEqual(sampleRecord);
      expect(mockedGetAgentKyc).toHaveBeenCalledWith('agent-001');
    });

    it('returns null when agent not found', async () => {
      mockedGetAgentKyc.mockResolvedValue(null);
      expect(await service.getKyc('unknown')).toBeNull();
    });
  });

  describe('reviewKyc', () => {
    beforeEach(() => {
      mockedGetAgentKyc.mockResolvedValue({ ...sampleRecord });
    });

    it('throws when agent KYC record does not exist', async () => {
      mockedGetAgentKyc.mockResolvedValue(null);
      await expect(service.reviewKyc('agent-001', 'approved')).rejects.toThrow('Agent KYC not found');
    });

    it('approves and sends approval email', async () => {
      const result = await service.reviewKyc('agent-001', 'approved');
      expect(result.status).toBe('approved');
      expect(mockedSendEmail).toHaveBeenCalledWith(
        'agent@acme.com',
        'Agent KYC approved',
        expect.stringContaining('approved')
      );
    });

    it('rejects with reason and sends rejection email', async () => {
      const result = await service.reviewKyc('agent-001', 'rejected', 'Incomplete documents');
      expect(result.status).toBe('rejected');
      expect(result.rejection_reason).toBe('Incomplete documents');
      expect(mockedSendEmail).toHaveBeenCalledWith(
        'agent@acme.com',
        'Agent KYC rejected',
        expect.stringContaining('Incomplete documents')
      );
    });

    it('sets under_review and sends under review email', async () => {
      const result = await service.reviewKyc('agent-001', 'under_review');
      expect(result.status).toBe('under_review');
      expect(mockedSendEmail).toHaveBeenCalledWith(
        'agent@acme.com',
        'Agent KYC under review',
        expect.any(String)
      );
    });
  });

  describe('syncSep12Status', () => {
    it('returns existing record when SEP-12 is not configured', async () => {
      mockedGetAgentKyc.mockResolvedValue({ ...sampleRecord });
      const result = await service.syncSep12Status('agent-001');
      expect(result?.agent_id).toBe('agent-001');
    });

    it('syncs approved status from anchor', async () => {
      process.env.SEP12_KYC_SERVER = 'https://kyc.anchor.example.com';
      process.env.SEP12_AUTH_TOKEN = 'test-token';
      mockedGetAgentKyc
        .mockResolvedValueOnce({ ...sampleRecord, status: 'under_review', sep12_customer_id: 'cust-99' })
        .mockResolvedValue({ ...sampleRecord, status: 'approved', sep12_customer_id: 'cust-99' });
      vi.spyOn(axios, 'get').mockResolvedValue({ data: { status: 'ACCEPTED' } } as any);

      const result = await service.syncSep12Status('agent-001');
      expect(result?.status).toBe('approved');
    });
  });
});

// ---------------------------------------------------------------------------
// REST endpoint tests
// ---------------------------------------------------------------------------

describe('Agent KYC REST endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SEP12_KYC_SERVER;
    delete process.env.SEP12_AUTH_TOKEN;
  });

  describe('POST /api/agents/kyc', () => {
    it('returns 400 when agentId is missing', async () => {
      const res = await request(app).post('/api/agents/kyc').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/agentId/i);
    });

    it('submits KYC and returns 201', async () => {
      mockedUpsertAgentKyc.mockResolvedValue(undefined);
      const res = await request(app).post('/api/agents/kyc').send({
        agentId: 'agent-001',
        business_registration: { name: 'Acme Ltd' },
        operating_country: 'NG',
        contact_email: 'agent@acme.com',
      });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.kyc.agent_id).toBe('agent-001');
    });
  });

  describe('GET /api/agents/kyc/:agentId', () => {
    it('returns 404 when agent not found', async () => {
      mockedGetAgentKyc.mockResolvedValue(null);
      const res = await request(app).get('/api/agents/kyc/missing-agent');
      expect(res.status).toBe(404);
    });

    it('returns KYC record', async () => {
      mockedGetAgentKyc.mockResolvedValue(sampleRecord);
      const res = await request(app).get('/api/agents/kyc/agent-001');
      expect(res.status).toBe(200);
      expect(res.body.kyc.agent_id).toBe('agent-001');
    });
  });

  describe('POST /api/agents/kyc/:agentId/review', () => {
    it('returns 401 without admin header', async () => {
      const res = await request(app)
        .post('/api/agents/kyc/agent-001/review')
        .send({ status: 'approved' });
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(app)
        .post('/api/agents/kyc/agent-001/review')
        .set('x-admin', 'true')
        .send({ status: 'pending' });
      expect(res.status).toBe(400);
    });

    it('approves agent KYC', async () => {
      mockedGetAgentKyc.mockResolvedValue({ ...sampleRecord });
      const res = await request(app)
        .post('/api/agents/kyc/agent-001/review')
        .set('x-admin', 'true')
        .send({ status: 'approved' });
      expect(res.status).toBe(200);
      expect(res.body.kyc.status).toBe('approved');
    });

    it('rejects with reason', async () => {
      mockedGetAgentKyc.mockResolvedValue({ ...sampleRecord });
      const res = await request(app)
        .post('/api/agents/kyc/agent-001/review')
        .set('x-admin', 'true')
        .send({ status: 'rejected', rejection_reason: 'Fake documents' });
      expect(res.status).toBe(200);
      expect(res.body.kyc.status).toBe('rejected');
    });
  });

  describe('POST /api/agents/register (KYC gate)', () => {
    it('returns 403 when KYC is not approved', async () => {
      mockedGetAgentKyc.mockResolvedValue({ ...sampleRecord, status: 'submitted' });
      const res = await request(app)
        .post('/api/agents/register')
        .set('x-user-id', 'admin-user')
        .send({ agentId: 'agent-001' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/approved/i);
    });

    it('returns 403 when KYC record does not exist', async () => {
      mockedGetAgentKyc.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/agents/register')
        .set('x-user-id', 'admin-user')
        .send({ agentId: 'agent-001' });
      expect(res.status).toBe(403);
    });

    it('allows registration when KYC is approved', async () => {
      mockedGetAgentKyc.mockResolvedValue({ ...sampleRecord, status: 'approved' });
      const res = await request(app)
        .post('/api/agents/register')
        .set('x-user-id', 'admin-user')
        .send({ agentId: 'agent-001' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
