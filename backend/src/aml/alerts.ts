/**
 * SR-112 — AML alert queue.
 *
 * Every monitoring-rule hit and every screening hit becomes a row in
 * `aml_alerts`. Alerts are deduplicated on `dedupe_key` so a rule that keeps
 * firing over the same window does not bury the review queue, and every state
 * change requires an explicit disposition from a named officer.
 */

import {
  AlertDisposition,
  AlertSeverity,
  AlertStatus,
  DISPOSITIONS_REQUIRING_NOTES,
  Queryable,
  SubjectType,
  isAlertTransitionAllowed,
} from './types';

export interface RaiseAlertInput {
  ruleCode: string;
  severity: AlertSeverity;
  subjectType: SubjectType;
  subjectId: string;
  dedupeKey: string;
  transactionId?: string | null;
  screeningId?: number | null;
  details?: Record<string, unknown>;
}

export interface AlertRow {
  id: number;
  rule_code: string;
  severity: AlertSeverity;
  subject_type: SubjectType;
  subject_id: string;
  transaction_id: string | null;
  screening_id: number | null;
  details: Record<string, unknown>;
  dedupe_key: string;
  status: AlertStatus;
  assigned_to: string | null;
  disposition: AlertDisposition | null;
  disposition_notes: string | null;
  disposed_by: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

/**
 * Insert an alert, or return the id of the existing one when the dedupe key has
 * already been seen. Returns null only if the insert produced no row and no
 * existing row could be located.
 */
export async function raiseAlert(
  db: Queryable,
  input: RaiseAlertInput,
): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO aml_alerts
       (rule_code, severity, subject_type, subject_id, transaction_id,
        screening_id, details, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      input.ruleCode,
      input.severity,
      input.subjectType,
      input.subjectId,
      input.transactionId ?? null,
      input.screeningId ?? null,
      JSON.stringify(input.details ?? {}),
      input.dedupeKey,
    ],
  );

  if (rows[0]?.id != null) return rows[0].id;

  const existing = await db.query<{ id: number }>(
    `SELECT id FROM aml_alerts WHERE dedupe_key = $1`,
    [input.dedupeKey],
  );
  return existing.rows[0]?.id ?? null;
}

export interface AlertQuery {
  status?: AlertStatus;
  severity?: AlertSeverity;
  ruleCode?: string;
  subjectId?: string;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

export const ALERT_QUERY_MAX_LIMIT = 500;

/** Build the WHERE clause and parameter list for an alert query. */
export function buildAlertQuery(query: AlertQuery): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (query.status) { params.push(query.status); conditions.push(`status = $${params.length}`); }
  if (query.severity) { params.push(query.severity); conditions.push(`severity = $${params.length}`); }
  if (query.ruleCode) { params.push(query.ruleCode); conditions.push(`rule_code = $${params.length}`); }
  if (query.subjectId) { params.push(query.subjectId); conditions.push(`subject_id = $${params.length}`); }
  if (query.assignedTo) { params.push(query.assignedTo); conditions.push(`assigned_to = $${params.length}`); }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export async function listAlerts(db: Queryable, query: AlertQuery = {}): Promise<AlertRow[]> {
  const { where, params } = buildAlertQuery(query);
  const limit = Math.min(Math.max(query.limit ?? 100, 1), ALERT_QUERY_MAX_LIMIT);
  const offset = Math.max(query.offset ?? 0, 0);

  params.push(limit, offset);
  const { rows } = await db.query<AlertRow>(
    `SELECT * FROM aml_alerts
     ${where}
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function getAlert(db: Queryable, id: number): Promise<AlertRow | null> {
  const { rows } = await db.query<AlertRow>(`SELECT * FROM aml_alerts WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export class AlertDispositionError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'invalid_transition' | 'notes_required') {
    super(message);
    this.name = 'AlertDispositionError';
  }
}

export interface DisposeAlertInput {
  status: AlertStatus;
  actor: string;
  disposition?: AlertDisposition;
  notes?: string;
  assignedTo?: string;
}

/**
 * Move an alert to a new status. Enforces the transition table and the rule
 * that a true-positive or insufficient-data close must carry a narrative — an
 * examiner will ask why every alert was closed.
 */
export async function disposeAlert(
  db: Queryable,
  id: number,
  input: DisposeAlertInput,
): Promise<AlertRow> {
  const current = await getAlert(db, id);
  if (!current) {
    throw new AlertDispositionError(`Alert ${id} not found`, 'not_found');
  }

  if (!isAlertTransitionAllowed(current.status, input.status)) {
    throw new AlertDispositionError(
      `Cannot move alert ${id} from ${current.status} to ${input.status}`,
      'invalid_transition',
    );
  }

  const closing = input.status === 'closed_no_action' || input.status === 'escalated';
  if (
    closing &&
    input.disposition &&
    DISPOSITIONS_REQUIRING_NOTES.includes(input.disposition) &&
    !input.notes?.trim()
  ) {
    throw new AlertDispositionError(
      `Disposition '${input.disposition}' requires disposition notes`,
      'notes_required',
    );
  }

  const terminal = input.status === 'closed_no_action' || input.status === 'reported';

  const { rows } = await db.query<AlertRow>(
    `UPDATE aml_alerts
        SET status            = $1,
            disposition       = COALESCE($2, disposition),
            disposition_notes = COALESCE($3, disposition_notes),
            disposed_by       = $4,
            assigned_to       = COALESCE($5, assigned_to),
            updated_at        = NOW(),
            closed_at         = CASE WHEN $6 THEN NOW() ELSE closed_at END
      WHERE id = $7
      RETURNING *`,
    [
      input.status,
      input.disposition ?? null,
      input.notes ?? null,
      input.actor,
      input.assignedTo ?? null,
      terminal,
      id,
    ],
  );

  return rows[0];
}

/** Queue health counters for the compliance dashboard and metrics endpoint. */
export async function alertQueueSummary(db: Queryable): Promise<{
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  oldestOpenAgeSeconds: number | null;
}> {
  const [statusRes, severityRes, oldestRes] = await Promise.all([
    db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM aml_alerts GROUP BY status`,
    ),
    db.query<{ severity: string; count: string }>(
      `SELECT severity, COUNT(*)::text AS count FROM aml_alerts
        WHERE status IN ('open', 'in_review', 'escalated') GROUP BY severity`,
    ),
    db.query<{ age_seconds: string | null }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::text AS age_seconds
         FROM aml_alerts WHERE status = 'open'`,
    ),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of statusRes.rows) byStatus[r.status] = Number(r.count);

  const bySeverity: Record<string, number> = {};
  for (const r of severityRes.rows) bySeverity[r.severity] = Number(r.count);

  const rawAge = oldestRes.rows[0]?.age_seconds;
  return {
    byStatus,
    bySeverity,
    oldestOpenAgeSeconds: rawAge == null ? null : Number(rawAge),
  };
}
