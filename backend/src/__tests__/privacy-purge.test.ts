import { describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
import { purgeExpiredPersonalData } from '../privacy/retention-service';

/**
 * SR-131 — regression test for the privacy purge endpoint.
 *
 * Before this fix, POST /api/v1/privacy/purge-expired called
 * purgeExpiredPersonalData() with no pool argument, so the function returned
 * an all-zero report unconditionally (see retention-service.ts's `if
 * (!dbPool) return report` early exit) while claiming success. This asserts
 * the reported counts match the rows a real pool says were affected.
 */
describe('purgeExpiredPersonalData — reported counts match affected rows', () => {
  it('returns zero counts when no pool is supplied (documents the pre-fix bug so it cannot silently return)', async () => {
    const report = await purgeExpiredPersonalData(undefined);
    expect(report.auditLogsAnonymized).toBe(0);
    expect(report.transientKycPurged).toBe(0);
    expect(report.revokedConsentsPurged).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it('reports the exact rowCount returned by each purge query when a live pool is supplied', async () => {
    const rowCounts: Record<string, number> = {
      'UPDATE admin_audit_log': 7,
      'DELETE FROM kyc_uploads': 3,
      'DELETE FROM user_consents': 5,
    };

    const query = vi.fn().mockImplementation((sql: string) => {
      const key = Object.keys(rowCounts).find((k) => sql.includes(k));
      return Promise.resolve({ rowCount: key ? rowCounts[key] : 0, rows: [] });
    });

    const pool = { query } as unknown as Pool;

    const report = await purgeExpiredPersonalData(pool);

    expect(report.auditLogsAnonymized).toBe(7);
    expect(report.transientKycPurged).toBe(3);
    expect(report.revokedConsentsPurged).toBe(5);
    expect(report.errors).toEqual([]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('records a per-category error without aborting the remaining purges', async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('UPDATE admin_audit_log')) {
        return Promise.reject(new Error('connection reset'));
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    const pool = { query } as unknown as Pool;

    const report = await purgeExpiredPersonalData(pool);

    expect(report.errors).toEqual(['Audit log purge error: connection reset']);
    expect(report.transientKycPurged).toBe(1);
    expect(report.revokedConsentsPurged).toBe(1);
  });
});
