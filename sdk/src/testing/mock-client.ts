/**
 * In-memory mock implementation of SwiftRemitClient for integration testing.
 *
 * Covers the full SDK surface:
 *   - Every real-client read method with matching signatures
 *   - Every real-client write method (returns MockTxResult instead of Transaction)
 *   - State machine transitions that mirror on-chain rules
 *   - Fault-injection helpers: failNext / delayNext / throwError
 *   - Seeding helpers: remittances, escrows, fees, limits, KYC, blacklist
 *
 * Usage:
 *   import { SwiftRemitMockClient } from "@swiftremit/sdk/testing";
 *
 *   const client = new SwiftRemitMockClient();
 *   client.seedAgent("GXXX");
 *   await client.createRemittance({ ... });
 */

import type {
  Remittance,
  RemittanceStatus,
  EscrowStatus,
  AgentStats,
  CircuitBreakerStatus,
  HealthStatus,
  CreateRemittanceParams,
  BatchCreateEntry,
  GovernanceConfig,
  DailyLimitStatus,
  Proposal,
  ProposalAction,
  ProposalState,
  PartialPayoutRecord,
  FeeEstimate,
  Corridor,
  AssetVerification,
  VerificationStatus,
  PauseRecord,
  PauseReason,
  FeeStrategy,
  FeeCorridor,
  RateLimitConfig,
  RateLimitStatus,
  TransactionRecord,
  TransactionState,
  MigrationSnapshot,
  BatchSettlementEntry,
  BatchSettlementResult,
  Role,
  AdminOperationType,
  PendingOperation,
  FeeBreakdown,
} from "../types.js";
import { SwiftRemitError, ErrorCode } from "../errors.js";

// ─── Public result types ────────────────────────────────────────────────────

/** Returned by write operations on the mock client in place of a Stellar Transaction. */
export interface MockTxResult {
  /** Fake transaction hash generated for the operation. */
  txHash: string;
  /** The remittance ID that was created, if applicable. */
  id?: bigint;
}

export interface MockEscrow {
  id: bigint;
  sender: string;
  recipient: string;
  amount: bigint;
  status: EscrowStatus;
  createdAt: bigint;
  ttl: bigint;
}

export interface MockClientOptions {
  /** Initial platform fee in basis points (default: 100 = 1%). */
  feeBps?: number;
  /** Protocol fee in basis points (default: 0). */
  protocolFeeBps?: number;
}

// ─── Internal counters ──────────────────────────────────────────────────────

let _txCounter = 0;
function fakeTxHash(): string {
  return `MOCK_TX_${(++_txCounter).toString().padStart(8, "0")}`;
}

// ─── Valid state-machine transitions ────────────────────────────────────────

const VALID_TRANSITIONS: Record<RemittanceStatus, RemittanceStatus[]> = {
  Pending:    ["Processing", "Cancelled", "Failed"],
  Processing: ["Completed", "Cancelled", "Failed"],
  Completed:  [],
  Cancelled:  [],
  Failed:     ["Disputed"],
  Disputed:   ["Cancelled", "Completed"],
};

// ─── Main class ─────────────────────────────────────────────────────────────

export class SwiftRemitMockClient {
  // ── Core state ─────────────────────────────────────────────────────────────
  private readonly remittances  = new Map<bigint, Remittance>();
  private readonly escrows      = new Map<bigint, MockEscrow>();
  private readonly agents       = new Set<string>();
  private readonly tokens       = new Set<string>();
  private readonly admins       = new Set<string>();
  private readonly agentStats   = new Map<string, AgentStats>();
  private readonly dailyLimits  = new Map<string, { limit: bigint; used: bigint; resetsAt: Date }>();
  private readonly blacklist    = new Set<string>();
  private readonly kycApprovals = new Map<string, { approved: boolean; expiry: bigint }>();
  private readonly proposals    = new Map<bigint, Proposal>();
  private readonly votedBy      = new Map<string, Set<string>>(); // proposalId → voterAddresses
  private readonly agentDailyCaps = new Map<string, bigint>();
  private readonly agentKycHashes = new Map<string, string>();
  private readonly assetVerifications = new Map<string, AssetVerification>();
  private readonly feeCorridors = new Map<string, FeeCorridor>();
  private readonly pendingOperations = new Map<bigint, PendingOperation>();
  private readonly settlementHashes = new Map<bigint, string>();
  private readonly transactionRecords = new Map<bigint, TransactionRecord>();
  private readonly pauseRecords = new Map<bigint, PauseRecord>();

  private nextRemittanceId = 1n;
  private nextEscrowId     = 1n;
  private nextProposalId   = 1n;
  private nextOperationId  = 1n;
  private nextPauseSeq     = 0n;

  private _feeBps: number;
  private _protocolFeeBps: number;
  private _paused = false;
  private _pauseReason: PauseReason | null = null;
  private _totalVolume = 0n;
  private _inFlightVolume = 0n;
  private _platformFees = 0n;
  private _integratorFees = 0n;
  private _disputeWindowSeconds = 86_400n;
  private _escrowTtl = 86_400n;
  private _rateLimitCooldown = 0n;
  private _minAgentReputation = 0;
  private _feeStrategy: FeeStrategy = { Percentage: 0 };
  private _treasury = "";
  private _oracle: string | null = null;
  private _oracleRate: number | null = null;
  private _version = "0.0.0-mock";
  private _rateLimitConfig: RateLimitConfig = { maxRequests: 100, windowSeconds: 60n, enabled: false };
  private _cooldownPeriod = 0n;
  private _pauseTimelock = 0n;
  private _unpauseQuorum = 1;
  private _pauseVotes = new Set<string>();
  private _multisigThreshold = 1;
  private _multisigTtlSeconds = 3600n;
  private _maxExpiredBatchSize = 100;
  private _pendingAdminTransfer: string | null = null;
  private _governanceConfig: GovernanceConfig = {
    quorum: 2,
    timelockSeconds: 86_400n,
    proposalTtlSeconds: 604_800n,
  };

  // ── Fault-injection state ──────────────────────────────────────────────────
  private _failNextError: SwiftRemitError | null = null;
  private _delayNextMs: number | null = null;

  constructor(options: MockClientOptions = {}) {
    this._feeBps = options.feeBps ?? 100;
    this._protocolFeeBps = options.protocolFeeBps ?? 0;
  }

  // ─── Fault-injection helpers ───────────────────────────────────────────────

  /**
   * Make the very next call (read or write) throw `error`.
   * Clears automatically after one use.
   */
  failNext(error: SwiftRemitError): this {
    this._failNextError = error;
    return this;
  }

  /**
   * Make the very next call (read or write) wait `ms` milliseconds before
   * proceeding. Clears automatically after one use.
   */
  delayNext(ms: number): this {
    this._delayNextMs = ms;
    return this;
  }

  /**
   * Convenience wrapper: fail the next call with a specific error code.
   */
  throwError(code: ErrorCode): this {
    return this.failNext(new SwiftRemitError(code, `mock-injected: ${code}`));
  }

  /** Consume and apply any pending fault injection before a call. */
  private async _applyFaults(): Promise<void> {
    if (this._delayNextMs !== null) {
      const ms = this._delayNextMs;
      this._delayNextMs = null;
      await new Promise((r) => setTimeout(r, ms));
    }
    if (this._failNextError !== null) {
      const err = this._failNextError;
      this._failNextError = null;
      throw err;
    }
  }

  // ─── Seed helpers ──────────────────────────────────────────────────────────

  /** Pre-register an agent so `isAgentRegistered` returns true. Chainable. */
  seedAgent(address: string): this {
    this.agents.add(address);
    if (!this.agentStats.has(address)) {
      this.agentStats.set(address, {
        totalSettlements: 0,
        failedSettlements: 0,
        totalSettlementTime: 0n,
        disputeCount: 0,
        successRateBps: 10_000,
        lastActiveTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      });
    }
    return this;
  }

  /** Whitelist a token. Chainable. */
  seedToken(address: string): this {
    this.tokens.add(address);
    return this;
  }

  /** Add an admin address. Chainable. */
  seedAdmin(address: string): this {
    this.admins.add(address);
    return this;
  }

  /** Inject an existing remittance into state. Chainable. */
  seedRemittance(r: Remittance): this {
    this.remittances.set(r.id, r);
    if (r.id >= this.nextRemittanceId) this.nextRemittanceId = r.id + 1n;
    return this;
  }

  /** Inject an existing escrow into state. Chainable. */
  seedEscrow(e: MockEscrow): this {
    this.escrows.set(e.id, e);
    if (e.id >= this.nextEscrowId) this.nextEscrowId = e.id + 1n;
    return this;
  }

  /** Pre-seed accumulated platform fees. Chainable. */
  seedFees(amount: bigint): this {
    this._platformFees = amount;
    return this;
  }

  /** Pre-seed a daily limit for a corridor. Chainable. */
  seedDailyLimit(currency: string, country: string, limit: bigint): this {
    const key = `*:${currency}:${country}`;
    this.dailyLimits.set(key, {
      limit,
      used: 0n,
      resetsAt: new Date(Date.now() + 86_400_000),
    });
    return this;
  }

  /** Set the platform fee in basis points. Chainable. */
  setFeeBps(bps: number): this {
    this._feeBps = bps;
    return this;
  }

  /** Blacklist a user. Chainable. */
  seedBlacklist(address: string): this {
    this.blacklist.add(address);
    return this;
  }

  /** Set KYC status for a user. Chainable. */
  seedKyc(address: string, approved: boolean, expiryTimestamp: bigint): this {
    this.kycApprovals.set(address, { approved, expiry: expiryTimestamp });
    return this;
  }

  /** Return a snapshot of all remittances (useful for assertions). */
  getAllRemittances(): Remittance[] {
    return Array.from(this.remittances.values());
  }

  /** Return a snapshot of all escrows. */
  getAllEscrows(): MockEscrow[] {
    return Array.from(this.escrows.values());
  }

  // ─── Read operations ───────────────────────────────────────────────────────

  async getRemittance(_sourceAddress: string, remittanceId: bigint): Promise<Remittance> {
    await this._applyFaults();
    const r = this.remittances.get(remittanceId);
    if (!r) throw new SwiftRemitError(ErrorCode.RemittanceNotFound, `${remittanceId}`);
    return { ...r };
  }

  async getRemittancesBySender(
    _sourceAddress: string,
    sender: string,
    offset: bigint,
    limit: bigint,
  ): Promise<bigint[]> {
    await this._applyFaults();
    const ids = Array.from(this.remittances.values())
      .filter((r) => r.sender === sender)
      .map((r) => r.id);
    return ids.slice(Number(offset), Number(offset) + Number(limit));
  }

  async getRemittancesByAgent(
    _sourceAddress: string,
    agent: string,
    offset: bigint,
    limit: bigint,
  ): Promise<bigint[]> {
    await this._applyFaults();
    const ids = Array.from(this.remittances.values())
      .filter((r) => r.agent === agent)
      .map((r) => r.id);
    return ids.slice(Number(offset), Number(offset) + Number(limit));
  }

  async getAccumulatedFees(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this._platformFees;
  }

  async getAccumulatedIntegratorFees(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this._integratorFees;
  }

  async isAgentRegistered(_sourceAddress: string, agent: string): Promise<boolean> {
    await this._applyFaults();
    return this.agents.has(agent);
  }

  async isTokenWhitelisted(_sourceAddress: string, token: string): Promise<boolean> {
    await this._applyFaults();
    return this.tokens.has(token);
  }

  async getWhitelistedTokens(_sourceAddress: string): Promise<string[]> {
    await this._applyFaults();
    return Array.from(this.tokens);
  }

  async getPlatformFeeBps(_sourceAddress: string): Promise<number> {
    await this._applyFaults();
    return this._feeBps;
  }

  async getRemittanceCount(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return BigInt(this.remittances.size);
  }

  async getTotalVolume(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this._totalVolume;
  }

  async getInFlightVolume(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this._inFlightVolume;
  }

  async getAdminCount(_sourceAddress: string): Promise<number> {
    await this._applyFaults();
    return this.admins.size;
  }

  async health(_sourceAddress: string): Promise<HealthStatus> {
    await this._applyFaults();
    return {
      initialized: true,
      paused: this._paused,
      adminCount: this.admins.size,
      totalRemittances: BigInt(this.remittances.size),
      accumulatedFees: this._platformFees,
    };
  }

  async getAgentStats(_sourceAddress: string, agent: string): Promise<AgentStats> {
    await this._applyFaults();
    if (!this.agents.has(agent))
      throw new SwiftRemitError(ErrorCode.AgentNotRegistered, agent);
    return { ...this.agentStats.get(agent)! };
  }

  async getAgentReputation(_sourceAddress: string, agent: string): Promise<number> {
    await this._applyFaults();
    const stats = this.agentStats.get(agent);
    if (!stats) throw new SwiftRemitError(ErrorCode.AgentNotRegistered, agent);
    return Math.round(stats.successRateBps / 100);
  }

  async getCircuitBreakerStatus(_sourceAddress: string): Promise<CircuitBreakerStatus> {
    await this._applyFaults();
    return {
      isPaused: this._paused,
      pauseReason: this._pauseReason,
      pauseTimestamp: null,
      timelockSeconds: this._pauseTimelock,
      unpauseQuorum: this._unpauseQuorum,
      currentVoteCount: this._pauseVotes.size,
    };
  }

  async getAgentDailyCap(_sourceAddress: string, agent: string): Promise<bigint> {
    await this._applyFaults();
    return this.agentDailyCaps.get(agent) ?? 0n;
  }

  async getDisputeWindow(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this._disputeWindowSeconds;
  }

  async getDailyLimitStatus(
    _sourceAddress: string,
    sender: string,
    currency: string,
    country: string,
  ): Promise<DailyLimitStatus> {
    await this._applyFaults();
    const key = `${sender}:${currency}:${country}`;
    const corridorKey = `*:${currency}:${country}`;
    const entry =
      this.dailyLimits.get(key) ??
      this.dailyLimits.get(corridorKey) ??
      { limit: 0n, used: 0n, resetsAt: new Date(Date.now() + 86_400_000) };
    return {
      limit: entry.limit,
      used: entry.used,
      remaining:
        entry.limit === 0n
          ? BigInt(Number.MAX_SAFE_INTEGER)
          : entry.limit - entry.used,
      resetsAt: entry.resetsAt,
    };
  }

  async getRemittanceExpiryWindow(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return 0n;
  }

  async getPartialPayoutHistory(
    _sourceAddress: string,
    remittanceId: bigint,
  ): Promise<PartialPayoutRecord[]> {
    await this._applyFaults();
    if (!this.remittances.has(remittanceId))
      throw new SwiftRemitError(ErrorCode.RemittanceNotFound, `${remittanceId}`);
    return [];
  }

  async getGovernanceConfig(_sourceAddress: string): Promise<GovernanceConfig> {
    await this._applyFaults();
    return { ...this._governanceConfig };
  }

  async getProposal(_sourceAddress: string, proposalId: bigint): Promise<Proposal> {
    await this._applyFaults();
    const p = this.proposals.get(proposalId);
    if (!p) throw new SwiftRemitError(ErrorCode.ProposalNotFound, `${proposalId}`);
    return { ...p };
  }

  async getActiveProposals(_sourceAddress: string): Promise<Proposal[]> {
    await this._applyFaults();
    return Array.from(this.proposals.values()).filter(
      (p) => p.state === "Pending" || p.state === "Approved",
    );
  }

  async getVoteStatus(
    _sourceAddress: string,
    proposalId: bigint,
    voterAddress: string,
  ): Promise<boolean> {
    await this._applyFaults();
    return this.votedBy.get(String(proposalId))?.has(voterAddress) ?? false;
  }

  async isUserBlacklisted(_sourceAddress: string, user: string): Promise<boolean> {
    await this._applyFaults();
    return this.blacklist.has(user);
  }

  async isKycApproved(_sourceAddress: string, user: string): Promise<boolean> {
    await this._applyFaults();
    const entry = this.kycApprovals.get(user);
    if (!entry || !entry.approved) return false;
    const nowSecs = BigInt(Math.floor(Date.now() / 1000));
    return entry.expiry === 0n || entry.expiry > nowSecs;
  }

  async getAgentKycHash(_sourceAddress: string, agent: string): Promise<string | null> {
    await this._applyFaults();
    return this.agentKycHashes.get(agent) ?? null;
  }

  async isAdmin(_sourceAddress: string, address: string): Promise<boolean> {
    await this._applyFaults();
    return this.admins.has(address);
  }

  async hasRole(_sourceAddress: string, address: string, role: Role): Promise<boolean> {
    await this._applyFaults();
    if (role === "Admin") return this.admins.has(address);
    if (role === "Settler") return this.agents.has(address);
    return false;
  }

  async getAdminList(_sourceAddress: string): Promise<string[]> {
    await this._applyFaults();
    return Array.from(this.admins);
  }

  async isPaused(_sourceAddress: string): Promise<boolean> {
    await this._applyFaults();
    return this._paused;
  }

  async getCooldownPeriod(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this._cooldownPeriod;
  }

  async getCurrentPauseRecord(_sourceAddress: string): Promise<PauseRecord | null> {
    await this._applyFaults();
    if (!this._paused || this._pauseRecords_latest == null) return null;
    return this.pauseRecords.get(this._pauseRecords_latest) ?? null;
  }

  private _pauseRecords_latest: bigint | null = null;

  async getPauseRecord(_sourceAddress: string, seq: bigint): Promise<PauseRecord> {
    await this._applyFaults();
    const r = this.pauseRecords.get(seq);
    if (!r) throw new SwiftRemitError(ErrorCode.PauseRecordNotFound, `${seq}`);
    return { ...r };
  }

  async getPauseHistoryCount(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this.nextPauseSeq;
  }

  async getVersion(_sourceAddress: string): Promise<string> {
    await this._applyFaults();
    return this._version;
  }

  async getTreasury(_sourceAddress: string): Promise<string> {
    await this._applyFaults();
    return this._treasury;
  }

  async getProtocolFeeBps(_sourceAddress: string): Promise<number> {
    await this._applyFaults();
    return this._protocolFeeBps;
  }

  async getFeeStrategy(_sourceAddress: string): Promise<FeeStrategy> {
    await this._applyFaults();
    return this._feeStrategy;
  }

  async getFeeCorridor(
    _sourceAddress: string,
    fromCountry: string,
    toCountry: string,
  ): Promise<FeeCorridor | null> {
    await this._applyFaults();
    return this.feeCorridors.get(`${fromCountry}:${toCountry}`) ?? null;
  }

  async calculateFeeBreakdown(_sourceAddress: string, amount: bigint): Promise<FeeBreakdown> {
    await this._applyFaults();
    const platformFee = (amount * BigInt(this._feeBps)) / 10_000n;
    const protocolFee = (amount * BigInt(this._protocolFeeBps)) / 10_000n;
    return { platformFee, protocolFee, netAmount: amount - platformFee - protocolFee };
  }

  async feeBreakdownCorridor(
    _sourceAddress: string,
    amount: bigint,
    _corridor: FeeCorridor,
  ): Promise<FeeBreakdown> {
    await this._applyFaults();
    // Use global fee for simplicity in the mock
    const platformFee = (amount * BigInt(this._feeBps)) / 10_000n;
    const protocolFee = (amount * BigInt(this._protocolFeeBps)) / 10_000n;
    return { platformFee, protocolFee, netAmount: amount - platformFee - protocolFee };
  }

  async getRateLimitConfig(_sourceAddress: string): Promise<RateLimitConfig> {
    await this._applyFaults();
    return { ...this._rateLimitConfig };
  }

  async getRateLimitCooldown(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this._rateLimitCooldown;
  }

  async getRateLimitStatus(
    _sourceAddress: string,
    _address: string,
  ): Promise<RateLimitStatus> {
    await this._applyFaults();
    return {
      requestCount: 0,
      remaining: this._rateLimitConfig.maxRequests,
      resetAt: BigInt(Math.floor(Date.now() / 1000)) + this._rateLimitConfig.windowSeconds,
    };
  }

  async getDailyLimit(
    _sourceAddress: string,
    currency: string,
    country: string,
  ): Promise<bigint | null> {
    await this._applyFaults();
    const key = `*:${currency}:${country}`;
    return this.dailyLimits.get(key)?.limit ?? null;
  }

  async getMinAgentReputation(_sourceAddress: string): Promise<number> {
    await this._applyFaults();
    return this._minAgentReputation;
  }

  async getTokenFeeBps(_sourceAddress: string, _token: string): Promise<number | null> {
    await this._applyFaults();
    return null;
  }

  async getOracle(_sourceAddress: string): Promise<string | null> {
    await this._applyFaults();
    return this._oracle;
  }

  async getOracleRate(_sourceAddress: string): Promise<number | null> {
    await this._applyFaults();
    return this._oracleRate;
  }

  async getTransferState(_sourceAddress: string, transferId: bigint): Promise<RemittanceStatus | null> {
    await this._applyFaults();
    return this.remittances.get(transferId)?.status ?? null;
  }

  async getLastSettlementTime(_sourceAddress: string, _sender: string): Promise<bigint | null> {
    await this._applyFaults();
    return null;
  }

  async computeSettlementHash(_sourceAddress: string, remittanceId: bigint): Promise<string> {
    await this._applyFaults();
    this._requireRemittance(remittanceId);
    return `mock_settlement_hash_${remittanceId}`;
  }

  async getSettlementHash(_sourceAddress: string, remittanceId: bigint): Promise<string> {
    await this._applyFaults();
    const h = this.settlementHashes.get(remittanceId);
    if (!h) throw new SwiftRemitError(ErrorCode.RemittanceNotFound, `${remittanceId}`);
    return h;
  }

  async getAssetVerification(
    _sourceAddress: string,
    assetCode: string,
    issuer: string,
  ): Promise<AssetVerification> {
    await this._applyFaults();
    const r = this.assetVerifications.get(`${assetCode}:${issuer}`);
    if (!r) throw new SwiftRemitError(ErrorCode.AssetNotFound, `${assetCode}:${issuer}`);
    return { ...r };
  }

  async hasAssetVerification(
    _sourceAddress: string,
    assetCode: string,
    issuer: string,
  ): Promise<boolean> {
    await this._applyFaults();
    return this.assetVerifications.has(`${assetCode}:${issuer}`);
  }

  async getPendingOperation(_sourceAddress: string, operationId: bigint): Promise<PendingOperation> {
    await this._applyFaults();
    const op = this.pendingOperations.get(operationId);
    if (!op) throw new SwiftRemitError(ErrorCode.OperationNotFound, `${operationId}`);
    return { ...op };
  }

  async getTransactionStatus(_sourceAddress: string, remittanceId: bigint): Promise<TransactionRecord> {
    await this._applyFaults();
    const r = this.transactionRecords.get(remittanceId);
    if (!r) throw new SwiftRemitError(ErrorCode.TransactionNotFound, `${remittanceId}`);
    return { ...r };
  }

  async getQuorum(_sourceAddress: string): Promise<number> {
    await this._applyFaults();
    return this._governanceConfig.quorum;
  }

  async getTimelockSeconds(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this._governanceConfig.timelockSeconds;
  }

  async exportMigrationSnapshot(_caller: string): Promise<MigrationSnapshot> {
    await this._applyFaults();
    return {
      version: 1,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      ledgerSequence: 0,
      instanceData: {},
      persistentData: {},
      verificationHash: "mock_verification_hash",
    };
  }

  // ─── Escrow read operations ────────────────────────────────────────────────

  async getEscrow(_sourceAddress: string, transferId: bigint): Promise<MockEscrow> {
    await this._applyFaults();
    const e = this.escrows.get(transferId);
    if (!e) throw new SwiftRemitError(ErrorCode.EscrowNotFound, `${transferId}`);
    return { ...e };
  }

  async getEscrowTtl(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return this._escrowTtl;
  }

  async estimateFee(
    amount: bigint,
    _corridor: Corridor,
    _senderAddress: string,
  ): Promise<FeeEstimate> {
    await this._applyFaults();
    const platformFee = (amount * BigInt(this._feeBps)) / 10_000n;
    const protocolFee = (amount * BigInt(this._protocolFeeBps)) / 10_000n;
    const totalFee = platformFee + protocolFee;
    return {
      amount,
      platformFee,
      protocolFee,
      netAmount: amount - totalFee,
      totalFee,
      estimatedAt: new Date(),
      fromCache: false,
    };
  }

  // ─── Write operations (apply state directly, return MockTxResult) ────────────

  async createRemittance(params: CreateRemittanceParams): Promise<MockTxResult> {
    await this._applyFaults();
    if (this._paused)
      throw new SwiftRemitError(ErrorCode.ContractPaused, "paused");
    if (!this.agents.has(params.agent))
      throw new SwiftRemitError(ErrorCode.AgentNotRegistered, params.agent);
    if (params.amount <= 0n)
      throw new SwiftRemitError(ErrorCode.InvalidAmount, `${params.amount}`);
    if (this.blacklist.has(params.sender))
      throw new SwiftRemitError(ErrorCode.UserBlacklisted, params.sender);

    const kycEntry = this.kycApprovals.get(params.sender);
    if (kycEntry != null) {
      if (!kycEntry.approved)
        throw new SwiftRemitError(ErrorCode.KycNotApproved, params.sender);
      const nowSecs = BigInt(Math.floor(Date.now() / 1000));
      if (kycEntry.expiry !== 0n && kycEntry.expiry <= nowSecs)
        throw new SwiftRemitError(ErrorCode.KycExpired, params.sender);
    }

    const id = this.nextRemittanceId++;
    const fee = (params.amount * BigInt(this._feeBps)) / 10_000n;
    const now = BigInt(Math.floor(Date.now() / 1000));
    this.remittances.set(id, {
      id,
      sender: params.sender,
      agent: params.agent,
      amount: params.amount,
      fee,
      status: "Pending",
      expiry: params.expiry ?? null,
      token: params.token ?? "",
      createdAt: now,
      failedAt: null,
      expiresAt: params.expiry != null ? now + params.expiry : null,
    });
    return { txHash: fakeTxHash(), id };
  }

  async batchCreateRemittances(
    sender: string,
    entries: BatchCreateEntry[],
  ): Promise<MockTxResult> {
    await this._applyFaults();
    for (const e of entries) {
      await this.createRemittance({ sender, agent: e.agent, amount: e.amount, expiry: e.expiry });
    }
    return { txHash: fakeTxHash() };
  }

  async createBatchRemittance(
    sender: string,
    entries: BatchCreateEntry[],
  ): Promise<MockTxResult> {
    await this._applyFaults();
    return this.batchCreateRemittances(sender, entries);
  }

  async createRemittanceBatch(
    sender: string,
    entries: BatchCreateEntry[],
  ): Promise<{ results: Array<{ index: number; success: boolean; id?: bigint; error?: Error }>; successCount: number; failureCount: number }> {
    await this._applyFaults();
    const results = await Promise.all(
      entries.map(async (e, index) => {
        try {
          const result = await this.createRemittance({ sender, agent: e.agent, amount: e.amount, expiry: e.expiry });
          return { index, success: true, id: result.id };
        } catch (err) {
          return { index, success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      })
    );
    return {
      results,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
    };
  }

  async createRemittanceWithCorridor(
    sender: string,
    agent: string,
    amount: bigint,
    expiry?: bigint,
    _fromCountry?: string,
    _toCountry?: string,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    return this.createRemittance({ sender, agent, amount, expiry });
  }

  async confirmPayout(
    agent: string,
    remittanceId: bigint,
    _proof?: Buffer,
    _recipientDetailsHash?: Buffer,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    const r = this._requireRemittance(remittanceId);
    // Pending → Processing → Completed (mirrors on-chain two-step)
    this._transition(r, "Processing");
    const processing = { ...r, status: "Processing" as RemittanceStatus };
    this.remittances.set(remittanceId, processing);
    this._inFlightVolume += r.amount;

    this._transition(processing, "Completed");
    const fee = r.fee;
    this._platformFees += fee;
    this._totalVolume += r.amount;
    this._inFlightVolume -= r.amount;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const settlementHash = `settlement_${remittanceId}_${now}`;
    this.remittances.set(remittanceId, { ...processing, status: "Completed" });
    this.settlementHashes.set(remittanceId, settlementHash);
    this._bumpAgentStats(agent, true, r.amount);
    return { txHash: fakeTxHash() };
  }

  async confirmPartialPayout(
    _agent: string,
    remittanceId: bigint,
    _amount: bigint,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    const r = this._requireRemittance(remittanceId);
    if (r.status !== "Pending" && r.status !== "Processing")
      throw new SwiftRemitError(
        ErrorCode.InvalidStatus,
        `Expected Pending or Processing, got ${r.status}`,
      );
    return { txHash: fakeTxHash() };
  }

  async confirmBatchPayout(agent: string, remittanceIds: bigint[]): Promise<MockTxResult> {
    await this._applyFaults();
    for (const id of remittanceIds) {
      await this.confirmPayout(agent, id);
    }
    return { txHash: fakeTxHash() };
  }

  async cancelRemittance(_sender: string, remittanceId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const r = this._requireRemittance(remittanceId);
    this._transition(r, "Cancelled");
    this.remittances.set(remittanceId, { ...r, status: "Cancelled" });
    return { txHash: fakeTxHash() };
  }

  async markFailed(_agent: string, remittanceId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const r = this._requireRemittance(remittanceId);
    this._transition(r, "Failed");
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (r.status === "Processing") this._inFlightVolume -= r.amount;
    this.remittances.set(remittanceId, { ...r, status: "Failed", failedAt: now });
    this._bumpAgentStats(_agent, false, 0n);
    return { txHash: fakeTxHash() };
  }

  async raiseDispute(
    _sender: string,
    remittanceId: bigint,
    _evidenceHash: Buffer,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    const r = this._requireRemittance(remittanceId);
    this._transition(r, "Disputed");
    this.remittances.set(remittanceId, { ...r, status: "Disputed" });
    return { txHash: fakeTxHash() };
  }

  async resolveDispute(
    _admin: string,
    remittanceId: bigint,
    inFavourOfSender: boolean,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    const r = this._requireRemittance(remittanceId);
    const target: RemittanceStatus = inFavourOfSender ? "Cancelled" : "Completed";
    this._transition(r, target);
    if (target === "Completed") {
      this._platformFees += r.fee;
      this._totalVolume += r.amount;
    }
    this.remittances.set(remittanceId, { ...r, status: target });
    return { txHash: fakeTxHash() };
  }

  async expireRemittance(_caller: string, remittanceId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const r = this._requireRemittance(remittanceId);
    this._transition(r, "Cancelled");
    this.remittances.set(remittanceId, { ...r, status: "Cancelled" });
    return { txHash: fakeTxHash() };
  }

  async processExpiredRemittances(
    caller: string,
    remittanceIds: bigint[],
  ): Promise<MockTxResult> {
    await this._applyFaults();
    for (const id of remittanceIds) {
      const r = this.remittances.get(id);
      if (r && r.status === "Pending") {
        this.remittances.set(id, { ...r, status: "Cancelled" });
      }
    }
    void caller;
    return { txHash: fakeTxHash() };
  }

  async finalizeRemittance(_caller: string, remittanceId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const r = this._requireRemittance(remittanceId);
    if (r.status !== "Completed")
      throw new SwiftRemitError(ErrorCode.InvalidStatus, `Expected Completed, got ${r.status}`);
    return { txHash: fakeTxHash() };
  }

  async withdrawFees(_admin: string, _to: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (this._platformFees === 0n)
      throw new SwiftRemitError(ErrorCode.NoFeesToWithdraw, "0");
    this._platformFees = 0n;
    return { txHash: fakeTxHash() };
  }

  async withdrawIntegratorFees(_integrator: string, _to: string): Promise<MockTxResult> {
    await this._applyFaults();
    this._integratorFees = 0n;
    return { txHash: fakeTxHash() };
  }

  async registerAgent(_admin: string, agent: string, kycHash?: Buffer): Promise<MockTxResult> {
    await this._applyFaults();
    if (this.agents.has(agent))
      throw new SwiftRemitError(ErrorCode.AgentAlreadyRegistered, agent);
    this.seedAgent(agent);
    if (kycHash) {
      this.agentKycHashes.set(agent, kycHash.toString("hex"));
    }
    return { txHash: fakeTxHash() };
  }

  async removeAgent(_admin: string, agent: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (!this.agents.has(agent))
      throw new SwiftRemitError(ErrorCode.AgentNotRegistered, agent);
    this.agents.delete(agent);
    return { txHash: fakeTxHash() };
  }

  async updateFee(_admin: string, feeBps: number): Promise<MockTxResult> {
    await this._applyFaults();
    if (feeBps < 0 || feeBps > 10_000)
      throw new SwiftRemitError(ErrorCode.InvalidFeeBps, `${feeBps}`);
    this._feeBps = feeBps;
    return { txHash: fakeTxHash() };
  }

  async updateProtocolFee(_caller: string, feeBps: number): Promise<MockTxResult> {
    await this._applyFaults();
    if (feeBps < 0 || feeBps > 10_000)
      throw new SwiftRemitError(ErrorCode.InvalidFeeBps, `${feeBps}`);
    this._protocolFeeBps = feeBps;
    return { txHash: fakeTxHash() };
  }

  async updateTokenFee(_caller: string, _token: string, _feeBps: number): Promise<MockTxResult> {
    await this._applyFaults();
    return { txHash: fakeTxHash() };
  }

  async updateTreasury(_caller: string, treasury: string): Promise<MockTxResult> {
    await this._applyFaults();
    this._treasury = treasury;
    return { txHash: fakeTxHash() };
  }

  async updateFeeStrategy(_caller: string, strategy: FeeStrategy): Promise<MockTxResult> {
    await this._applyFaults();
    this._feeStrategy = strategy;
    return { txHash: fakeTxHash() };
  }

  async setFeeCorridor(_caller: string, corridor: FeeCorridor): Promise<MockTxResult> {
    await this._applyFaults();
    this.feeCorridors.set(`${corridor.fromCountry}:${corridor.toCountry}`, { ...corridor });
    return { txHash: fakeTxHash() };
  }

  async removeFeeCorridor(_caller: string, fromCountry: string, toCountry: string): Promise<MockTxResult> {
    await this._applyFaults();
    this.feeCorridors.delete(`${fromCountry}:${toCountry}`);
    return { txHash: fakeTxHash() };
  }

  async setDailyLimit(
    _admin: string,
    currency: string,
    country: string,
    limit: bigint,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    const key = `*:${currency}:${country}`;
    this.dailyLimits.set(key, {
      limit,
      used: 0n,
      resetsAt: new Date(Date.now() + 86_400_000),
    });
    return { txHash: fakeTxHash() };
  }

  async setAgentDailyCap(
    _admin: string,
    agent: string,
    cap: bigint,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    this.agentDailyCaps.set(agent, cap);
    return { txHash: fakeTxHash() };
  }

  async setMinAgentReputation(_admin: string, threshold: number): Promise<MockTxResult> {
    await this._applyFaults();
    this._minAgentReputation = threshold;
    return { txHash: fakeTxHash() };
  }

  async setDisputeWindow(_admin: string, seconds: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    this._disputeWindowSeconds = seconds;
    return { txHash: fakeTxHash() };
  }

  async setMaxExpiredBatchSize(_admin: string, size: number): Promise<MockTxResult> {
    await this._applyFaults();
    if (size < 1 || size > 200)
      throw new SwiftRemitError(ErrorCode.InvalidBatchSize, `${size}`);
    this._maxExpiredBatchSize = size;
    return { txHash: fakeTxHash() };
  }

  async addAdmin(_caller: string, newAdmin: string): Promise<MockTxResult> {
    await this._applyFaults();
    this.admins.add(newAdmin);
    return { txHash: fakeTxHash() };
  }

  async removeAdmin(_caller: string, adminToRemove: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (!this.admins.has(adminToRemove))
      throw new SwiftRemitError(ErrorCode.AdminNotFound, adminToRemove);
    if (this.admins.size <= 1)
      throw new SwiftRemitError(ErrorCode.CannotRemoveLastAdmin, adminToRemove);
    this.admins.delete(adminToRemove);
    return { txHash: fakeTxHash() };
  }

  async proposeAdmin(_admin: string, newAdmin: string): Promise<MockTxResult> {
    await this._applyFaults();
    this._pendingAdminTransfer = newAdmin;
    return { txHash: fakeTxHash() };
  }

  async acceptAdmin(newAdmin: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (this._pendingAdminTransfer !== newAdmin)
      throw new SwiftRemitError(ErrorCode.NoPendingAdminTransfer, newAdmin);
    this.admins.add(newAdmin);
    this._pendingAdminTransfer = null;
    return { txHash: fakeTxHash() };
  }

  async assignRole(_caller: string, address: string, role: Role): Promise<MockTxResult> {
    await this._applyFaults();
    if (role === "Admin") this.admins.add(address);
    else if (role === "Settler") this.seedAgent(address);
    return { txHash: fakeTxHash() };
  }

  async removeRole(_caller: string, address: string, role: Role): Promise<MockTxResult> {
    await this._applyFaults();
    if (role === "Admin") this.admins.delete(address);
    else if (role === "Settler") this.agents.delete(address);
    return { txHash: fakeTxHash() };
  }

  async addWhitelistedToken(_admin: string, token: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (this.tokens.has(token))
      throw new SwiftRemitError(ErrorCode.TokenAlreadyWhitelisted, token);
    this.tokens.add(token);
    return { txHash: fakeTxHash() };
  }

  async removeWhitelistedToken(_admin: string, token: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (!this.tokens.has(token))
      throw new SwiftRemitError(ErrorCode.TokenNotWhitelisted, token);
    this.tokens.delete(token);
    return { txHash: fakeTxHash() };
  }

  async extendStorageTtl(_admin: string, _extendByLedgers: number): Promise<MockTxResult> {
    await this._applyFaults();
    return { txHash: fakeTxHash() };
  }

  async initialize(_admin: string, _params: unknown): Promise<MockTxResult> {
    await this._applyFaults();
    return { txHash: fakeTxHash() };
  }

  // ─── Escrow write operations ────────────────────────────────────────────────

  async createEscrow(
    sender: string,
    recipient: string,
    amount: bigint,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    if (amount <= 0n)
      throw new SwiftRemitError(ErrorCode.InvalidAmount, `${amount}`);
    const id = this.nextEscrowId++;
    const now = BigInt(Math.floor(Date.now() / 1000));
    this.escrows.set(id, {
      id,
      sender,
      recipient,
      amount,
      status: "Pending",
      createdAt: now,
      ttl: this._escrowTtl,
    });
    return { txHash: fakeTxHash(), id };
  }

  async releaseEscrow(_admin: string, transferId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const e = this._requireEscrow(transferId);
    if (e.status !== "Pending")
      throw new SwiftRemitError(ErrorCode.InvalidEscrowStatus, `${e.status}`);
    this.escrows.set(transferId, { ...e, status: "Released" });
    return { txHash: fakeTxHash() };
  }

  async refundEscrow(_sender: string, transferId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const e = this._requireEscrow(transferId);
    if (e.status !== "Pending")
      throw new SwiftRemitError(ErrorCode.InvalidEscrowStatus, `${e.status}`);
    this.escrows.set(transferId, { ...e, status: "Refunded" });
    return { txHash: fakeTxHash() };
  }

  async updateEscrowTtl(_admin: string, ttl: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    this._escrowTtl = ttl;
    return { txHash: fakeTxHash() };
  }

  async processExpiredEscrows(
    _caller: string,
    transferIds: bigint[],
  ): Promise<MockTxResult> {
    await this._applyFaults();
    for (const id of transferIds) {
      const e = this.escrows.get(id);
      if (e && e.status === "Pending") {
        this.escrows.set(id, { ...e, status: "Refunded" });
      }
    }
    return { txHash: fakeTxHash() };
  }

  // ─── Governance write operations ────────────────────────────────────────────

  async propose(sourceAddress: string, action: ProposalAction): Promise<MockTxResult> {
    await this._applyFaults();
    const id = this.nextProposalId++;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const proposal: Proposal = {
      id,
      proposer: sourceAddress,
      action,
      state: "Pending",
      createdAt: now,
      expiry: now + this._governanceConfig.proposalTtlSeconds,
      approvalCount: 0,
      approvalTimestamp: null,
      executeAfter: null,
    };
    this.proposals.set(id, proposal);
    this.votedBy.set(String(id), new Set());
    return { txHash: fakeTxHash(), id };
  }

  async voteOnProposal(sourceAddress: string, proposalId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const p = this.proposals.get(proposalId);
    if (!p) throw new SwiftRemitError(ErrorCode.ProposalNotFound, `${proposalId}`);
    if (p.state !== "Pending")
      throw new SwiftRemitError(ErrorCode.InvalidProposalState, p.state);

    const voters = this.votedBy.get(String(proposalId))!;
    if (voters.has(sourceAddress))
      throw new SwiftRemitError(ErrorCode.AlreadyVoted, sourceAddress);

    voters.add(sourceAddress);
    const newCount = p.approvalCount + 1;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const newState: ProposalState =
      newCount >= this._governanceConfig.quorum ? "Approved" : "Pending";
    const executeAfter =
      newState === "Approved"
        ? now + this._governanceConfig.timelockSeconds
        : null;
    this.proposals.set(proposalId, {
      ...p,
      approvalCount: newCount,
      state: newState,
      approvalTimestamp: newState === "Approved" ? now : null,
      executeAfter,
    });
    return { txHash: fakeTxHash() };
  }

  async executeProposal(_sourceAddress: string, proposalId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const p = this.proposals.get(proposalId);
    if (!p) throw new SwiftRemitError(ErrorCode.ProposalNotFound, `${proposalId}`);
    if (p.state !== "Approved")
      throw new SwiftRemitError(ErrorCode.InvalidProposalState, p.state);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (p.executeAfter != null && now < p.executeAfter)
      throw new SwiftRemitError(ErrorCode.TimelockActive, `${p.executeAfter}`);
    this.proposals.set(proposalId, { ...p, state: "Executed" });
    return { txHash: fakeTxHash() };
  }

  async expireProposal(_caller: string, proposalId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const p = this.proposals.get(proposalId);
    if (!p) throw new SwiftRemitError(ErrorCode.ProposalNotFound, `${proposalId}`);
    this.proposals.set(proposalId, { ...p, state: "Expired" });
    return { txHash: fakeTxHash() };
  }

  async cleanupExpiredProposals(_caller: string, proposalIds: bigint[]): Promise<MockTxResult> {
    await this._applyFaults();
    for (const id of proposalIds) {
      const p = this.proposals.get(id);
      if (p && (p.state === "Executed" || p.state === "Expired")) {
        this.proposals.delete(id);
      }
    }
    return { txHash: fakeTxHash() };
  }

  async migrateToGovernance(
    _caller: string,
    quorum: number,
    timelockSeconds: bigint,
    proposalTtlSeconds: bigint,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    this._governanceConfig = { quorum, timelockSeconds, proposalTtlSeconds };
    return { txHash: fakeTxHash() };
  }

  // ─── Multi-sig admin operations ─────────────────────────────────────────────

  async proposeOperation(
    proposer: string,
    operationType: AdminOperationType,
    feeBps: number,
    withdrawTo?: string,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    const id = this.nextOperationId++;
    const now = BigInt(Math.floor(Date.now() / 1000));
    this.pendingOperations.set(id, {
      id,
      operationType,
      proposer,
      approvers: [proposer],
      threshold: this._multisigThreshold,
      proposedAt: now,
      ttlSeconds: this._multisigTtlSeconds,
      feeBps,
      withdrawTo: withdrawTo ?? null,
    });
    return { txHash: fakeTxHash(), id };
  }

  async approveOperation(approver: string, operationId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const op = this.pendingOperations.get(operationId);
    if (!op) throw new SwiftRemitError(ErrorCode.OperationNotFound, `${operationId}`);
    if (op.approvers.includes(approver))
      throw new SwiftRemitError(ErrorCode.AlreadyApproved, approver);
    this.pendingOperations.set(operationId, { ...op, approvers: [...op.approvers, approver] });
    return { txHash: fakeTxHash() };
  }

  async expireOperation(_caller: string, operationId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const op = this.pendingOperations.get(operationId);
    if (!op) throw new SwiftRemitError(ErrorCode.OperationNotFound, `${operationId}`);
    this.pendingOperations.delete(operationId);
    return { txHash: fakeTxHash() };
  }

  async setMultisigConfig(_caller: string, threshold: number, ttlSeconds: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    this._multisigThreshold = threshold;
    this._multisigTtlSeconds = ttlSeconds;
    return { txHash: fakeTxHash() };
  }

  // ─── Blacklist / KYC write operations ─────────────────────────────────────

  async blacklistUser(_admin: string, user: string): Promise<MockTxResult> {
    await this._applyFaults();
    this.blacklist.add(user);
    return { txHash: fakeTxHash() };
  }

  async removeFromBlacklist(_admin: string, user: string): Promise<MockTxResult> {
    await this._applyFaults();
    this.blacklist.delete(user);
    return { txHash: fakeTxHash() };
  }

  async setUserBlacklisted(_admin: string, user: string, blacklisted: boolean): Promise<MockTxResult> {
    await this._applyFaults();
    if (blacklisted) this.blacklist.add(user);
    else this.blacklist.delete(user);
    return { txHash: fakeTxHash() };
  }

  async setKycApproved(
    _admin: string,
    user: string,
    approved: boolean,
    expiry: bigint,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    this.kycApprovals.set(user, { approved, expiry });
    return { txHash: fakeTxHash() };
  }

  // ─── Circuit breaker write operations ─────────────────────────────────────

  async pause(_admin: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (this._paused)
      throw new SwiftRemitError(ErrorCode.AlreadyPaused, "already paused");
    this._paused = true;
    return { txHash: fakeTxHash() };
  }

  async unpause(_admin: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (!this._paused)
      throw new SwiftRemitError(ErrorCode.NotPaused, "not paused");
    this._paused = false;
    this._pauseReason = null;
    this._pauseVotes.clear();
    return { txHash: fakeTxHash() };
  }

  async emergencyPause(caller: string, reason: PauseReason): Promise<MockTxResult> {
    await this._applyFaults();
    if (this._paused)
      throw new SwiftRemitError(ErrorCode.AlreadyPaused, "already paused");
    this._paused = true;
    this._pauseReason = reason;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const seq = this.nextPauseSeq++;
    const record: PauseRecord = { seq, caller, timestamp: now, reason };
    this.pauseRecords.set(seq, record);
    this._pauseRecords_latest = seq;
    return { txHash: fakeTxHash() };
  }

  async emergencyUnpause(caller: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (!this._paused)
      throw new SwiftRemitError(ErrorCode.NotPaused, "not paused");
    void caller;
    this._paused = false;
    this._pauseReason = null;
    this._pauseVotes.clear();
    this._pauseRecords_latest = null;
    return { txHash: fakeTxHash() };
  }

  async voteUnpause(caller: string): Promise<MockTxResult> {
    await this._applyFaults();
    if (!this._paused)
      throw new SwiftRemitError(ErrorCode.NotPaused, "not paused");
    this._pauseVotes.add(caller);
    if (this._pauseVotes.size >= this._unpauseQuorum) {
      this._paused = false;
      this._pauseReason = null;
      this._pauseVotes.clear();
      this._pauseRecords_latest = null;
    }
    return { txHash: fakeTxHash() };
  }

  async setPauseTimelock(_caller: string, seconds: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    this._pauseTimelock = seconds;
    return { txHash: fakeTxHash() };
  }

  async setUnpauseQuorum(_caller: string, quorum: number): Promise<MockTxResult> {
    await this._applyFaults();
    this._unpauseQuorum = quorum;
    return { txHash: fakeTxHash() };
  }

  async setCooldownPeriod(_caller: string, seconds: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    this._cooldownPeriod = seconds;
    return { txHash: fakeTxHash() };
  }

  // ─── Asset verification write operations ───────────────────────────────────

  async setAssetVerification(
    _admin: string,
    assetCode: string,
    issuer: string,
    status: VerificationStatus,
    reputationScore: number,
    trustlineCount: bigint,
    hasToml: boolean,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    const now = BigInt(Math.floor(Date.now() / 1000));
    this.assetVerifications.set(`${assetCode}:${issuer}`, {
      assetCode,
      issuer,
      status,
      reputationScore,
      lastVerified: now,
      trustlineCount,
      hasToml,
    });
    return { txHash: fakeTxHash() };
  }

  async validateAssetSafety(_caller: string, assetCode: string, issuer: string): Promise<MockTxResult> {
    await this._applyFaults();
    const v = this.assetVerifications.get(`${assetCode}:${issuer}`);
    if (v?.status === "Suspicious")
      throw new SwiftRemitError(ErrorCode.SuspiciousAsset, `${assetCode}:${issuer}`);
    return { txHash: fakeTxHash() };
  }

  // ─── Rate limiting write operations ────────────────────────────────────────

  async updateRateLimitConfig(
    _caller: string,
    maxRequests: number,
    windowSeconds: bigint,
    enabled: boolean,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    this._rateLimitConfig = { maxRequests, windowSeconds, enabled };
    return { txHash: fakeTxHash() };
  }

  async updateRateLimit(_admin: string, cooldownSeconds: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    this._rateLimitCooldown = cooldownSeconds;
    return { txHash: fakeTxHash() };
  }

  async cleanupRateLimitEntries(_caller: string, _address: string): Promise<MockTxResult> {
    await this._applyFaults();
    return { txHash: fakeTxHash() };
  }

  // ─── Oracle write operations ────────────────────────────────────────────────

  async setOracle(_caller: string, oracle: string, _stalenessWindowLedgers?: number): Promise<MockTxResult> {
    await this._applyFaults();
    this._oracle = oracle;
    return { txHash: fakeTxHash() };
  }

  // ─── Transaction controller ─────────────────────────────────────────────────

  async executeTransaction(
    user: string,
    agent: string,
    amount: bigint,
    expiry?: bigint,
  ): Promise<MockTxResult> {
    await this._applyFaults();
    const result = await this.createRemittance({ sender: user, agent, amount, expiry });
    if (result.id != null) {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const state: TransactionState = { ContractCalled: result.id };
      this.transactionRecords.set(result.id, {
        user,
        agent,
        amount,
        remittanceId: result.id,
        anchorTxId: null,
        state,
        retryCount: 0,
        timestamp: now,
      });
    }
    return result;
  }

  async retryTransaction(_caller: string, remittanceId: bigint): Promise<MockTxResult> {
    await this._applyFaults();
    const record = this.transactionRecords.get(remittanceId);
    if (!record) throw new SwiftRemitError(ErrorCode.TransactionNotFound, `${remittanceId}`);
    this.transactionRecords.set(remittanceId, { ...record, retryCount: record.retryCount + 1 });
    return { txHash: fakeTxHash() };
  }

  // ─── Settlement / netting ────────────────────────────────────────────────────

  async batchSettleWithNetting(
    _caller: string,
    entries: BatchSettlementEntry[],
  ): Promise<BatchSettlementResult> {
    await this._applyFaults();
    const settledIds: bigint[] = [];
    for (const entry of entries) {
      const r = this.remittances.get(entry.remittanceId);
      if (r && r.status === "Pending") {
        await this.confirmPayout(r.agent, entry.remittanceId);
        settledIds.push(entry.remittanceId);
      }
    }
    return { settledIds };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _requireRemittance(id: bigint): Remittance {
    const r = this.remittances.get(id);
    if (!r) throw new SwiftRemitError(ErrorCode.RemittanceNotFound, `${id}`);
    return r;
  }

  private _requireEscrow(id: bigint): MockEscrow {
    const e = this.escrows.get(id);
    if (!e) throw new SwiftRemitError(ErrorCode.EscrowNotFound, `${id}`);
    return e;
  }

  /**
   * Assert that transitioning `r` to `target` is a valid state-machine move.
   * Throws InvalidStateTransition if the move is illegal.
   */
  private _transition(r: Remittance, target: RemittanceStatus): void {
    if (!VALID_TRANSITIONS[r.status].includes(target)) {
      throw new SwiftRemitError(
        ErrorCode.InvalidStateTransition,
        `${r.status} → ${target} is not a valid transition`,
      );
    }
  }

  private _bumpAgentStats(agent: string, success: boolean, _amount: bigint): void {
    const stats = this.agentStats.get(agent);
    if (!stats) return;
    stats.totalSettlements++;
    if (!success) stats.failedSettlements++;
    stats.successRateBps =
      stats.totalSettlements === 0
        ? 10_000
        : Math.round(
            ((stats.totalSettlements - stats.failedSettlements) /
              stats.totalSettlements) *
              10_000,
          );
    stats.lastActiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
  }
}