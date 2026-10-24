export interface Currency {
  code: string;
  symbol: string;
  decimal_precision: number;
  name?: string;
  /**
   * #1547 — Currency aliases.
   * Alternative names or codes that resolve to this currency
   * (e.g. ["DOLLAR", "DOLLARS"] → "USD").  Aliases are matched
   * case-insensitively and must be unique across the config.
   */
  aliases?: string[];
}

export interface CurrencyConfig {
  currencies: Currency[];
}

// ─── #1545: Conversion rates ─────────────────────────────────────────────────

export interface ConversionRate {
  from: string;
  to: string;
  rate: number;
  /** ISO-8601 timestamp of when this rate was fetched / computed. */
  fetched_at: string;
}

export interface ConversionRateResponse {
  success: boolean;
  data: ConversionRate;
  timestamp: string;
}

export interface ConversionRateErrorResponse {
  success: false;
  error: { message: string; code: string };
  timestamp: string;
}

// ─── Agent reputation: dispute outcomes ──────────────────────────────────────

/**
 * Dispute outcome record for an agent. Tracks wins and losses separately so
 * that reputation reflects how disputes were resolved, not merely how many
 * were raised against the agent.
 */
export interface AgentDisputeStats {
  agent: string;
  /** Total disputes raised against the agent (informational). */
  dispute_count: number;
  /** Disputes resolved in the agent's favour. */
  disputes_won: number;
  /** Disputes resolved against the agent. */
  disputes_lost: number;
  /** ISO-8601 timestamp of the most recent dispute outcome, used for time decay. */
  last_outcome_at?: string;
}

export type DisputeOutcome = 'agent_won' | 'sender_won';

export interface CurrencyResponse {
  success: boolean;
  data: Currency[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
  timestamp: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
  };
  timestamp: string;
}

// Re-export from shared logger so all api service code imports from one place.
export { StructuredLogger, createLogger, redact } from '../../shared/src/logger';
