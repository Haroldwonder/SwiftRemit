/**
 * SR-112 — data-retention enforcement.
 *
 * The retention schedule lives in `data_retention_policies` (entity →
 * retention_days + legal basis + action). This module turns that schedule into
 * scheduled deletes/anonymisations and records every run in
 * `data_retention_runs` so retention can be evidenced rather than asserted.
 *
 * Entities are explicitly enumerated here rather than derived from the policy
 * table: the cutoff column and the anonymisation semantics differ per entity,
 * and a data-destroying job must never take its table name from a database row.
 */

import { Queryable } from './types';

export type RetentionAction = 'delete' | 'anonymize';

export interface RetentionPolicy {
  entity: string;
  retentionDays: number;
  legalBasis: string;
  action: RetentionAction;
  enabled: boolean;
  lastEnforcedAt: Date | null;
}

export interface RetentionRunResult {
  entity: string;
  action: RetentionAction;
  cutoff: Date;
  rowsAffected: number;
  succeeded: boolean;
  error?: string;
  skippedReason?: string;
}

/**
 * Per-entity enforcement plan. `cutoffColumn` is the timestamp the retention
 * clock runs from; `guard` is an extra predicate that protects records which
 * must not be purged yet (an unfiled SAR, an open alert).
 */
interface EntityPlan {
  table: string;
  cutoffColumn: string;
  guard?: string;
  /** SET clause used when the policy action is `anonymize`. */
  anonymizeSet?: string;
}

export const ENTITY_PLANS: Record<string, EntityPlan> = {
  sanctions_screening_results: {
    table: 'sanctions_screening_results',
    cutoffColumn: 'screened_at',
    // Keep any run still attached to a live alert.
    guard: `id NOT IN (SELECT screening_id FROM aml_alerts WHERE screening_id IS NOT NULL)`,
  },
  aml_alerts: {
    table: 'aml_alerts',
    cutoffColumn: 'COALESCE(closed_at, created_at)',
    // Never purge an alert that is still open or that fed a SAR.
    guard: `status IN ('closed_no_action', 'reported')
            AND id NOT IN (
              SELECT (jsonb_array_elements_text(alert_ids))::int
                FROM sar_reports
               WHERE status IN ('draft', 'under_review', 'filed')
            )`,
  },
  sar_reports: {
    table: 'sar_reports',
    cutoffColumn: 'COALESCE(retention_until, filed_at, created_at)',
    // retention_until already encodes the full period; only purge once it has
    // passed and the report reached a terminal state.
    guard: `status IN ('acknowledged', 'withdrawn')
            AND (retention_until IS NULL OR retention_until <= NOW())`,
  },
  travel_rule_transfers: {
    table: 'travel_rule_transfers',
    cutoffColumn: 'created_at',
    guard: `transmission_status IN ('transmitted', 'not_required', 'rejected')`,
  },
  compliance_report_audit: {
    table: 'compliance_report_audit',
    cutoffColumn: 'accessed_at',
  },
  user_kyc_status: {
    table: 'user_kyc_status',
    cutoffColumn: 'updated_at',
    guard: `status <> 'approved'`,
    anonymizeSet: `verification_data = NULL,
                   rejection_reason = NULL,
                   user_id = 'REDACTED:' || md5(user_id)`,
  },
};

export class RetentionService {
  constructor(
    private readonly db: Queryable,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async loadPolicies(): Promise<RetentionPolicy[]> {
    const { rows } = await this.db.query<{
      entity: string;
      retention_days: number;
      legal_basis: string;
      action: RetentionAction;
      enabled: boolean;
      last_enforced_at: Date | null;
    }>(
      `SELECT entity, retention_days, legal_basis, action, enabled, last_enforced_at
         FROM data_retention_policies ORDER BY entity`,
    );

    return rows.map((r) => ({
      entity: r.entity,
      retentionDays: Number(r.retention_days),
      legalBasis: r.legal_basis,
      action: r.action,
      enabled: r.enabled,
      lastEnforcedAt: r.last_enforced_at,
    }));
  }

  /** Cutoff timestamp for a policy: anything older than this is out of period. */
  cutoffFor(policy: RetentionPolicy, reference: Date = this.now()): Date {
    return new Date(reference.getTime() - policy.retentionDays * 86_400_000);
  }

  private buildStatement(policy: RetentionPolicy, plan: EntityPlan): string {
    const where = `WHERE ${plan.cutoffColumn} < $1${plan.guard ? ` AND (${plan.guard})` : ''}`;

    if (policy.action === 'anonymize') {
      if (!plan.anonymizeSet) {
        throw new Error(`Entity ${policy.entity} has no anonymisation rule defined`);
      }
      return `UPDATE ${plan.table} SET ${plan.anonymizeSet} ${where}`;
    }
    return `DELETE FROM ${plan.table} ${where}`;
  }

  /** Enforce one policy. Never throws — failures are recorded and returned. */
  async enforcePolicy(policy: RetentionPolicy): Promise<RetentionRunResult> {
    const cutoff = this.cutoffFor(policy);

    if (!policy.enabled) {
      return {
        entity: policy.entity,
        action: policy.action,
        cutoff,
        rowsAffected: 0,
        succeeded: true,
        skippedReason: 'policy_disabled',
      };
    }

    const plan = ENTITY_PLANS[policy.entity];
    if (!plan) {
      const result: RetentionRunResult = {
        entity: policy.entity,
        action: policy.action,
        cutoff,
        rowsAffected: 0,
        succeeded: false,
        error: `No enforcement plan for entity '${policy.entity}'`,
      };
      await this.recordRun(result);
      return result;
    }

    try {
      const statement = this.buildStatement(policy, plan);
      const res = await this.db.query(statement, [cutoff]);
      const result: RetentionRunResult = {
        entity: policy.entity,
        action: policy.action,
        cutoff,
        rowsAffected: res.rowCount ?? 0,
        succeeded: true,
      };
      await this.recordRun(result);
      await this.db.query(
        `UPDATE data_retention_policies SET last_enforced_at = NOW(), updated_at = NOW()
          WHERE entity = $1`,
        [policy.entity],
      );
      return result;
    } catch (err) {
      const result: RetentionRunResult = {
        entity: policy.entity,
        action: policy.action,
        cutoff,
        rowsAffected: 0,
        succeeded: false,
        error: err instanceof Error ? err.message : String(err),
      };
      await this.recordRun(result).catch(() => undefined);
      return result;
    }
  }

  private async recordRun(result: RetentionRunResult): Promise<void> {
    await this.db.query(
      `INSERT INTO data_retention_runs (entity, rows_affected, action, cutoff, succeeded, error_msg)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        result.entity,
        result.rowsAffected,
        result.action,
        result.cutoff,
        result.succeeded,
        result.error ?? null,
      ],
    );
  }

  /** Enforce the whole schedule. Used by the nightly scheduler job. */
  async enforceAll(): Promise<RetentionRunResult[]> {
    const policies = await this.loadPolicies();
    const results: RetentionRunResult[] = [];
    for (const policy of policies) {
      results.push(await this.enforcePolicy(policy));
    }
    return results;
  }

  /** Schedule + last-run status, for the compliance dashboard. */
  async status(): Promise<Array<RetentionPolicy & { lastRun: RetentionRunResult | null }>> {
    const policies = await this.loadPolicies();
    const { rows } = await this.db.query<{
      entity: string;
      rows_affected: number;
      action: RetentionAction;
      cutoff: Date;
      succeeded: boolean;
      error_msg: string | null;
      ran_at: Date;
    }>(
      `SELECT DISTINCT ON (entity) entity, rows_affected, action, cutoff, succeeded, error_msg, ran_at
         FROM data_retention_runs ORDER BY entity, ran_at DESC`,
    );

    const byEntity = new Map(rows.map((r) => [r.entity, r]));
    return policies.map((p) => {
      const run = byEntity.get(p.entity);
      return {
        ...p,
        lastRun: run
          ? {
              entity: run.entity,
              action: run.action,
              cutoff: run.cutoff,
              rowsAffected: Number(run.rows_affected),
              succeeded: run.succeeded,
              error: run.error_msg ?? undefined,
            }
          : null,
      };
    });
  }
}
