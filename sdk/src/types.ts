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
  /**
   * Timeout in seconds for all network requests (default: 30).
   * Prevents requests from hanging indefinitely on poor mobile connections.
   */
  timeoutMs?: number;
}

export interface GovernanceConfig {
  /** Minimum number of admin approvals required to pass a proposal */
  quorum: number;
  /** Seconds that must elapse between approval and execution */
  timelockSeconds: bigint;
  /** Seconds after creation before a proposal expires */
  proposalTtlSeconds: bigint;
}
