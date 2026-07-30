/**
 * SR-112 — shared types for the AML/CTF control layer.
 *
 * Every module in this directory talks to Postgres through the narrow
 * `Queryable` interface rather than importing `pg.Pool` directly. A `pg.Pool`
 * satisfies it structurally, and unit tests can substitute a stub without a
 * live database.
 */

export interface QueryResultLike<R = any> {
  rows: R[];
  rowCount?: number | null;
}

export interface Queryable {
  query<R = any>(text: string, params?: unknown[]): Promise<QueryResultLike<R>>;
}

export type SubjectType = 'sender' | 'recipient' | 'agent';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export type AlertStatus =
  | 'open'
  | 'in_review'
  | 'closed_no_action'
  | 'escalated'
  | 'reported';

export type AlertDisposition =
  | 'false_positive'
  | 'true_positive'
  | 'duplicate'
  | 'insufficient_data';

export const ALERT_STATUSES: readonly AlertStatus[] = [
  'open',
  'in_review',
  'closed_no_action',
  'escalated',
  'reported',
];

export const ALERT_DISPOSITIONS: readonly AlertDisposition[] = [
  'false_positive',
  'true_positive',
  'duplicate',
  'insufficient_data',
];

/**
 * Allowed alert status transitions. An alert may only ever move forward into
 * one of the states listed for its current state; `reported` is terminal
 * because the SAR workflow owns anything past that point.
 */
export const ALERT_TRANSITIONS: Record<AlertStatus, readonly AlertStatus[]> = {
  open: ['in_review', 'closed_no_action', 'escalated'],
  in_review: ['closed_no_action', 'escalated'],
  escalated: ['reported', 'closed_no_action'],
  closed_no_action: [],
  reported: [],
};

export function isAlertTransitionAllowed(from: AlertStatus, to: AlertStatus): boolean {
  return ALERT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Dispositions that require a narrative before the alert can be closed. */
export const DISPOSITIONS_REQUIRING_NOTES: readonly AlertDisposition[] = [
  'true_positive',
  'insufficient_data',
];
