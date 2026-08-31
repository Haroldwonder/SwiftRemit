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
  | "disputed"
  | "partial_payout"
  | "expired"
  | "agent_registered"
  | "agent_removed"
  | "fee_updated"
  | "paused"
  | "unpaused"
  | "admin_added"
  | "admin_removed"
  | "circuit_breaker_paused"
  | "circuit_breaker_unpaused"
  | "user_blacklisted"
  | "user_removed_from_blacklist"
  | "token_whitelisted"
  | "token_removed_from_whitelist"
  | "daily_limit_updated"
  | "dispute_raised"
  | "dispute_resolved"
  | "proposal_created"
  | "proposal_voted"
  | "proposal_approved"
  | "proposal_executed"
  | "settlement_completed";

/** A decoded contract event from the Stellar ledger. */
export interface RemittanceEvent {
  type: RemittanceEventType;
  remittanceId?: bigint;
  ledger: number;
  ledgerClosedAt: string;
  raw: {
    topics: string[];
    value: string;
  };
}

/**
 * Event types whose second topic carries the remittance ID the event belongs to.
 * Every other event type is contract-wide (admin, governance, token whitelist)
 * and has no remittance ID to decode.
 */
export type RemittanceScopedEventType =
  | "created"
  | "completed"
  | "cancelled"
  | "failed"
  | "disputed"
  | "partial_payout"
  | "expired"
  | "dispute_raised"
  | "dispute_resolved"
  | "settlement_completed";

/** A contract event payload decoded from XDR into native JavaScript values. */
export interface DecodedEventData {
  /** Topics decoded to native values. `topics[0]` is the event type symbol. */
  topics: unknown[];
  /**
   * Payload decoded to a native value. Multi-field contract events decode to an
   * array in emission order; single-field events decode to a bare scalar.
   */
  value: unknown;
  /** Base64 XDR exactly as received, for consumers that need the wire form. */
  raw: {
    topics: string[];
    value: string;
  };
}

/** Decoded payload for an event that belongs to a specific remittance. */
export interface RemittanceScopedEventData extends DecodedEventData {
  remittanceId: bigint;
}

/** Decoded payload for a contract-wide event. */
export interface ContractEventData extends DecodedEventData {
  remittanceId?: undefined;
}

/** Maps each event type to the payload shape its handler receives. */
export type EventDataMap = {
  [K in RemittanceEventType]: K extends RemittanceScopedEventType
    ? RemittanceScopedEventData
    : ContractEventData;
};

/** Handler function for contract events. */
export type EventHandler<T extends RemittanceEventType = RemittanceEventType> = (event: {
  type: T;
  data: EventDataMap[T];
  ledger: number;
  ledgerClosedAt: string;
}) => Promise<void> | void;

/** Handler function for a multi-type subscription, where the type is not known statically. */
export type AnyEventHandler = (event: {
  type: RemittanceEventType;
  data: EventDataMap[RemittanceEventType];
  ledger: number;
  ledgerClosedAt: string;
}) => Promise<void> | void;

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
  /** Ledger timestamp after which anyone can call expireRemittance to refund the sender */
  expiresAt: bigint | null;
}

/** A single partial payout disbursement record for a remittance. */
export interface PartialPayoutRecord {
  /** Amount disbursed in this payout */
  amount: bigint;
  /** Cumulative total disbursed including this payout */
  totalDisbursed: bigint;
  /** Remaining amount after this payout */
  remainingAmount: bigint;
  /** Ledger timestamp of this disbursement */
  timestamp: bigint;
  /** Ledger sequence number of this disbursement */
  ledgerSequence: number;
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

/** Per-item result from createRemittanceBatch. */
export interface BatchCreateResult {
  index: number;
  entry: BatchCreateEntry;
  success: boolean;
  tx?: import("@stellar/stellar-sdk").Transaction;
  error?: Error;
}

/** Response from createRemittanceBatch. */
export interface BatchCreateResponse {
  results: BatchCreateResult[];
  successCount: number;
  failureCount: number;
}

/** Per-item input for createRemittanceBatch. */
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

/** Retry policy for a specific operation or operation category. */
export interface RetryPolicy {
  /** Number of retry attempts (0 = call once and fail on error). */
  retries: number;
  /** Initial delay in ms before the first retry. Falls back to the client's retryDelayMs. */
  delayMs?: number;
  /** Backoff multiplier applied after each retry. Falls back to the client's retryBackoffFactor. */
  backoffFactor?: number;
}

/** Pre-built named retry policies for common scenarios. */
export const RetryPolicies = {
  /** No retries — suitable for non-idempotent operations where a duplicate would be harmful. */
  NONE: { retries: 0 } as RetryPolicy,
  /** Aggressive retries — suitable for idempotent reads where availability matters. */
  AGGRESSIVE: { retries: 5, delayMs: 500, backoffFactor: 1.5 } as RetryPolicy,
} as const;

/** A remittance corridor identified by destination currency and country. */
export interface Corridor {
  /** ISO 4217 currency code (e.g. "USDC", "USD"). */
  currency: string;
  /** ISO 3166-1 alpha-2 destination country code (e.g. "NG", "GH"). */
  country: string;
}

/** Fee estimate returned by {@link SwiftRemitClient.estimateFee}. All amounts in stroops. */
export interface FeeEstimate {
  /** Requested send amount in stroops. */
  amount: bigint;
  /** Platform fee charged by SwiftRemit in stroops. */
  platformFee: bigint;
  /** Protocol fee charged by the Stellar network in stroops. */
  protocolFee: bigint;
  /** Net amount the recipient receives (amount − totalFee) in stroops. */
  netAmount: bigint;
  /** Sum of platformFee and protocolFee in stroops. */
  totalFee: bigint;
  /** Timestamp when this estimate was generated. */
  estimatedAt: Date;
  /** True when the estimate was served from the 30-second local cache. */
  fromCache: boolean;
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
  /**
   * Default retry policy for state-changing (write) operations submitted via
   * {@link SwiftRemitClient.submitTransaction}. Defaults to no retries because
   * most write operations are non-idempotent and retrying the same signed
   * transaction could produce unexpected results for callers who don't explicitly
   * opt in. Override per-call via the `options.retryPolicy` argument.
   */
  writeRetryPolicy?: RetryPolicy;
}

export type ProposalState = "Pending" | "Approved" | "Executed" | "Expired";

export type ProposalAction =
  | { UpdateFee: number }
  | { RegisterAgent: string }
  | { RemoveAgent: string }
  | { AddAdmin: string }
  | { RemoveAdmin: string }
  | { UpdateQuorum: number }
  | { UpdateTimelock: bigint }
  | { UpdateCooldownPeriod: bigint }
  | { WhitelistAsset: string }
  | { AdjustReputationThreshold: number };

export interface Proposal {
  id: bigint;
  proposer: string;
  action: ProposalAction;
  state: ProposalState;
  createdAt: bigint;
  expiry: bigint;
  approvalCount: number;
  approvalTimestamp: bigint | null;
  /** Ledger timestamp before which the proposal cannot be executed (timelock enforced). */
  executeAfter: bigint | null;
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
  /** Configured corridor limit in stroops (0 = no limit set). 1 USDC = 10_000_000 stroops. */
  limit: bigint;
  /** Amount already sent in the current 24-hour window, in stroops. */
  used: bigint;
  /** Remaining sendable amount in the current window, in stroops. */
  remaining: bigint;
  /** Timestamp when the current 24-hour window resets */
  resetsAt: Date;
}

/** Convert a stroops value to a human-readable USDC amount (7 decimal places). */
export function stroopsToUsdc(stroops: bigint): number {
  return Number(stroops) / 10_000_000;
}

// ─── Escrow ────────────────────────────────────────────────────────────────

export interface Escrow {
  transferId: bigint;
  sender: string;
  recipient: string;
  /** Amount locked in stroops */
  amount: bigint;
  expiry: bigint | null;
  status: EscrowStatus;
}

// ─── Asset verification ─────────────────────────────────────────────────────

export type VerificationStatus = "Verified" | "Unverified" | "Suspicious";

export interface AssetVerification {
  assetCode: string;
  issuer: string;
  status: VerificationStatus;
  /** Reputation score, 0-100 */
  reputationScore: number;
  lastVerified: bigint;
  trustlineCount: bigint;
  hasToml: boolean;
}

// ─── Circuit breaker pause records ──────────────────────────────────────────

export interface PauseRecord {
  seq: bigint;
  caller: string;
  timestamp: bigint;
  reason: PauseReason;
}

// ─── Fee strategy / corridor ────────────────────────────────────────────────

export type FeeStrategy =
  | { Percentage: number }
  | { Flat: bigint }
  | { Dynamic: number }
  | "Corridor";

export interface FeeCorridor {
  fromCountry: string;
  toCountry: string;
  strategy: FeeStrategy;
  /** Overrides the global protocol fee for this corridor when set */
  protocolFeeBps: number | null;
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: bigint;
  enabled: boolean;
}

export interface RateLimitStatus {
  /** Requests made in the current window */
  requestCount: number;
  /** Requests remaining in the current window */
  remaining: number;
  /** Timestamp when the current window resets */
  resetAt: bigint;
}

// ─── Transaction controller ─────────────────────────────────────────────────

export type TransactionState =
  | "Initial"
  | "EligibilityValidated"
  | "KycConfirmed"
  | { ContractCalled: bigint }
  | { AnchorInitiated: bigint }
  | "RecordStored"
  | "Completed"
  | "RolledBack";

export interface TransactionRecord {
  user: string;
  agent: string;
  /** Amount in stroops */
  amount: bigint;
  remittanceId: bigint | null;
  anchorTxId: bigint | null;
  state: TransactionState;
  retryCount: number;
  timestamp: bigint;
}

// ─── Migration ───────────────────────────────────────────────────────────────

/**
 * Snapshot of all contract data for migration purposes. `instanceData` and
 * `persistentData` are returned as raw decoded maps rather than fully typed
 * structures, since their shape mirrors internal storage layout that may
 * change between contract versions.
 */
export interface MigrationSnapshot {
  version: number;
  timestamp: bigint;
  ledgerSequence: number;
  instanceData: Record<string, unknown>;
  persistentData: Record<string, unknown>;
  /** Hex-encoded 32-byte integrity hash */
  verificationHash: string;
}

// ─── Batch settlement / netting ─────────────────────────────────────────────

export interface BatchSettlementEntry {
  remittanceId: bigint;
}

export interface BatchSettlementResult {
  settledIds: bigint[];
}

// ─── Multi-sig admin operations ─────────────────────────────────────────────

export type AdminOperationType = "UpdateFee" | "WithdrawFees" | "Pause" | "Unpause";

export interface PendingOperation {
  id: bigint;
  operationType: AdminOperationType;
  proposer: string;
  approvers: string[];
  threshold: number;
  proposedAt: bigint;
  ttlSeconds: bigint;
  /** Only meaningful for UpdateFee operations */
  feeBps: number;
  /** Only meaningful for WithdrawFees operations */
  withdrawTo: string | null;
}

// ─── Recipient verification (SR-195) ────────────────────────────────────────

/**
 * Schema version used when serializing recipient details for hashing.
 * Must match RECIPIENT_HASH_SCHEMA_VERSION in src/recipient_verification.rs.
 */
export const RECIPIENT_HASH_SCHEMA_VERSION = 1;

/**
 * Describes a crypto-wallet recipient.
 *
 * Wire format (SHA-256 input):
 *   [0x01] + XDR-encoded Stellar address (32-byte raw public key, big-endian)
 */
export interface WalletRecipient {
  type: "Wallet";
  /** 56-character Stellar/Soroban StrKey address (G…). */
  address: string;
}

/**
 * Describes a bank-account recipient.
 *
 * Wire format (SHA-256 input):
 *   [0x02]
 *   + u32-BE(len(account_number)) + UTF-8(account_number)
 *   + u32-BE(len(routing_code))   + UTF-8(routing_code)
 */
export interface BankRecipient {
  type: "Bank";
  /** Bank account number (UTF-8). */
  accountNumber: string;
  /** Routing / sort code (UTF-8). */
  routingCode: string;
}

/**
 * Union type for all recipient variants understood by the contract's
 * recipient-hash scheme (schema v1).
 *
 * Pass to {@link computeRecipientHash} to obtain a 32-byte SHA-256 digest
 * suitable for `createRemittance.recipientHash` and
 * `confirmPayout.recipientDetailsHash`.
 */
export type RecipientDetails = WalletRecipient | BankRecipient;
