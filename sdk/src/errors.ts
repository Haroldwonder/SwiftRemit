/**
 * Typed error mapping for the SwiftRemit TypeScript SDK.
 *
 * Mirrors the 74 ContractError codes defined in src/errors.rs so callers
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

  // Authorization (26-29)
  AdminAlreadyExists = 26,
  AdminNotFound = 27,
  CannotRemoveLastAdmin = 28,
  TokenNotWhitelisted = 29,

  // Migration (30-32)
  InvalidMigrationHash = 30,
  MigrationInProgress = 31,
  InvalidMigrationBatch = 32,

  // Rate limiting / abuse (33-35)
  CooldownActive = 33,
  SuspiciousActivity = 34,
  ActionBlocked = 35,

  // Arithmetic / data (36-52)
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
  IdempotencyConflict = 49,
  InvalidProof = 50,
  MissingProof = 51,
  InvalidOracleAddress = 52,

  // Dispute (53-55)
  DisputeWindowExpired = 53,
  AlreadyDisputed = 54,
  NotDisputed = 55,

  // Circuit breaker (56-62)
  AlreadyPaused = 56,
  NotPaused = 57,
  TimelockActive = 58,
  AlreadyVoted = 59,
  InvalidTimelockDuration = 60,
  InvalidQuorum = 61,
  PauseRecordNotFound = 62,

  // Recipient address verification (63-66)
  InvalidRecipientHash = 63,
  MissingRecipientHash = 64,
  RecipientHashMismatch = 65,
  RecipientHashSchemaMismatch = 66,

  // Governance (67-74)
  ProposalAlreadyPending = 67,
  ProposalNotFound = 68,
  InvalidProposalState = 69,
  TimelockNotElapsed = 70,
  AlreadyAdmin = 71,
  InsufficientAdmins = 72,
  AgentAlreadyRegistered = 73,
  GovernanceAlreadyInitialized = 74,
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
  [ErrorCode.IdempotencyConflict]: "Idempotency key exists but request payload differs",
  [ErrorCode.InvalidProof]: "Proof validation failed",
  [ErrorCode.MissingProof]: "Proof is required but not provided",
  [ErrorCode.InvalidOracleAddress]: "Oracle address is invalid or not configured",
  [ErrorCode.DisputeWindowExpired]: "The dispute window for this remittance has expired",
  [ErrorCode.AlreadyDisputed]: "This remittance has already been disputed",
  [ErrorCode.NotDisputed]: "This operation requires the remittance to be in a Disputed state",
  [ErrorCode.AlreadyPaused]: "Contract is already paused",
  [ErrorCode.NotPaused]: "Contract is not paused",
  [ErrorCode.TimelockActive]: "Timelock has not yet elapsed",
  [ErrorCode.AlreadyVoted]: "Admin has already cast a vote for this instance",
  [ErrorCode.InvalidTimelockDuration]: "Timelock duration exceeds the maximum allowed value",
  [ErrorCode.InvalidQuorum]: "Quorum value is invalid",
  [ErrorCode.PauseRecordNotFound]: "Pause record not found",
  [ErrorCode.InvalidRecipientHash]: "Supplied recipient hash is not exactly 32 bytes",
  [ErrorCode.MissingRecipientHash]: "Recipient hash is required but not provided",
  [ErrorCode.RecipientHashMismatch]: "Supplied recipient hash does not match the stored hash",
  [ErrorCode.RecipientHashSchemaMismatch]: "Stored hash schema version mismatch",
  [ErrorCode.ProposalAlreadyPending]: "A proposal with this action type is already pending",
  [ErrorCode.ProposalNotFound]: "Proposal not found",
  [ErrorCode.InvalidProposalState]: "Proposal is not in the required state for this operation",
  [ErrorCode.TimelockNotElapsed]: "Governance execution timelock has not yet elapsed",
  [ErrorCode.AlreadyAdmin]: "The address is already an Admin",
  [ErrorCode.InsufficientAdmins]: "Removing this admin would violate the minimum admin invariant",
  [ErrorCode.AgentAlreadyRegistered]: "The agent is already registered",
  [ErrorCode.GovernanceAlreadyInitialized]: "Governance has already been initialized",
};

/**
 * Typed error thrown by all SwiftRemitClient methods when the contract
 * returns a known error code.
 */
export class SwiftRemitError extends Error {
  /** The numeric error code from the contract. */
  readonly code: ErrorCode;
  /** The raw error string from the RPC response (for debugging). */
  readonly rawError: string;

  constructor(code: ErrorCode, rawError: string) {
    const message = ERROR_MESSAGES[code] ?? `Contract error ${code}`;
    super(message);
    this.name = "SwiftRemitError";
    this.code = code;
    this.rawError = rawError;
    // Maintain proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, SwiftRemitError.prototype);
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
      if (code in ErrorCode) {
        return new SwiftRemitError(code, message);
      }
    }
  }

  return null;
}
