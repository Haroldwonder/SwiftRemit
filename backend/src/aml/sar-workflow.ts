/**
 * SR-112 — suspicious activity reporting (SAR) workflow.
 *
 * A SAR is drafted from one or more escalated alerts, reviewed, filed with the
 * relevant FIU, and then held for the statutory retention period. Every status
 * change is appended to `sar_report_events`, which is the record an examiner
 * will ask for.
 *
 * Filing itself is a jurisdiction-specific out-of-band process (FinCEN BSA
 * E-Filing, goAML, etc.). This module owns the internal lifecycle and the
 * record; `markFiled` records the external acknowledgement reference.
 */

import { Queryable } from './types';

export type SarStatus = 'draft' | 'under_review' | 'filed' | 'acknowledged' | 'withdrawn';

export const SAR_TRANSITIONS: Record<SarStatus, readonly SarStatus[]> = {
  draft: ['under_review', 'withdrawn'],
  under_review: ['filed', 'draft', 'withdrawn'],
  filed: ['acknowledged'],
  acknowledged: [],
  withdrawn: [],
};

export function isSarTransitionAllowed(from: SarStatus, to: SarStatus): boolean {
  return SAR_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Minimum narrative length. FIUs reject reports without a usable narrative. */
export const MIN_NARRATIVE_LENGTH = 120;

export class SarWorkflowError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'invalid_transition'
      | 'narrative_too_short'
      | 'no_alerts'
      | 'alert_not_escalated'
      | 'missing_reference',
  ) {
    super(message);
    this.name = 'SarWorkflowError';
  }
}

export interface SarRow {
  id: number;
  reference: string;
  jurisdiction: string;
  subject_type: string;
  subject_id: string;
  alert_ids: number[];
  transaction_ids: string[];
  narrative: string;
  total_amount: string | null;
  currency: string | null;
  status: SarStatus;
  prepared_by: string;
  reviewed_by: string | null;
  filed_by: string | null;
  external_reference: string | null;
  filed_at: Date | null;
  acknowledged_at: Date | null;
  retention_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSarInput {
  jurisdiction: string;
  subjectType?: 'sender' | 'recipient' | 'agent';
  subjectId: string;
  alertIds: number[];
  narrative: string;
  preparedBy: string;
  currency?: string;
}

/** `SAR-2026-0007` — sequential within the calendar year of preparation. */
export function formatSarReference(year: number, sequence: number): string {
  return `SAR-${year}-${String(sequence).padStart(4, '0')}`;
}

export class SarWorkflowService {
  constructor(
    private readonly db: Queryable,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Atomically claim the next sequence number for the current year.
   *
   * Previously this counted existing rows (`SELECT COUNT(*) ... WHERE
   * reference LIKE ...`) with no locking, so two concurrent callers could
   * read the same count before either INSERT into sar_reports committed and
   * collide on the UNIQUE reference constraint. The upsert below is a single
   * statement — Postgres takes a row lock on the year's counter row for its
   * duration, so concurrent callers are serialized and each gets a distinct,
   * monotonically increasing sequence number.
   */
  private async nextReference(): Promise<string> {
    const year = this.now().getUTCFullYear();
    const { rows } = await this.db.query<{ last_sequence: number }>(
      `INSERT INTO sar_reference_counters (year, last_sequence, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (year) DO UPDATE
         SET last_sequence = sar_reference_counters.last_sequence + 1,
             updated_at    = NOW()
       RETURNING last_sequence`,
      [year],
    );
    return formatSarReference(year, Number(rows[0].last_sequence));
  }

  /**
   * Draft a SAR from escalated alerts. Refuses to build a report from alerts
   * that have not been escalated by a reviewer — that gate is the difference
   * between a considered filing and an automated one.
   */
  async createFromAlerts(input: CreateSarInput): Promise<SarRow> {
    if (!input.alertIds.length) {
      throw new SarWorkflowError('At least one alert id is required', 'no_alerts');
    }
    if (input.narrative.trim().length < MIN_NARRATIVE_LENGTH) {
      throw new SarWorkflowError(
        `Narrative must be at least ${MIN_NARRATIVE_LENGTH} characters`,
        'narrative_too_short',
      );
    }

    const { rows: alerts } = await this.db.query<{
      id: number;
      status: string;
      transaction_id: string | null;
      details: Record<string, unknown> | string;
    }>(
      `SELECT id, status, transaction_id, details
         FROM aml_alerts WHERE id = ANY($1::int[])`,
      [input.alertIds],
    );

    if (alerts.length !== input.alertIds.length) {
      throw new SarWorkflowError('One or more alert ids do not exist', 'not_found');
    }
    const notEscalated = alerts.filter((a) => a.status !== 'escalated');
    if (notEscalated.length) {
      throw new SarWorkflowError(
        `Alerts must be escalated before a SAR can be drafted: ${notEscalated.map((a) => a.id).join(', ')}`,
        'alert_not_escalated',
      );
    }

    const transactionIds = [
      ...new Set(alerts.map((a) => a.transaction_id).filter((t): t is string => !!t)),
    ];

    const totals = transactionIds.length
      ? await this.db.query<{ total: string | null }>(
          `SELECT COALESCE(SUM(amount_in), 0)::text AS total
             FROM transactions WHERE transaction_id = ANY($1::text[])`,
          [transactionIds],
        )
      : { rows: [{ total: null }] };

    const reference = await this.nextReference();

    const { rows } = await this.db.query<SarRow>(
      `INSERT INTO sar_reports
         (reference, jurisdiction, subject_type, subject_id, alert_ids,
          transaction_ids, narrative, total_amount, currency, prepared_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
       RETURNING *`,
      [
        reference,
        input.jurisdiction.toUpperCase(),
        input.subjectType ?? 'sender',
        input.subjectId,
        JSON.stringify(input.alertIds),
        JSON.stringify(transactionIds),
        input.narrative.trim(),
        totals.rows[0]?.total ?? null,
        input.currency?.toUpperCase() ?? null,
        input.preparedBy,
      ],
    );

    const sar = rows[0];
    await this.appendEvent(sar.id, null, 'draft', input.preparedBy, 'SAR drafted from escalated alerts');
    return sar;
  }

  async get(id: number): Promise<SarRow | null> {
    const { rows } = await this.db.query<SarRow>(`SELECT * FROM sar_reports WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async list(status?: SarStatus, limit = 100): Promise<SarRow[]> {
    const bounded = Math.min(Math.max(limit, 1), 500);
    const { rows } = status
      ? await this.db.query<SarRow>(
          `SELECT * FROM sar_reports WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
          [status, bounded],
        )
      : await this.db.query<SarRow>(
          `SELECT * FROM sar_reports ORDER BY created_at DESC LIMIT $1`,
          [bounded],
        );
    return rows;
  }

  private async appendEvent(
    sarId: number,
    from: SarStatus | null,
    to: SarStatus,
    actor: string,
    notes?: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO sar_report_events (sar_id, from_status, to_status, actor, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [sarId, from, to, actor, notes ?? null],
    );
  }

  /** Retention period for filed SARs, taken from the retention schedule. */
  private async retentionUntil(filedAt: Date): Promise<Date> {
    const { rows } = await this.db.query<{ retention_days: number }>(
      `SELECT retention_days FROM data_retention_policies WHERE entity = 'sar_reports'`,
    );
    const days = Number(rows[0]?.retention_days ?? 1826);
    return new Date(filedAt.getTime() + days * 86_400_000);
  }

  async transition(
    id: number,
    to: SarStatus,
    actor: string,
    opts: { notes?: string; externalReference?: string } = {},
  ): Promise<SarRow> {
    const current = await this.get(id);
    if (!current) throw new SarWorkflowError(`SAR ${id} not found`, 'not_found');

    if (!isSarTransitionAllowed(current.status, to)) {
      throw new SarWorkflowError(
        `Cannot move SAR ${current.reference} from ${current.status} to ${to}`,
        'invalid_transition',
      );
    }

    if (to === 'acknowledged' && !opts.externalReference && !current.external_reference) {
      throw new SarWorkflowError(
        'An FIU acknowledgement reference is required to acknowledge a SAR',
        'missing_reference',
      );
    }

    const now = this.now();
    const filing = to === 'filed';
    const retention = filing ? await this.retentionUntil(now) : null;

    const { rows } = await this.db.query<SarRow>(
      `UPDATE sar_reports
          SET status             = $1,
              reviewed_by        = CASE WHEN $1 = 'under_review' THEN $2 ELSE reviewed_by END,
              filed_by           = CASE WHEN $1 = 'filed' THEN $2 ELSE filed_by END,
              filed_at           = COALESCE($3, filed_at),
              acknowledged_at    = CASE WHEN $1 = 'acknowledged' THEN $4 ELSE acknowledged_at END,
              retention_until    = COALESCE($5, retention_until),
              external_reference = COALESCE($6, external_reference),
              updated_at         = NOW()
        WHERE id = $7
        RETURNING *`,
      [
        to,
        actor,
        filing ? now : null,
        now,
        retention,
        opts.externalReference ?? null,
        id,
      ],
    );

    await this.appendEvent(id, current.status, to, actor, opts.notes);

    // Filing a SAR marks its source alerts as reported.
    if (filing && current.alert_ids?.length) {
      await this.db.query(
        `UPDATE aml_alerts
            SET status = 'reported', updated_at = NOW(),
                closed_at = COALESCE(closed_at, NOW())
          WHERE id = ANY($1::int[]) AND status = 'escalated'`,
        [current.alert_ids],
      );
    }

    return rows[0];
  }

  async events(sarId: number): Promise<Array<{
    from_status: string | null;
    to_status: string;
    actor: string;
    notes: string | null;
    created_at: Date;
  }>> {
    const { rows } = await this.db.query(
      `SELECT from_status, to_status, actor, notes, created_at
         FROM sar_report_events WHERE sar_id = $1 ORDER BY created_at, id`,
      [sarId],
    );
    return rows;
  }
}
