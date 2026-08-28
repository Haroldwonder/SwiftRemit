/**
 * SR-112 wiring test — POST /api/remittance must run transaction monitoring
 * and travel-rule assessment inline, without requiring a compliance officer
 * to separately call /api/aml/monitoring/evaluate or /api/aml/travel-rule.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const { mockPool, insertedAlerts, insertedTransfers } = vi.hoisted(() => {
  const insertedAlerts: any[] = [];
  const insertedTransfers: any[] = [];

  const mockPool = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      const s = sql.replace(/\s+/g, ' ').toUpperCase();

      if (s.includes('INSERT INTO TRANSACTIONS')) {
        return {
          rows: [{ transaction_id: params[0], anchor_id: params[1], amount_in: params[2] }],
          rowCount: 1,
        };
      }

      // Transaction-monitoring rule set: a single VELOCITY_COUNT rule with
      // max_count 0 so any transfer trips it deterministically.
      if (s.includes('FROM AML_MONITORING_RULES')) {
        return {
          rows: [
            {
              code: 'VELOCITY_COUNT',
              name: 'Velocity by count',
              severity: 'high',
              enabled: true,
              params: { lookback_hours: 24, max_count: 0 },
            },
          ],
          rowCount: 1,
        };
      }

      // No prior transfer history / known corridors / reporting threshold.
      if (s.includes('SENDER_ADDRESS = $1') && s.includes('FROM TRANSACTIONS')) {
        return { rows: [], rowCount: 0 };
      }
      if (s.includes('DISTINCT CORRIDOR')) {
        return { rows: [], rowCount: 0 };
      }
      if (s.includes('FROM COMPLIANCE_THRESHOLDS')) {
        return { rows: [], rowCount: 0 };
      }

      // Alert insert (raiseAlert) — used by both monitoring and travel rule.
      if (s.includes('INSERT INTO AML_ALERTS')) {
        const row = { id: insertedAlerts.length + 1, rule_code: params[0], dedupe_key: params[7] };
        insertedAlerts.push(row);
        return { rows: [row], rowCount: 1 };
      }

      // Travel rule: no configured threshold rows -> fail-safe "required".
      if (s.includes('FROM TRAVEL_RULE_THRESHOLDS')) {
        return { rows: [], rowCount: 0 };
      }
      if (s.includes('INSERT INTO TRAVEL_RULE_TRANSFERS')) {
        const row = { id: insertedTransfers.length + 1, transaction_id: params[0] };
        insertedTransfers.push(row);
        return { rows: [row], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }),
  };

  return { mockPool, insertedAlerts, insertedTransfers };
});

vi.mock('../database', () => ({
  getPool: () => mockPool,
  getAssetVerification: vi.fn(),
  saveAssetVerification: vi.fn(),
  reportSuspiciousAsset: vi.fn(),
  getVerifiedAssets: vi.fn(),
  saveFxRate: vi.fn(),
  getFxRate: vi.fn(),
  saveAnchorKycConfig: vi.fn(),
  getUserKycStatus: vi.fn(),
  saveUserKycStatus: vi.fn(),
  saveAssetReport: vi.fn(),
  getActiveWebhookSubscribers: vi.fn().mockResolvedValue([]),
  getPendingWebhookDeliveries: vi.fn().mockResolvedValue([]),
  saveContractEvent: vi.fn(),
  queryContractEvents: vi.fn().mockResolvedValue({ events: [], total: 0 }),
}));

vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn(),
  simulateSettlement: vi.fn(),
}));

vi.mock('../metrics', () => ({
  getMetricsService: () => ({ getMetrics: vi.fn().mockResolvedValue('') }),
}));

vi.mock('../fx-rate-cache', () => ({
  getFxRateCache: () => ({ getCurrentRate: vi.fn() }),
}));

vi.mock('../kyc-upsert-service', () => ({
  KycUpsertService: vi.fn().mockImplementation(() => ({
    getStatusForUser: vi.fn(),
  })),
}));

vi.mock('../transfer-guard', () => ({
  createTransferGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../sep24-service', () => ({
  Sep24Service: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    initiateFlow: vi.fn(),
    getTransactionStatus: vi.fn(),
  })),
  Sep24ConfigError: class Sep24ConfigError extends Error {},
  Sep24AnchorError: class Sep24AnchorError extends Error {},
}));

import app from '../api';

const AUTH_HEADER = { 'x-user-id': 'user-test-1' };

beforeEach(() => {
  insertedAlerts.length = 0;
  insertedTransfers.length = 0;
  mockPool.query.mockClear();
});

describe('POST /api/remittance — inline AML monitoring (SR-112)', () => {
  it('raises an aml_alerts row for a rule-tripping transfer with no manual /api/aml call', async () => {
    const res = await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send({
        sender: 'GSENDERADDRESS000000000000000000000000000000000000000000',
        agent: 'anchor-test',
        amount: '500.00',
      });

    expect(res.status).toBe(201);

    // VELOCITY_COUNT alert raised purely as a side effect of creating the
    // remittance — no call was made to /api/aml/monitoring/evaluate.
    expect(insertedAlerts.some((a) => a.rule_code === 'VELOCITY_COUNT')).toBe(true);
  });

  it('records a travel-rule transfer row for the same remittance', async () => {
    await request(app)
      .post('/api/remittance')
      .set(AUTH_HEADER)
      .send({
        sender: 'GSENDERADDRESS000000000000000000000000000000000000000000',
        agent: 'anchor-test',
        amount: '500.00',
      });

    expect(insertedTransfers.length).toBeGreaterThan(0);
  });
});
