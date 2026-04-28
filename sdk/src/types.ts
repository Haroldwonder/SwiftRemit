/**
 * TypeScript types mirroring the SwiftRemit Soroban contract types.
 */

export type RemittanceStatus =
  | "Pending"
  | "Processing"
  | "Completed"
  | "Cancelled"
  | "Failed"
  | "Disputed";

/** Contract event types emitted by the SwiftRemit contract. */
export type RemittanceEventType =
  | "created"
  | "completed"
  | "cancelled"
  | "failed"
  | "disputed";

/** A decoded contract event from the Stellar ledger. */
export interface RemittanceEvent {
  type: RemittanceEventType;
  remittanceId: bigint;
  /** Ledger sequence number in which the event was emitted. */
  ledger: number;
  /** ISO-8601 timestamp of the ledger close. */
  ledgerClosedAt: string;
  /** Raw topic/value data from the contract event. */
  raw: {
    topics: string[];
    value: string;
  };
}

/** Options for filtering the event stream. */
export interface SubscribeOptions {
  /** Only emit events for this specific remittance ID. */
  remittanceId?: bigint;
  /** Only emit events where the sender matches this address. */
  sender?: string;
  /** Only emit events where the agent matches this address. */
  agent?: string;
  /** Cursor to resume from (Horizon paging token). */
  cursor?: string;
}

/** Call this function to stop the subscription and close the SSE stream. */
export type Unsubscribe = () => void;

export type EscrowStatus = "Pending" | "Released" | "Refunded";

export type PauseReason =
  | "SecurityIncident"
  | "SuspiciousActivity"
  | "MaintenanceWindow"
  | "ExternalThreat";

export type Role = "Admin" | "Settler";

export interface Remittance {
  id: bigint;
  sender: string;
  agent: string;
  /** Amount in stroops (1 USDC = 10_000_000 stroops) */
  amount: bigint;
  /** Platform fee in stroops */
  fee: bigint;
  status: RemittanceStatus;
  expiry: bigint | null;
  token: string;
  createdAt: bigint;
  failedAt: bigint | null;
}

export interface AgentStats {
  totalSettlements: number;
  failedSettlements: number;
  totalSettlementTime: bigint;
  disputeCount: number;
  /** Successful payouts / total * 10000 (basis points). 10000 = 100%. */
  successRateBps: number;
  /** Ledger timestamp of the most recent confirm_payout or mark_failed call. */
  lastActiveTimestamp: bigint;
}

export interface CircuitBreakerStatus {
  isPaused: boolean;
  pauseReason: PauseReason | null;
  pauseTimestamp: bigint | null;
  timelockSeconds: bigint;
  unpauseQuorum: number;
  currentVoteCount: number;
}

export interface HealthStatus {
  initialized: boolean;
  paused: boolean;
  adminCount: number;
  totalRemittances: bigint;
  accumulatedFees: bigint;
}

export interface FeeBreakdown {
  platformFee: bigint;
  protocolFee: bigint;
  netAmount: bigint;
}

export interface BatchCreateEntry {
  agent: string;
  /** Amount in stroops */
  amount: bigint;
  expiry?: bigint;
  /** ISO 4217 currency code (e.g. "USDC", "USD") */
  currency?: string;
  /** ISO 3166-1 alpha-2 country code (e.g. "NG", "GH") */
  country?: string;
}

export interface SettlementConfig {
  requireProof: boolean;
  oracleAddress?: string;
}

export interface CreateRemittanceParams {
  sender: string;
  agent: string;
  /** Amount in stroops */
  amount: bigint;
  expiry?: bigint;
  token?: string;
  idempotencyKey?: string;
  settlementConfig?: SettlementConfig;
  recipientHash?: Buffer;
}

export interface SwiftRemitClientOptions {
  /** Deployed contract address */
  contractId: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Soroban RPC URL */
  rpcUrl: string;
  /** Base fee for transactions in stroops (default: 100) */
  fee?: string;
  /** Number of retry attempts on transient RPC errors (default: 3) */
  retries?: number;
  /** Initial delay in ms before first retry (default: 1000) */
  retryDelayMs?: number;
  /** Multiplier applied to delay after each retry (default: 2) */
  retryBackoffFactor?: number;
}

export type ProposalState = "Pending" | "Approved" | "Executed" | "Expired";

export type ProposalAction =
  | { UpdateFee: number }
  | { RegisterAgent: string }
  | { RemoveAgent: string }
  | { AddAdmin: string }
  | { RemoveAdmin: string }
  | { UpdateQuorum: number }
  | { UpdateTimelock: bigint };

export interface Proposal {
  id: bigint;
  proposer: string;
  action: ProposalAction;
  state: ProposalState;
  createdAt: bigint;
  expiry: bigint;
  approvalCount: number;
  approvalTimestamp: bigint | null;
}

export interface GovernanceConfig {
  /** Minimum number of admin approvals required to pass a proposal */
  quorum: number;
  /** Seconds that must elapse between approval and execution */
  timelockSeconds: bigint;
  /** Seconds after creation before a proposal expires */
  proposalTtlSeconds: bigint;
}

export interface DailyLimitStatus {
  /** Configured corridor limit in stroops (0 = no limit set) */
  limit: bigint;
  /** Amount already sent in the current 24-hour window (stroops) */
  used: bigint;
  /** Remaining sendable amount in the current window (stroops) */
  remaining: bigint;
  /** Timestamp when the current 24-hour window resets */
  resetsAt: Date;
}
