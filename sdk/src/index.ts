export {
  SwiftRemitClient,
  MAX_BATCH_SIZE,
  buildUpdateFeeProposal,
  buildRegisterAgentProposal,
  buildRemoveAgentProposal,
  buildAddAdminProposal,
  buildRemoveAdminProposal,
  buildUpdateQuorumProposal,
  buildUpdateTimelockProposal,
  buildUpdateCooldownPeriodProposal,
  buildWhitelistAssetProposal,
  buildAdjustReputationThresholdProposal,
} from "./client.js";
export { SwiftRemitError, ErrorCode, parseContractError } from "./errors.js";
export type {
  SwiftRemitClientOptions,
  Remittance,
  RemittanceStatus,
  RemittanceEvent,
  RemittanceEventType,
  EventHandler,
  SubscribeOptions,
  Unsubscribe,
  AgentStats,
  CircuitBreakerStatus,
  PauseReason,
  HealthStatus,
  FeeBreakdown,
  BatchCreateEntry,
  BatchCreateResult,
  BatchCreateResponse,
  CreateRemittanceParams,
  SettlementConfig,
  EscrowStatus,
  Role,
  GovernanceConfig,
  DailyLimitStatus,
  RetryPolicy,
  Corridor,
  FeeEstimate,
  Proposal,
  ProposalAction,
  ProposalState,
  // SR-194: previously unexported domain types
  Escrow,
  AssetVerification,
  VerificationStatus,
  PauseRecord,
  FeeStrategy,
  FeeCorridor,
  RateLimitConfig,
  RateLimitStatus,
  TransactionRecord,
  TransactionState,
  MigrationSnapshot,
  BatchSettlementEntry,
  BatchSettlementResult,
  AdminOperationType,
  PendingOperation,
  PartialPayoutRecord,
  // SR-195: recipient hash types
  RecipientDetails,
  WalletRecipient,
  BankRecipient,
} from "./types.js";
export { RetryPolicies, RECIPIENT_HASH_SCHEMA_VERSION } from "./types.js";
export {
  parseRemittance,
  parseAgentStats,
  parseCircuitBreakerStatus,
  parseHealthStatus,
  parseFeeBreakdown,
  parseProposal,
  addressToScVal,
  u64ToScVal,
  i128ToScVal,
  optionToScVal,
  bytesNToScVal,
  stringToScVal,
  /** Validate a bigint amount before passing to any transaction-building function. */
  validateAmount,
  /** Validate a Stellar address string before passing to any transaction-building function. */
  validateAddress,
  // SR-194: previously unexported parsers and encoders
  parseEscrow,
  parseAssetVerification,
  parsePauseRecord,
  parseFeeCorridor,
  parseFeeStrategy,
  parseRateLimitConfig,
  parseRateLimitStatus,
  parseTransactionRecord,
  parseMigrationSnapshot,
  parseBatchSettlementResult,
  parsePendingOperation,
  feeCorridorToScVal,
  feeStrategyToScVal,
  batchSettlementEntryToScVal,
  adminOperationTypeToScVal,
  roleToScVal,
  verificationStatusToScVal,
  pauseReasonToScVal,
  // SR-195: recipient hash builder
  computeRecipientHash,
} from "./convert.js";

/** Stellar network passphrases for convenience. */
export const Networks = {
  TESTNET: "Test SDF Network ; September 2015",
  MAINNET: "Public Global Stellar Network ; September 2015",
} as const;

/** Default Soroban RPC endpoints. */
export const RpcUrls = {
  TESTNET: "https://soroban-testnet.stellar.org",
  MAINNET: "https://soroban-mainnet.stellar.org",
} as const;

export { withRetry, withRetryPolicy, isTransientError, RateLimitError, parseRetryAfterMs, rateLimitErrorFromResponse } from "./retry.js";

/** USDC multiplier: 1 USDC = 10_000_000 stroops. */
export const USDC_MULTIPLIER = 10_000_000n;

/** Stroops per XLM. */
export const XLM_STROOPS = 10_000_000;

/** Default Stellar base fee per operation in stroops. */
export const STELLAR_BASE_FEE_STROOPS = 100;

/**
 * Estimate the XLM network fee for a given number of Stellar operations.
 *
 * @param operationCount - Number of operations in the transaction (default: 1)
 * @param baseFeeStroops - Per-operation base fee in stroops (default: 100).
 *   Pass the value from `GET /api/accounts/:address/stellar-fees` for
 *   network-accurate estimates under congestion.
 * @returns Estimated fee in XLM
 */
export function estimateStellarFee(operationCount = 1, baseFeeStroops = STELLAR_BASE_FEE_STROOPS): number {
  if (operationCount < 1) throw new RangeError("operationCount must be at least 1");
  return (baseFeeStroops * operationCount) / XLM_STROOPS;
}

/** Convert a human-readable USDC amount to stroops.
 *
 * @param usdc - A non-negative, non-fractional number (e.g. 100 for 100 USDC).
 *   Passing a float (e.g. 1.999_999_999) will throw — use an integer or round
 *   explicitly before calling this function.
 * @throws {RangeError} if `usdc` is negative.
 * @throws {RangeError} if `usdc` is not a safe integer after scaling
 *   (i.e. would lose precision via floating-point arithmetic).
 */
export function toStroops(usdc: number): bigint {
  if (usdc < 0) {
    throw new RangeError(`toStroops: usdc must be non-negative; received ${usdc}.`);
  }
  const scaled = usdc * Number(USDC_MULTIPLIER);
  if (!Number.isInteger(scaled)) {
    throw new RangeError(
      `toStroops: "${usdc}" USDC does not map to a whole number of stroops ` +
        `(result: ${scaled}). Use a value with at most 7 decimal places, ` +
        `or round explicitly: Math.round(${usdc} * 1e7).`
    );
  }
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError(
      `toStroops: "${usdc}" USDC exceeds safe integer range after scaling. ` +
        `Use a BigInt-based computation for very large amounts.`
    );
  }
  return BigInt(scaled);
}

/** Convert stroops to a human-readable USDC amount. */
export function fromStroops(stroops: bigint): number {
  return Number(stroops) / Number(USDC_MULTIPLIER);
}
