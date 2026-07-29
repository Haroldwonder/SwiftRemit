import { describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
import { KycUpsertService } from '../kyc-upsert-service';
import { KycRecord } from '../types';

function makeRecord(overrides: Partial<KycRecord> = {}): KycRecord {
  return {
    user_id: 'GABCUSER',
    anchor_id: 'anchor-1',
    kyc_status: 'approved',
    verified_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('KycUpsertService idempotency', () => {
  it('is a no-op on the second write of the same status (same verified_at)', async () => {
    // Real ON CONFLICT ... WHERE user_kyc_status.verified_at < EXCLUDED.verified_at:
    // simulate rowCount 0 when the incoming verified_at is not newer than what's stored.
    let stored: Date | null = null;
    const pool = {
      query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
        const incomingVerifiedAt = params[5] as Date;
        if (stored && incomingVerifiedAt <= stored) {
          return Promise.resolve({ rowCount: 0, rows: [] });
        }
        stored = incomingVerifiedAt;
        return Promise.resolve({ rowCount: 1, rows: [] });
      }),
    } as unknown as Pool;

    const onChainSync = vi.fn().mockResolvedValue({ success: true });
    const service = new KycUpsertService(pool, onChainSync);
    const record = makeRecord();

    await service.upsert(record);
    await service.upsert(record); // duplicate — must not double-write or double-notify

    expect(onChainSync).toHaveBeenCalledOnce();
  });

  it('applies a genuinely newer status transition', async () => {
    let stored: Date | null = null;
    const pool = {
      query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
        const incomingVerifiedAt = params[5] as Date;
        if (stored && incomingVerifiedAt <= stored) {
          return Promise.resolve({ rowCount: 0, rows: [] });
        }
        stored = incomingVerifiedAt;
        return Promise.resolve({ rowCount: 1, rows: [] });
      }),
    } as unknown as Pool;

    const onChainSync = vi.fn().mockResolvedValue({ success: true });
    const service = new KycUpsertService(pool, onChainSync);

    await service.upsert(makeRecord({ verified_at: new Date('2026-01-01T00:00:00Z') }));
    await service.upsert(makeRecord({ verified_at: new Date('2026-01-02T00:00:00Z') }));

    expect(onChainSync).toHaveBeenCalledTimes(2);
  });
});
