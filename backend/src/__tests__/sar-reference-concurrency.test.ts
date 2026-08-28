/**
 * SR-112 — SAR reference numbering concurrency.
 *
 * SarWorkflowService.nextReference() used to derive the sequence number
 * from `SELECT COUNT(*) ... WHERE reference LIKE 'SAR-<year>-%'` with no
 * locking, so two concurrent createFromAlerts() calls could read the same
 * count and collide on the UNIQUE reference constraint. It now claims the
 * sequence via a single atomic upsert against sar_reference_counters.
 *
 * This fake DB models the row-level atomicity Postgres actually provides
 * for `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`: the counter is
 * incremented synchronously (no await between read and write), exactly as a
 * single SQL statement would be serialized by the real database.
 */

import { describe, it, expect } from 'vitest';
import { SarWorkflowService } from '../aml/sar-workflow';

class ConcurrencySafeFakeDb {
  private counters = new Map<number, number>();
  private sarRows: any[] = [];
  private nextId = 1;

  async query<R = any>(text: string, params: unknown[] = []): Promise<{ rows: R[]; rowCount: number }> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SELECT id, status, transaction_id, details')) {
      const ids = params[0] as number[];
      return {
        rows: ids.map((id) => ({
          id,
          status: 'escalated',
          transaction_id: `tx-${id}`,
          details: {},
        })) as R[],
        rowCount: ids.length,
      };
    }

    if (sql.startsWith('SELECT COALESCE(SUM')) {
      return { rows: [{ total: '1000' }] as R[], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sar_reference_counters')) {
      const year = params[0] as number;
      const current = this.counters.get(year) ?? 0;
      const next = current + 1;
      this.counters.set(year, next);
      return { rows: [{ last_sequence: next }] as R[], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sar_reports')) {
      const row = {
        id: this.nextId++,
        reference: params[0],
        jurisdiction: params[1],
        subject_type: params[2],
        subject_id: params[3],
        alert_ids: params[4],
        transaction_ids: params[5],
        narrative: params[6],
        total_amount: params[7],
        currency: params[8],
        status: 'draft',
        prepared_by: params[9],
      };
      this.sarRows.push(row);
      return { rows: [row] as R[], rowCount: 1 };
    }

    if (sql.startsWith('INSERT INTO sar_report_events')) {
      return { rows: [] as R[], rowCount: 1 };
    }

    return { rows: [] as R[], rowCount: 0 };
  }
}

const NARRATIVE = 'x'.repeat(150);

describe('SarWorkflowService.nextReference concurrency', () => {
  it('assigns distinct references to two concurrent createFromAlerts() calls', async () => {
    const db = new ConcurrencySafeFakeDb();
    const service = new SarWorkflowService(db, () => new Date('2026-06-01T00:00:00Z'));

    const [first, second] = await Promise.all([
      service.createFromAlerts({
        jurisdiction: 'US',
        subjectId: 'GSENDER-A',
        alertIds: [1],
        narrative: NARRATIVE,
        preparedBy: 'officer-a',
      }),
      service.createFromAlerts({
        jurisdiction: 'US',
        subjectId: 'GSENDER-B',
        alertIds: [2],
        narrative: NARRATIVE,
        preparedBy: 'officer-b',
      }),
    ]);

    expect(first.reference).not.toBe(second.reference);
    expect(new Set([first.reference, second.reference]).size).toBe(2);
  });

  it('continues the same year sequence across many sequential SARs with no duplicates', async () => {
    const db = new ConcurrencySafeFakeDb();
    const service = new SarWorkflowService(db, () => new Date('2026-06-01T00:00:00Z'));

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.createFromAlerts({
          jurisdiction: 'US',
          subjectId: `GSENDER-${i}`,
          alertIds: [i],
          narrative: NARRATIVE,
          preparedBy: 'officer-a',
        }),
      ),
    );

    const references = results.map((r) => r.reference);
    expect(new Set(references).size).toBe(references.length);
  });
});
