import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemittanceRepository } from '../repositories/RemittanceRepository';
import { KycRepository } from '../repositories/KycRepository';
import { FxRateRepository } from '../repositories/FxRateRepository';
import { WebhookRepository } from '../repositories/WebhookRepository';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) } as any;
}

// ── RemittanceRepository ──────────────────────────────────────────────────────

describe('RemittanceRepository', () => {
  it('findById returns null when no rows', async () => {
    const repo = new RemittanceRepository(mockPool([]));
    expect(await repo.findById('tx-1')).toBeNull();
  });

  it('findById returns first row', async () => {
    const row = { transaction_id: 'tx-1', status: 'pending' };
    const repo = new RemittanceRepository(mockPool([row]));
    expect(await repo.findById('tx-1')).toEqual(row);
  });

  it('findBySender passes correct params', async () => {
    const pool = mockPool([]);
    const repo = new RemittanceRepository(pool);
    await repo.findBySender('GABC', 10, 0);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('sender_address'), ['GABC', 10, 0]);
  });

  it('upsert calls pool.query', async () => {
    const pool = mockPool([]);
    const repo = new RemittanceRepository(pool);
    await repo.upsert({ transaction_id: 'tx-1' });
    expect(pool.query).toHaveBeenCalledOnce();
  });
});

// ── KycRepository ─────────────────────────────────────────────────────────────

describe('KycRepository', () => {
  it('getUserStatus returns null when no rows', async () => {
    const repo = new KycRepository(mockPool([]));
    expect(await repo.getUserStatus('user-1', 'anchor-1')).toBeNull();
  });

  it('getConfigs maps rows correctly', async () => {
    const row = {
      anchor_id: 'a1', kyc_server_url: 'https://kyc.example.com',
      auth_token: 'tok', polling_interval_minutes: 60, enabled: true,
    };
    const repo = new KycRepository(mockPool([row]));
    const configs = await repo.getConfigs();
    expect(configs[0].anchor_id).toBe('a1');
  });
});

// ── FxRateRepository ──────────────────────────────────────────────────────────

describe('FxRateRepository', () => {
  it('findById returns null when no rows', async () => {
    const repo = new FxRateRepository(mockPool([]));
    expect(await repo.findById('tx-1')).toBeNull();
  });

  it('save calls pool.query with correct args', async () => {
    const pool = mockPool([]);
    const repo = new FxRateRepository(pool);
    const rate = { transaction_id: 'tx-1', rate: 1.5, provider: 'test', timestamp: new Date(), from_currency: 'USD', to_currency: 'EUR' };
    await repo.save(rate);
    expect(pool.query).toHaveBeenCalledOnce();
  });
});

// ── WebhookRepository ─────────────────────────────────────────────────────────

describe('WebhookRepository', () => {
  it('getActiveSubscribers returns mapped rows', async () => {
    const row = { id: '1', url: 'https://hook.example.com', secret: null, active: true, created_at: new Date(), updated_at: new Date() };
    const repo = new WebhookRepository(mockPool([row]));
    const subs = await repo.getActiveSubscribers();
    expect(subs[0].url).toBe('https://hook.example.com');
  });

  it('getPending passes limit param', async () => {
    const pool = mockPool([]);
    const repo = new WebhookRepository(pool);
    await repo.getPending(25);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [25]);
  });
});
