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
} from "./types.js";
export { RetryPolicies } from "./types.js";
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

export { withRetry, withRetryPolicy, isTransientError } from "./retry.js";

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

/** Convert a human-readable USDC amount to stroops. */
export function toStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * Number(USDC_MULTIPLIER)));
}

/** Convert stroops to a human-readable USDC amount. */
export function fromStroops(stroops: bigint): number {
  return Number(stroops) / Number(USDC_MULTIPLIER);
}
