/**
 * SR-112 — transaction monitoring.
 *
 * Rules are evaluated against a sender's recent transfer history whenever a new
 * transfer is created, and can also be replayed in batch. Every rule that fires
 * raises a deduplicated alert into the review queue (see alerts.ts).
 *
 * Rule definitions live in `aml_monitoring_rules` so thresholds can be tuned
 * without a deploy; the evaluation logic is pure and unit-tested.
 */

import { AlertSeverity, Queryable } from './types';
import { raiseAlert } from './alerts';

// ─── Rule inputs ────────────────────────────────────────────────────────────

export interface TransferRecord {
  transactionId: string;
  senderAddress: string;
  amount: number;
  currency: string;
  corridor: string | null;
  createdAt: Date;
}

export interface RuleDefinition {
  code: string;
  name: string;
  severity: AlertSeverity;
  enabled: boolean;
  params: Record<string, any>;
}

export interface RuleContext {
  /** The transfer under evaluation. */
  transfer: TransferRecord;
  /** Prior transfers by the same sender, newest first, within the widest lookback. */
  history: TransferRecord[];
  /** Corridors the sender has used before `transfer`, over the corridor lookback. */
  knownCorridors: Set<string>;
  /** Reporting threshold for the transfer's currency, if one is configured. */
  reportingThreshold: number | null;
}

export interface RuleHit {
  ruleCode: string;
  severity: AlertSeverity;
  /** Stable within the rule's window so repeated evaluation does not duplicate. */
  dedupeKey: string;
  details: Record<string, unknown>;
}

type RuleEvaluator = (ctx: RuleContext, rule: RuleDefinition) => RuleHit | null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function withinHours(records: TransferRecord[], reference: Date, hours: number): TransferRecord[] {
  const cutoff = reference.getTime() - hours * 3_600_000;
  return records.filter((r) => r.createdAt.getTime() >= cutoff);
}

/**
 * Bucket a timestamp into fixed windows so a rule firing repeatedly inside one
 * window produces one alert rather than one per transfer.
 */
export function windowBucket(at: Date, hours: number): string {
  const size = Math.max(hours, 1) * 3_600_000;
  return String(Math.floor(at.getTime() / size));
}

function num(params: Record<string, any>, key: string, fallback: number): number {
  const raw = params?.[key];
  const parsed = typeof raw === 'string' ? Number(raw) : raw;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
}

// ─── Rule implementations ───────────────────────────────────────────────────

/**
 * Structuring: several transfers that each sit just under the reporting
 * threshold but together clear it. Without a configured reporting threshold for
 * the currency there is nothing to structure around, so the rule abstains.
 */
export const structuringRule: RuleEvaluator = (ctx, rule) => {
  const threshold = ctx.reportingThreshold;
  if (threshold == null || threshold <= 0) return null;

  const lookbackHours = num(rule.params, 'lookback_hours', 168);
  const minCount = num(rule.params, 'min_count', 3);
  const thresholdRatio = num(rule.params, 'threshold_ratio', 0.9);
  const aggregateMultiplier = num(rule.params, 'aggregate_multiplier', 1.0);

  const window = [ctx.transfer, ...withinHours(ctx.history, ctx.transfer.createdAt, lookbackHours)];
  const subThreshold = window.filter(
    (t) => t.amount < threshold && t.amount >= threshold * thresholdRatio * 0.1,
  );
  if (subThreshold.length < minCount) return null;

  const total = subThreshold.reduce((sum, t) => sum + t.amount, 0);
  if (total < threshold * aggregateMultiplier) return null;

  // Every individual transfer must be below the threshold for this to look like
  // deliberate structuring rather than ordinary high-volume activity.
  if (subThreshold.some((t) => t.amount >= threshold)) return null;

  return {
    ruleCode: rule.code,
    severity: rule.severity,
    dedupeKey: `${rule.code}:${ctx.transfer.senderAddress}:${windowBucket(ctx.transfer.createdAt, lookbackHours)}`,
    details: {
      threshold,
      lookback_hours: lookbackHours,
      transfer_count: subThreshold.length,
      aggregate_amount: Number(total.toFixed(7)),
      currency: ctx.transfer.currency,
      transaction_ids: subThreshold.map((t) => t.transactionId),
    },
  };
};

/** Velocity by count: too many transfers in the window. */
export const velocityCountRule: RuleEvaluator = (ctx, rule) => {
  const lookbackHours = num(rule.params, 'lookback_hours', 24);
  const maxCount = num(rule.params, 'max_count', 10);

  const window = [ctx.transfer, ...withinHours(ctx.history, ctx.transfer.createdAt, lookbackHours)];
  if (window.length <= maxCount) return null;

  return {
    ruleCode: rule.code,
    severity: rule.severity,
    dedupeKey: `${rule.code}:${ctx.transfer.senderAddress}:${windowBucket(ctx.transfer.createdAt, lookbackHours)}`,
    details: {
      lookback_hours: lookbackHours,
      max_count: maxCount,
      observed_count: window.length,
      transaction_ids: window.map((t) => t.transactionId).slice(0, 50),
    },
  };
};

/** Velocity by value: too much aggregate value in the window. */
export const velocityAmountRule: RuleEvaluator = (ctx, rule) => {
  const lookbackHours = num(rule.params, 'lookback_hours', 24);
  const maxAmount = num(rule.params, 'max_amount', 10_000);

  const window = [ctx.transfer, ...withinHours(ctx.history, ctx.transfer.createdAt, lookbackHours)];
  const total = window.reduce((sum, t) => sum + t.amount, 0);
  if (total <= maxAmount) return null;

  return {
    ruleCode: rule.code,
    severity: rule.severity,
    dedupeKey: `${rule.code}:${ctx.transfer.senderAddress}:${windowBucket(ctx.transfer.createdAt, lookbackHours)}`,
    details: {
      lookback_hours: lookbackHours,
      max_amount: maxAmount,
      observed_amount: Number(total.toFixed(7)),
      currency: ctx.transfer.currency,
    },
  };
};

/**
 * Unusual corridor: either a corridor on the high-risk list, or one this sender
 * has never used inside the corridor lookback. A first-ever transfer is not
 * "unusual" — a sender with no history has no baseline to deviate from.
 */
export const unusualCorridorRule: RuleEvaluator = (ctx, rule) => {
  const corridor = ctx.transfer.corridor?.toUpperCase();
  if (!corridor) return null;

  const highRisk: string[] = Array.isArray(rule.params?.high_risk_corridors)
    ? rule.params.high_risk_corridors.map((c: unknown) => String(c).toUpperCase())
    : [];

  const isHighRisk = highRisk.includes(corridor);
  const isNew = ctx.knownCorridors.size > 0 && !ctx.knownCorridors.has(corridor);

  if (!isHighRisk && !isNew) return null;

  return {
    ruleCode: rule.code,
    severity: isHighRisk ? 'high' : rule.severity,
    dedupeKey: `${rule.code}:${ctx.transfer.senderAddress}:${corridor}`,
    details: {
      corridor,
      reason: isHighRisk ? 'high_risk_corridor' : 'first_use_by_sender',
      known_corridors: [...ctx.knownCorridors],
      transaction_id: ctx.transfer.transactionId,
    },
  };
};

/** Repeated identical round-figure transfers — a common layering signature. */
export const roundAmountRepetitionRule: RuleEvaluator = (ctx, rule) => {
  const lookbackHours = num(rule.params, 'lookback_hours', 72);
  const minCount = num(rule.params, 'min_count', 3);
  const roundTo = num(rule.params, 'round_to', 1000);
  if (roundTo <= 0) return null;

  const isRound = (amount: number) => amount >= roundTo && amount % roundTo === 0;
  if (!isRound(ctx.transfer.amount)) return null;

  const window = [ctx.transfer, ...withinHours(ctx.history, ctx.transfer.createdAt, lookbackHours)];
  const identical = window.filter((t) => isRound(t.amount) && t.amount === ctx.transfer.amount);
  if (identical.length < minCount) return null;

  return {
    ruleCode: rule.code,
    severity: rule.severity,
    dedupeKey: `${rule.code}:${ctx.transfer.senderAddress}:${ctx.transfer.amount}:${windowBucket(ctx.transfer.createdAt, lookbackHours)}`,
    details: {
      lookback_hours: lookbackHours,
      amount: ctx.transfer.amount,
      currency: ctx.transfer.currency,
      occurrences: identical.length,
      transaction_ids: identical.map((t) => t.transactionId),
    },
  };
};

export const RULE_EVALUATORS: Record<string, RuleEvaluator> = {
  STRUCTURING: structuringRule,
  VELOCITY_COUNT: velocityCountRule,
  VELOCITY_AMOUNT: velocityAmountRule,
  UNUSUAL_CORRIDOR: unusualCorridorRule,
  ROUND_AMOUNT_REPETITION: roundAmountRepetitionRule,
};

/**
 * Evaluate every enabled rule that has an implementation. A rule row with no
 * matching evaluator is skipped rather than treated as a pass — the caller can
 * detect that via `unimplemented`.
 */
export function evaluateRules(
  ctx: RuleContext,
  rules: RuleDefinition[],
): { hits: RuleHit[]; unimplemented: string[] } {
  const hits: RuleHit[] = [];
  const unimplemented: string[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const evaluator = RULE_EVALUATORS[rule.code];
    if (!evaluator) {
      unimplemented.push(rule.code);
      continue;
    }
    const hit = evaluator(ctx, rule);
    if (hit) hits.push(hit);
  }

  return { hits, unimplemented };
}

// ─── Service ────────────────────────────────────────────────────────────────

/** Widest lookback across all rules, so history is fetched once. */
export function widestLookbackHours(rules: RuleDefinition[]): number {
  let widest = 24;
  for (const rule of rules) {
    widest = Math.max(widest, num(rule.params, 'lookback_hours', 0));
    const days = num(rule.params, 'lookback_days', 0);
    widest = Math.max(widest, days * 24);
  }
  return widest;
}

export class TransactionMonitoringService {
  constructor(private readonly db: Queryable) {}

  async loadRules(): Promise<RuleDefinition[]> {
    const { rows } = await this.db.query<{
      code: string;
      name: string;
      severity: AlertSeverity;
      enabled: boolean;
      params: Record<string, any> | string;
    }>(
      `SELECT code, name, severity, enabled, params FROM aml_monitoring_rules ORDER BY code`,
    );
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      severity: r.severity,
      enabled: r.enabled,
      params: typeof r.params === 'string' ? safeParse(r.params) : (r.params ?? {}),
    }));
  }

  private async loadHistory(
    senderAddress: string,
    before: Date,
    lookbackHours: number,
    excludeTransactionId: string,
  ): Promise<TransferRecord[]> {
    const cutoff = new Date(before.getTime() - lookbackHours * 3_600_000);
    const { rows } = await this.db.query<{
      transaction_id: string;
      sender_address: string;
      amount_in: string | number | null;
      asset_code: string | null;
      created_at: Date;
    }>(
      `SELECT transaction_id, sender_address, amount_in, asset_code, created_at
         FROM transactions
        WHERE sender_address = $1
          AND created_at >= $2
          AND created_at <= $3
          AND transaction_id <> $4
        ORDER BY created_at DESC
        LIMIT 1000`,
      [senderAddress, cutoff, before, excludeTransactionId],
    );

    return rows.map((r) => ({
      transactionId: r.transaction_id,
      senderAddress: r.sender_address,
      amount: Number(r.amount_in ?? 0),
      currency: r.asset_code ?? 'USDC',
      corridor: null,
      createdAt: new Date(r.created_at),
    }));
  }

  private async loadKnownCorridors(
    senderAddress: string,
    before: Date,
    lookbackDays: number,
  ): Promise<Set<string>> {
    const cutoff = new Date(before.getTime() - lookbackDays * 86_400_000);
    const { rows } = await this.db.query<{ corridor: string | null }>(
      `SELECT DISTINCT corridor
         FROM compliance_flagged_remittances
        WHERE corridor IS NOT NULL
          AND flagged_at >= $1
          AND transaction_id IN (
            SELECT transaction_id FROM transactions WHERE sender_address = $2
          )`,
      [cutoff, senderAddress],
    ).catch(() => ({ rows: [] as { corridor: string | null }[] }));

    return new Set(
      rows.map((r) => r.corridor).filter((c): c is string => !!c).map((c) => c.toUpperCase()),
    );
  }

  private async loadReportingThreshold(currency: string): Promise<number | null> {
    const { rows } = await this.db.query<{ threshold: string | number }>(
      `SELECT threshold FROM compliance_thresholds
        WHERE currency = $1 AND active = TRUE
        ORDER BY threshold ASC LIMIT 1`,
      [currency.toUpperCase()],
    );
    const raw = rows[0]?.threshold;
    return raw == null ? null : Number(raw);
  }

  /**
   * Evaluate all rules for one transfer and persist the resulting alerts.
   */
  async evaluateTransfer(transfer: TransferRecord): Promise<{
    hits: RuleHit[];
    alertIds: number[];
    unimplemented: string[];
  }> {
    const rules = await this.loadRules();
    const lookbackHours = widestLookbackHours(rules);

    const corridorRule = rules.find((r) => r.code === 'UNUSUAL_CORRIDOR');
    const corridorLookbackDays = num(corridorRule?.params ?? {}, 'lookback_days', 180);

    const [history, knownCorridors, reportingThreshold] = await Promise.all([
      this.loadHistory(transfer.senderAddress, transfer.createdAt, lookbackHours, transfer.transactionId),
      this.loadKnownCorridors(transfer.senderAddress, transfer.createdAt, corridorLookbackDays),
      this.loadReportingThreshold(transfer.currency),
    ]);

    const { hits, unimplemented } = evaluateRules(
      { transfer, history, knownCorridors, reportingThreshold },
      rules,
    );

    const alertIds: number[] = [];
    for (const hit of hits) {
      const id = await raiseAlert(this.db, {
        ruleCode: hit.ruleCode,
        severity: hit.severity,
        subjectType: 'sender',
        subjectId: transfer.senderAddress,
        transactionId: transfer.transactionId,
        dedupeKey: hit.dedupeKey,
        details: hit.details,
      });
      if (id != null) alertIds.push(id);
    }

    return { hits, alertIds, unimplemented };
  }
}

function safeParse(raw: string): Record<string, any> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
