/**
 * SR-112 — FATF Recommendation 16 (travel rule).
 *
 * For transfers at or above the applicable jurisdictional threshold we must
 * collect originator and beneficiary information and transmit it to the
 * counterparty VASP alongside the transfer.
 *
 * The threshold is per-jurisdiction (`travel_rule_thresholds`); the EU has no
 * de minimis for CASP transfers, so a threshold of 0 means "always required".
 * Transmission goes to the configured counterparty endpoint; failures are
 * retried by the scheduler rather than blocking the transfer, and the record
 * keeps the full attempt history.
 */

import crypto from 'crypto';
import { Queryable } from './types';
import { raiseAlert } from './alerts';

export type TransmissionStatus =
  | 'not_required'
  | 'pending'
  | 'transmitted'
  | 'failed'
  | 'rejected';

/** Originator ("payer") data set required by FATF R.16. */
export interface OriginatorData {
  name: string;
  accountIdentifier: string;
  /** One of address / national identity number / date+place of birth is required. */
  address?: string;
  nationalIdentifier?: string;
  dateOfBirth?: string;
  placeOfBirth?: string;
  country?: string;
}

/** Beneficiary ("payee") data set required by FATF R.16. */
export interface BeneficiaryData {
  name: string;
  accountIdentifier: string;
  country?: string;
}

export interface TravelRuleInput {
  transactionId: string;
  jurisdiction: string;
  amount: number;
  currency: string;
  /** USD-equivalent value, used for the threshold comparison. */
  amountUsd: number;
  originator?: OriginatorData;
  beneficiary?: BeneficiaryData;
  counterpartyVasp?: string;
}

export interface ThresholdDecision {
  required: boolean;
  threshold: number;
  jurisdiction: string;
  source: 'jurisdiction' | 'default';
}

export class TravelRuleError extends Error {
  constructor(message: string, readonly code: 'incomplete_data' | 'not_found', readonly missing: string[] = []) {
    super(message);
    this.name = 'TravelRuleError';
  }
}

/**
 * Validate the originator/beneficiary data sets. Returns the list of missing
 * required fields — empty means the record may be transmitted.
 */
export function validateDataSets(
  originator?: OriginatorData,
  beneficiary?: BeneficiaryData,
): string[] {
  const missing: string[] = [];

  if (!originator) {
    missing.push('originator');
  } else {
    if (!originator.name?.trim()) missing.push('originator.name');
    if (!originator.accountIdentifier?.trim()) missing.push('originator.accountIdentifier');
    // FATF R.16 requires one of: address, national identifier, or date+place of birth.
    const hasSecondaryIdentifier =
      !!originator.address?.trim() ||
      !!originator.nationalIdentifier?.trim() ||
      (!!originator.dateOfBirth?.trim() && !!originator.placeOfBirth?.trim());
    if (!hasSecondaryIdentifier) {
      missing.push('originator.address|nationalIdentifier|dateOfBirth+placeOfBirth');
    }
  }

  if (!beneficiary) {
    missing.push('beneficiary');
  } else {
    if (!beneficiary.name?.trim()) missing.push('beneficiary.name');
    if (!beneficiary.accountIdentifier?.trim()) missing.push('beneficiary.accountIdentifier');
  }

  return missing;
}

/** Deterministic hash of the transmitted payload, for non-repudiation. */
export function payloadHash(payload: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export type Transmitter = (payload: {
  transaction_id: string;
  originator: OriginatorData;
  beneficiary: BeneficiaryData;
  amount: number;
  currency: string;
  counterparty_vasp: string | null;
}) => Promise<{ ok: boolean; error?: string; rejected?: boolean }>;

export class TravelRuleService {
  constructor(
    private readonly db: Queryable,
    /**
     * Injected so the transport (IVMS101 over TRP/OpenVASP, or a bilateral
     * API) can be swapped without touching the lifecycle logic. Defaults to a
     * no-op that leaves the record pending for operator action.
     */
    private readonly transmit: Transmitter = async () => ({
      ok: false,
      error: 'No travel-rule transmitter configured',
    }),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Resolve the applicable threshold, falling back to the DEFAULT row. */
  async resolveThreshold(jurisdiction: string, amountUsd: number): Promise<ThresholdDecision> {
    const code = jurisdiction.toUpperCase();
    const { rows } = await this.db.query<{ jurisdiction: string; threshold_usd: string | number }>(
      `SELECT jurisdiction, threshold_usd FROM travel_rule_thresholds
        WHERE jurisdiction = ANY($1::text[]) AND active = TRUE`,
      [[code, 'DEFAULT']],
    );

    const exact = rows.find((r) => r.jurisdiction === code);
    const fallback = rows.find((r) => r.jurisdiction === 'DEFAULT');
    const chosen = exact ?? fallback;

    // With no configured threshold at all, fail safe: collect and transmit.
    if (!chosen) {
      return { required: true, threshold: 0, jurisdiction: code, source: 'default' };
    }

    const threshold = Number(chosen.threshold_usd);
    return {
      required: amountUsd >= threshold,
      threshold,
      jurisdiction: chosen.jurisdiction,
      source: exact ? 'jurisdiction' : 'default',
    };
  }

  /**
   * Record the travel-rule obligation for a transfer. When the threshold is not
   * met the record is still written with `not_required`, so we can evidence the
   * decision. When it is met, the data sets must be complete.
   */
  async record(input: TravelRuleInput): Promise<{
    id: number;
    required: boolean;
    threshold: number;
    transmissionStatus: TransmissionStatus;
  }> {
    const decision = await this.resolveThreshold(input.jurisdiction, input.amountUsd);

    if (decision.required) {
      const missing = validateDataSets(input.originator, input.beneficiary);
      if (missing.length) {
        throw new TravelRuleError(
          `Travel-rule data incomplete for ${input.transactionId}: ${missing.join(', ')}`,
          'incomplete_data',
          missing,
        );
      }
    }

    const status: TransmissionStatus = decision.required ? 'pending' : 'not_required';

    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO travel_rule_transfers
         (transaction_id, jurisdiction, amount, currency, threshold_applied,
          required, originator, beneficiary, counterparty_vasp, transmission_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       ON CONFLICT (transaction_id) DO UPDATE
         SET jurisdiction      = EXCLUDED.jurisdiction,
             amount            = EXCLUDED.amount,
             currency          = EXCLUDED.currency,
             threshold_applied = EXCLUDED.threshold_applied,
             required          = EXCLUDED.required,
             originator        = EXCLUDED.originator,
             beneficiary       = EXCLUDED.beneficiary,
             counterparty_vasp = EXCLUDED.counterparty_vasp,
             updated_at        = NOW()
       RETURNING id`,
      [
        input.transactionId,
        decision.jurisdiction,
        input.amount,
        input.currency.toUpperCase(),
        decision.threshold,
        decision.required,
        JSON.stringify(input.originator ?? {}),
        JSON.stringify(input.beneficiary ?? {}),
        input.counterpartyVasp ?? null,
        status,
      ],
    );

    return {
      id: rows[0].id,
      required: decision.required,
      threshold: decision.threshold,
      transmissionStatus: status,
    };
  }

  /**
   * Record the travel-rule determination at transfer-creation time, when the
   * originator/beneficiary data set may not be assembled yet.
   *
   * Unlike `record`, this never throws on incomplete data: the obligation is
   * real either way, so we persist it as `pending` and raise an alert so a
   * compliance officer chases the missing fields before payout.
   */
  async assess(input: TravelRuleInput): Promise<{
    id: number;
    required: boolean;
    threshold: number;
    missing: string[];
    transmissionStatus: TransmissionStatus;
  }> {
    const decision = await this.resolveThreshold(input.jurisdiction, input.amountUsd);
    const missing = decision.required
      ? validateDataSets(input.originator, input.beneficiary)
      : [];
    const status: TransmissionStatus = decision.required ? 'pending' : 'not_required';

    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO travel_rule_transfers
         (transaction_id, jurisdiction, amount, currency, threshold_applied,
          required, originator, beneficiary, counterparty_vasp,
          transmission_status, transmission_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
       ON CONFLICT (transaction_id) DO UPDATE
         SET jurisdiction      = EXCLUDED.jurisdiction,
             amount            = EXCLUDED.amount,
             currency          = EXCLUDED.currency,
             threshold_applied = EXCLUDED.threshold_applied,
             required          = EXCLUDED.required,
             updated_at        = NOW()
       RETURNING id`,
      [
        input.transactionId,
        decision.jurisdiction,
        input.amount,
        input.currency.toUpperCase(),
        decision.threshold,
        decision.required,
        JSON.stringify(input.originator ?? {}),
        JSON.stringify(input.beneficiary ?? {}),
        input.counterpartyVasp ?? null,
        status,
        missing.length ? `Incomplete data set: ${missing.join(', ')}` : null,
      ],
    );

    if (missing.length) {
      await raiseAlert(this.db, {
        ruleCode: 'TRAVEL_RULE_INCOMPLETE',
        severity: 'high',
        subjectType: 'sender',
        subjectId: input.originator?.accountIdentifier ?? input.transactionId,
        transactionId: input.transactionId,
        dedupeKey: `TRAVEL_RULE_INCOMPLETE:${input.transactionId}`,
        details: {
          jurisdiction: decision.jurisdiction,
          threshold_applied: decision.threshold,
          amount_usd: input.amountUsd,
          missing,
        },
      });
    }

    return {
      id: rows[0].id,
      required: decision.required,
      threshold: decision.threshold,
      missing,
      transmissionStatus: status,
    };
  }

  /**
   * Attempt transmission for one pending record.
   */
  async transmitOne(transactionId: string): Promise<{ status: TransmissionStatus; error?: string }> {
    const { rows } = await this.db.query<{
      transaction_id: string;
      originator: OriginatorData | string;
      beneficiary: BeneficiaryData | string;
      amount: string | number;
      currency: string;
      counterparty_vasp: string | null;
    }>(
      `SELECT transaction_id, originator, beneficiary, amount, currency, counterparty_vasp
         FROM travel_rule_transfers
        WHERE transaction_id = $1 AND transmission_status IN ('pending', 'failed')`,
      [transactionId],
    );

    const row = rows[0];
    if (!row) throw new TravelRuleError(`No pending travel-rule record for ${transactionId}`, 'not_found');

    const originator = asObject<OriginatorData>(row.originator);
    const beneficiary = asObject<BeneficiaryData>(row.beneficiary);

    const payload = {
      transaction_id: row.transaction_id,
      originator,
      beneficiary,
      amount: Number(row.amount),
      currency: row.currency,
      counterparty_vasp: row.counterparty_vasp,
    };

    const result = await this.transmit(payload);
    const status: TransmissionStatus = result.ok
      ? 'transmitted'
      : result.rejected
        ? 'rejected'
        : 'failed';

    await this.db.query(
      `UPDATE travel_rule_transfers
          SET transmission_status = $1,
              transmission_error  = $2,
              payload_hash        = $3,
              attempts            = attempts + 1,
              transmitted_at      = CASE WHEN $1 = 'transmitted' THEN $4 ELSE transmitted_at END,
              updated_at          = NOW()
        WHERE transaction_id = $5`,
      [status, result.error ?? null, payloadHash(payload), this.now(), transactionId],
    );

    return { status, error: result.error };
  }

  /** Retry every pending/failed transmission. Used by the scheduler. */
  async transmitPending(limit = 100): Promise<{ transmitted: number; failed: number }> {
    const { rows } = await this.db.query<{ transaction_id: string }>(
      `SELECT transaction_id FROM travel_rule_transfers
        WHERE transmission_status IN ('pending', 'failed')
        ORDER BY created_at
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 1000)],
    );

    let transmitted = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const result = await this.transmitOne(row.transaction_id);
        if (result.status === 'transmitted') transmitted += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { transmitted, failed };
  }
}

function asObject<T>(value: T | string): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return {} as T;
    }
  }
  return value ?? ({} as T);
}
