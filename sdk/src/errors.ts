/**
 * Typed error mapping for the SwiftRemit TypeScript SDK.
 *
 * Mirrors the ContractError codes defined in src/errors.rs so callers
 * can catch and branch on named error codes instead of parsing raw strings.
 *
 * Usage:
 *   import { SwiftRemitError, ErrorCode } from '@swiftremit/sdk'
 *
 *   try {
 *     await client.createRemittance(...)
 *   } catch (e) {
 *     if (e instanceof SwiftRemitError && e.code === ErrorCode.DailySendLimitExceeded) {
 *       // handle gracefully
 *     }
 *   }
 */

/** Named error codes mirroring ContractError in src/errors.rs. */
export enum ErrorCode {
  // Initialization (1-2)
  AlreadyInitialized = 1,
  NotInitialized = 2,

  // Validation (3-10)
  InvalidAmount = 3,
  InvalidFeeBps = 4,
  AgentNotRegistered = 5,
  RemittanceNotFound = 6,
  InvalidStatus = 7,
  InvalidStateTransition = 8,
  NoFeesToWithdraw = 9,
  InvalidAddress = 10,

  // Settlement (11-12)
  SettlementExpired = 11,
  DuplicateSettlement = 12,

  // Contract state & user (13-22)
  ContractPaused = 13,
  AssetNotFound = 14,
  UserBlacklisted = 15,
  InvalidReputationScore = 16,
  KycNotApproved = 17,
  SuspiciousAsset = 18,
  AnchorTransactionFailed = 19,
  Unauthorized = 20,
  DailySendLimitExceeded = 21,
  TokenAlreadyWhitelisted = 22,

  // KYC / transaction (23-25)
  KycExpired = 23,
  TransactionNotFound = 24,
  RateLimitExceeded = 25,

  // Authorization (26-28)
  AdminAlreadyExists = 26,
  AdminNotFound = 27,
  CannotRemoveLastAdmin = 28,

  // Token whitelist (29)
  TokenNotWhitelisted = 29,

  // Migration (30-32)
  InvalidMigrationHash = 30,
  MigrationInProgress = 31,
  InvalidMigrationBatch = 32,

  // Rate limiting / abuse (33-35)
  CooldownActive = 33,
  SuspiciousActivity = 34,
  ActionBlocked = 35,

  // Arithmetic / data (36-55)
  Overflow = 36,
  NetSettlementValidationFailed = 37,
  EscrowNotFound = 38,
  InvalidEscrowStatus = 39,
  SettlementCounterOverflow = 40,
  InvalidBatchSize = 41,
  DataCorruption = 42,
  IndexOutOfBounds = 43,
  EmptyCollection = 44,
  KeyNotFound = 45,
  StringConversionFailed = 46,
  InvalidSymbol = 47,
  Underflow = 48,
  NoPendingAdminTransfer = 49,
  IdempotencyConflict = 50,
  InvalidProof = 51,
  MissingProof = 52,
  InvalidOracleAddress = 53,
  AlreadyPaused = 54,
  NotPaused = 55,

  // Multi-sig (56-59)
  OperationNotFound = 56,
  AlreadyApproved = 57,
  OperationExpired = 58,
  InvalidMultiSigThreshold = 59,

  // Governance / DAO (60-69)
  AlreadyAdmin = 60,
  InsufficientAdmins = 61,
  InvalidQuorum = 62,
  AlreadyVoted = 63,
  InvalidProposalState = 64,
  ProposalAlreadyPending = 65,
  TimelockActive = 66,
  GovernanceAlreadyInitialized = 67,
  ProposalNotFound = 68,
  AgentAlreadyRegistered = 69,

  // Restored variants (70, 72-80) — re-added after bad-merge gap (SR-192)
  NotFound = 70,

  // Dispute (71)
  NotDisputed = 71,

  MigrationValidationFailed = 72,
  PauseRecordNotFound = 73,
  DisputeWindowExpired = 74,
  MissingRecipientHash = 75,
  RecipientHashSchemaMismatch = 76,
  RecipientHashMismatch = 77,
  InvalidTimelockDuration = 78,
  BelowMinReputation = 79,
  MultisigQuorumRequired = 80,

  // Dispute evidence (83)
  MalformedEvidenceHash = 83,
}

/** Human-readable messages for each error code. */
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.AlreadyInitialized]: "Contract has already been initialized",
  [ErrorCode.NotInitialized]: "Contract has not been initialized yet",
  [ErrorCode.InvalidAmount]: "Amount must be greater than zero",
  [ErrorCode.InvalidFeeBps]: "Fee must be between 0 and 10000 basis points",
  [ErrorCode.AgentNotRegistered]: "Agent is not registered in the system",
  [ErrorCode.RemittanceNotFound]: "Remittance not found",
  [ErrorCode.InvalidStatus]: "Invalid remittance status for this operation",
  [ErrorCode.InvalidStateTransition]: "Invalid state transition attempted",
  [ErrorCode.NoFeesToWithdraw]: "No fees available to withdraw",
  [ErrorCode.InvalidAddress]: "Invalid address format or validation failed",
  [ErrorCode.SettlementExpired]: "Settlement window has expired",
  [ErrorCode.DuplicateSettlement]: "Settlement has already been executed",
  [ErrorCode.ContractPaused]: "Contract is paused",
  [ErrorCode.AssetNotFound]: "Asset verification record not found",
  [ErrorCode.UserBlacklisted]: "User is blacklisted and cannot perform transactions",
  [ErrorCode.InvalidReputationScore]: "Reputation score must be between 0 and 100",
  [ErrorCode.KycNotApproved]: "User KYC is not approved",
  [ErrorCode.SuspiciousAsset]: "Asset has been flagged as suspicious",
  [ErrorCode.AnchorTransactionFailed]: "Anchor transaction failed",
  [ErrorCode.Unauthorized]: "Caller is not authorized to perform this operation",
  [ErrorCode.DailySendLimitExceeded]: "Daily send limit exceeded for this user",
  [ErrorCode.TokenAlreadyWhitelisted]: "Token is already whitelisted",
  [ErrorCode.KycExpired]: "User KYC has expired",
  [ErrorCode.TransactionNotFound]: "Transaction record not found",
  [ErrorCode.RateLimitExceeded]: "Rate limit exceeded",
  [ErrorCode.AdminAlreadyExists]: "Admin address already exists",
  [ErrorCode.AdminNotFound]: "Admin address does not exist",
  [ErrorCode.CannotRemoveLastAdmin]: "Cannot remove the last admin",
  [ErrorCode.TokenNotWhitelisted]: "Token is not whitelisted",
  [ErrorCode.InvalidMigrationHash]: "Migration hash verification failed",
  [ErrorCode.MigrationInProgress]: "Migration already in progress or completed",
  [ErrorCode.InvalidMigrationBatch]: "Migration batch out of order or invalid",
  [ErrorCode.CooldownActive]: "Cooldown period is still active",
  [ErrorCode.SuspiciousActivity]: "Suspicious activity detected",
  [ErrorCode.ActionBlocked]: "Action temporarily blocked due to abuse protection",
  [ErrorCode.Overflow]: "Arithmetic overflow occurred",
  [ErrorCode.NetSettlementValidationFailed]: "Net settlement validation failed",
  [ErrorCode.EscrowNotFound]: "Escrow not found",
  [ErrorCode.InvalidEscrowStatus]: "Invalid escrow status for this operation",
  [ErrorCode.SettlementCounterOverflow]: "Settlement counter overflow",
  [ErrorCode.InvalidBatchSize]: "Invalid batch size",
  [ErrorCode.DataCorruption]: "Data corruption detected",
  [ErrorCode.IndexOutOfBounds]: "Index out of bounds",
  [ErrorCode.EmptyCollection]: "Collection is empty",
  [ErrorCode.KeyNotFound]: "Key not found in map",
  [ErrorCode.StringConversionFailed]: "String conversion failed",
  [ErrorCode.InvalidSymbol]: "Invalid symbol string",
  [ErrorCode.Underflow]: "Arithmetic underflow occurred",
  [ErrorCode.NoPendingAdminTransfer]: "No pending admin transfer to accept",
  [ErrorCode.IdempotencyConflict]: "Idempotency key exists but request payload differs",
  [ErrorCode.InvalidProof]: "Proof validation failed",
  [ErrorCode.MissingProof]: "Proof is required but not provided",
  [ErrorCode.InvalidOracleAddress]: "Oracle address is invalid or not configured",
  [ErrorCode.AlreadyPaused]: "Contract is already paused",
  [ErrorCode.NotPaused]: "Contract is not currently paused",
  [ErrorCode.OperationNotFound]: "Pending admin operation not found",
  [ErrorCode.AlreadyApproved]: "Caller has already approved this pending operation",
  [ErrorCode.OperationExpired]: "Pending operation has exceeded its time-to-live",
  [ErrorCode.InvalidMultiSigThreshold]: "Multi-sig threshold must be at least 1 and no greater than the admin count",
  [ErrorCode.AlreadyAdmin]: "Address is already in the admin set",
  [ErrorCode.InsufficientAdmins]: "Removing this admin would drop the admin count below quorum or below 1",
  [ErrorCode.InvalidQuorum]: "Quorum must be at least 1 and no greater than the current admin count",
  [ErrorCode.AlreadyVoted]: "Admin has already cast a vote on this proposal",
  [ErrorCode.InvalidProposalState]: "Proposal is not in the required state for this operation",
  [ErrorCode.ProposalAlreadyPending]: "A fee-update proposal is already pending or approved",
  [ErrorCode.TimelockActive]: "Proposal timelock has not elapsed; cannot execute yet",
  [ErrorCode.GovernanceAlreadyInitialized]: "Governance has already been initialized",
  [ErrorCode.ProposalNotFound]: "Proposal with the given ID does not exist",
  [ErrorCode.AgentAlreadyRegistered]: "Agent is already registered in the system",
  [ErrorCode.NotDisputed]: "This operation requires the remittance to be in a Disputed state",
  [ErrorCode.MalformedEvidenceHash]: "Evidence hash for a dispute is not a valid 32-byte SHA-256 commitment",
  // SR-192: restored variants (70, 72-80)
  [ErrorCode.NotFound]: "The requested record does not exist",
  [ErrorCode.MigrationValidationFailed]: "Post-migration validation detected inconsistent storage state",
  [ErrorCode.PauseRecordNotFound]: "No pause record exists for the requested sequence number",
  [ErrorCode.DisputeWindowExpired]: "The dispute window for this remittance has already closed",
  [ErrorCode.MissingRecipientHash]: "The remittance has no recipient hash committed on-chain",
  [ErrorCode.RecipientHashSchemaMismatch]: "The stored recipient hash uses a different schema version than supplied",
  [ErrorCode.RecipientHashMismatch]: "The supplied recipient details do not match the committed hash",
  [ErrorCode.InvalidTimelockDuration]: "Timelock duration is outside the permitted range",
  [ErrorCode.BelowMinReputation]: "Agent reputation is below the configured minimum for this operation",
  [ErrorCode.MultisigQuorumRequired]: "This configuration change requires a multi-sig proposal once threshold > 1",
};

/**
 * Suggested remediation for each error code, surfaced to integrators so they
 * know what to actually do about a failure instead of just what went wrong.
 */
const ERROR_REMEDIATIONS: Record<ErrorCode, string> = {
  [ErrorCode.AlreadyInitialized]: "Do not call initialize() again; the contract is already set up.",
  [ErrorCode.NotInitialized]: "Call initialize() before performing any other operation.",
  [ErrorCode.InvalidAmount]: "Pass an amount greater than zero.",
  [ErrorCode.InvalidFeeBps]: "Use a fee value between 0 and 10000 basis points.",
  [ErrorCode.AgentNotRegistered]: "Register the agent via registerAgent() before using it.",
  [ErrorCode.RemittanceNotFound]: "Verify the remittance ID; it may not exist or may have been pruned.",
  [ErrorCode.InvalidStatus]: "Check the remittance's current status before retrying this operation.",
  [ErrorCode.InvalidStateTransition]: "Only perform transitions valid for the remittance's current state.",
  [ErrorCode.NoFeesToWithdraw]: "Wait until accumulated fees are greater than zero before withdrawing.",
  [ErrorCode.InvalidAddress]: "Double-check the address format passed to this call.",
  [ErrorCode.SettlementExpired]: "The settlement window has closed; a new remittance must be created.",
  [ErrorCode.DuplicateSettlement]: "This remittance was already settled; do not resubmit.",
  [ErrorCode.ContractPaused]: "Wait for an admin to unpause the contract, then retry.",
  [ErrorCode.AssetNotFound]: "Verify the asset has a verification record before querying it.",
  [ErrorCode.UserBlacklisted]: "This address is blacklisted; contact an admin if this is unexpected.",
  [ErrorCode.InvalidReputationScore]: "Use a reputation score between 0 and 100.",
  [ErrorCode.KycNotApproved]: "Complete KYC verification for this user before retrying.",
  [ErrorCode.SuspiciousAsset]: "This asset has been flagged; do not proceed without admin review.",
  [ErrorCode.AnchorTransactionFailed]: "Retry the anchor withdrawal/deposit, or check anchor-side status.",
  [ErrorCode.Unauthorized]: "Use an address with the required admin/role privileges.",
  [ErrorCode.DailySendLimitExceeded]: "Wait until the user's rolling 24h window resets, or raise their limit.",
  [ErrorCode.TokenAlreadyWhitelisted]: "This token is already whitelisted; no action needed.",
  [ErrorCode.KycExpired]: "Renew the user's KYC verification before retrying.",
  [ErrorCode.TransactionNotFound]: "Verify the transaction record ID.",
  [ErrorCode.RateLimitExceeded]: "Back off and retry after the rate limit window elapses.",
  [ErrorCode.AdminAlreadyExists]: "This address is already an admin; no action needed.",
  [ErrorCode.AdminNotFound]: "Verify the admin address before attempting removal.",
  [ErrorCode.CannotRemoveLastAdmin]: "Add another admin before removing this one.",
  [ErrorCode.TokenNotWhitelisted]: "Whitelist the token before using it in the contract.",
  [ErrorCode.InvalidMigrationHash]: "Recompute the snapshot hash; the data may be corrupted or tampered with.",
  [ErrorCode.MigrationInProgress]: "Wait for the current migration to complete before starting another.",
  [ErrorCode.InvalidMigrationBatch]: "Import migration batches strictly in order.",
  [ErrorCode.CooldownActive]: "Wait for the cooldown period to elapse before retrying.",
  [ErrorCode.SuspiciousActivity]: "This action was blocked by abuse detection; contact support.",
  [ErrorCode.ActionBlocked]: "This action is temporarily blocked; retry after the block clears.",
  [ErrorCode.Overflow]: "Reduce the input magnitude; the operation would exceed the maximum value.",
  [ErrorCode.NetSettlementValidationFailed]: "Recheck the net settlement inputs for consistency.",
  [ErrorCode.EscrowNotFound]: "Verify the escrow ID before querying or operating on it.",
  [ErrorCode.InvalidEscrowStatus]: "Check the escrow's current status before retrying.",
  [ErrorCode.SettlementCounterOverflow]: "The settlement counter has reached its maximum; contact support.",
  [ErrorCode.InvalidBatchSize]: "Use a batch size greater than zero and within the allowed maximum.",
  [ErrorCode.DataCorruption]: "Stored data failed integrity checks; contact support before retrying.",
  [ErrorCode.IndexOutOfBounds]: "Use an index within the bounds of the collection.",
  [ErrorCode.EmptyCollection]: "Ensure the collection has at least one element before this call.",
  [ErrorCode.KeyNotFound]: "Verify the lookup key exists before retrying.",
  [ErrorCode.StringConversionFailed]: "Check the input string for invalid characters or length.",
  [ErrorCode.InvalidSymbol]: "Use a valid, well-formed symbol string.",
  [ErrorCode.Underflow]: "Reduce the subtraction amount; the operation would go below zero.",
  [ErrorCode.NoPendingAdminTransfer]: "Call proposeAdmin() before attempting to accept an admin transfer.",
  [ErrorCode.IdempotencyConflict]: "Use a new idempotency key, or resend the exact same payload.",
  [ErrorCode.InvalidProof]: "Recheck the proof; it did not validate against the expected commitment.",
  [ErrorCode.MissingProof]: "Supply the required proof for this operation.",
  [ErrorCode.InvalidOracleAddress]: "Configure a valid oracle address before retrying.",
  [ErrorCode.AlreadyPaused]: "The contract is already paused; no action needed.",
  [ErrorCode.NotPaused]: "The contract is not paused; there is nothing to unpause.",
  [ErrorCode.OperationNotFound]: "Verify the pending operation ID before approving or executing it.",
  [ErrorCode.AlreadyApproved]: "This caller has already approved this operation; no action needed.",
  [ErrorCode.OperationExpired]: "This operation's TTL has passed; submit a new one.",
  [ErrorCode.InvalidMultiSigThreshold]: "Use a threshold between 1 and the current admin count.",
  [ErrorCode.AlreadyAdmin]: "This address is already an admin; no action needed.",
  [ErrorCode.InsufficientAdmins]: "Add more admins before removing one, to preserve quorum.",
  [ErrorCode.InvalidQuorum]: "Use a quorum between 1 and the current admin count.",
  [ErrorCode.AlreadyVoted]: "This admin has already voted on this proposal.",
  [ErrorCode.InvalidProposalState]: "Check the proposal's current state before retrying.",
  [ErrorCode.ProposalAlreadyPending]: "Wait for the pending proposal to resolve before submitting another.",
  [ErrorCode.TimelockActive]: "Wait for the proposal's timelock to elapse before executing it.",
  [ErrorCode.GovernanceAlreadyInitialized]: "Governance is already set up; migrateToGovernance() cannot run twice.",
  [ErrorCode.ProposalNotFound]: "Verify the proposal ID before operating on it.",
  [ErrorCode.AgentAlreadyRegistered]: "This agent is already registered; no action needed.",
  [ErrorCode.NotDisputed]: "This operation is only valid while the remittance is in a Disputed state.",
  [ErrorCode.MalformedEvidenceHash]: "Supply a 32-byte SHA-256 hash as the evidence commitment.",
  // SR-192: restored variants (70, 72-80)
  [ErrorCode.NotFound]: "Verify the requested record exists before operating on it.",
  [ErrorCode.MigrationValidationFailed]: "Re-export the migration snapshot and re-import; contact support if this persists.",
  [ErrorCode.PauseRecordNotFound]: "Verify the pause sequence number before querying it.",
  [ErrorCode.DisputeWindowExpired]: "The dispute window has closed; the remittance can no longer be disputed.",
  [ErrorCode.MissingRecipientHash]: "Submit a recipient hash when creating the remittance, or use computeRecipientHash() to build one.",
  [ErrorCode.RecipientHashSchemaMismatch]: "Ensure the schema version used to build the hash matches the one stored on-chain (currently v1).",
  [ErrorCode.RecipientHashMismatch]: "Recompute the recipient hash from the correct recipient details using computeRecipientHash().",
  [ErrorCode.InvalidTimelockDuration]: "Use a timelock duration within the contract's permitted range.",
  [ErrorCode.BelowMinReputation]: "Use an agent with a reputation score at or above the configured minimum.",
  [ErrorCode.MultisigQuorumRequired]: "Submit this change via proposeOperation/approveOperation instead of calling the admin function directly.",
};

/**
 * Error codes that represent transient/temporary conditions worth retrying
 * after a backoff, as opposed to terminal conditions that will not resolve
 * by resubmitting the same call. Kept in sync with {@link isTransientError}.
 */
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.ContractPaused,
  ErrorCode.RateLimitExceeded,
  ErrorCode.CooldownActive,
  ErrorCode.ActionBlocked,
  ErrorCode.AnchorTransactionFailed,
]);

/** Returns whether a given error code is retryable after a backoff. */
export function isRetryableCode(code: ErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

/**
 * Typed error thrown by all SwiftRemitClient methods when the contract
 * returns a known error code.
 */
export class SwiftRemitError extends Error {
  /** The numeric error code from the contract. */
  readonly code: ErrorCode;
  /** The raw error string from the RPC response (for debugging). */
  readonly rawError: string;
  /** Suggested remediation for this error. */
  readonly remediation: string;
  /** Whether retrying the same call after a backoff may succeed. */
  readonly retryable: boolean;

  constructor(code: ErrorCode, rawError: string) {
    const message = ERROR_MESSAGES[code] ?? `Contract error ${code}`;
    super(message);
    this.name = "SwiftRemitError";
    this.code = code;
    this.rawError = rawError;
    this.remediation = ERROR_REMEDIATIONS[code] ?? "Consult the contract documentation for this error code.";
    this.retryable = isRetryableCode(code);
    // Maintain proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, SwiftRemitError.prototype);
  }
}

/**
 * Thrown when a submitted transaction does not reach a terminal status within
 * the confirmation window.
 *
 * The transaction may still be included in a later ledger — this error only says
 * the SDK stopped waiting. Re-check with `server.getTransaction(hash)` before
 * assuming the transaction failed, and never blindly re-submit a non-idempotent
 * operation after seeing this.
 */
export class TransactionTimeoutError extends Error {
  /** Hash of the transaction that was being confirmed. */
  readonly hash: string;
  /** How long the SDK waited, in milliseconds. */
  readonly waitedMs: number;
  /** Number of confirmation polls performed before giving up. */
  readonly polls: number;

  constructor(hash: string, waitedMs: number, polls: number) {
    super(
      `Transaction ${hash} was not confirmed within ${waitedMs}ms (${polls} polls). ` +
        `It may still be included in a later ledger — re-check with getTransaction(hash) ` +
        `before re-submitting.`
    );
    this.name = "TransactionTimeoutError";
    this.hash = hash;
    this.waitedMs = waitedMs;
    this.polls = polls;
    // Maintain proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, TransactionTimeoutError.prototype);
  }
}

/**
 * Parse a raw RPC/simulation error string and return a SwiftRemitError if
 * it contains a known contract error code, or re-throw the original error.
 *
 * Soroban encodes contract errors as `Error(Contract, <code>)` in the XDR
 * result. The SDK surfaces them as strings like:
 *   "HostError: Value(Status(ContractError(4)))"
 * or the simpler form used in simulation failures:
 *   "Simulation failed: Error(Contract, #4)"
 */
export function parseContractError(raw: unknown): SwiftRemitError | null {
  const message = raw instanceof Error ? raw.message : String(raw);

  // Match patterns like "ContractError(4)", "Contract, #4", "contract_error:4"
  const patterns = [
    /ContractError\((\d+)\)/i,
    /Contract,\s*#(\d+)/i,
    /contract_error[:\s]+(\d+)/i,
    /Error\(Contract,\s*(\d+)\)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const code = parseInt(match[1], 10) as ErrorCode;
      if (Object.values(ErrorCode).includes(code)) {
        return new SwiftRemitError(code, message);
      }
    }
  }

  return null;
}
