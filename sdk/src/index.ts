export { SwiftRemitClient } from "./client.js";
export type {
  SwiftRemitClientOptions,
  Remittance,
  RemittanceStatus,
  RemittanceEvent,
  RemittanceEventType,
  SubscribeOptions,
  Unsubscribe,
  AgentStats,
  CircuitBreakerStatus,
  PauseReason,
  HealthStatus,
  FeeBreakdown,
  BatchCreateEntry,
  CreateRemittanceParams,
  SettlementConfig,
  EscrowStatus,
  Role,
  GovernanceConfig,
} from "./types.js";
export {
  parseRemittance,
  parseAgentStats,
  parseCircuitBreakerStatus,
  parseHealthStatus,
  parseFeeBreakdown,
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

/** USDC multiplier: 1 USDC = 10_000_000 stroops. */
export const USDC_MULTIPLIER = 10_000_000n;

/** Convert a human-readable USDC amount to stroops. */
export function toStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * Number(USDC_MULTIPLIER)));
}

/** Convert stroops to a human-readable USDC amount. */
export function fromStroops(stroops: bigint): number {
  return Number(stroops) / Number(USDC_MULTIPLIER);
}
