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
  BatchCreateResponse,
  BatchCreateResult,
  GovernanceConfig,
  DailyLimitStatus,
  Proposal,
  ProposalAction,
  ProposalState,
  PartialPayoutRecord,
  FeeEstimate,
  Corridor,
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

  private nextRemittanceId = 1n;
  private nextEscrowId     = 1n;
  private nextProposalId   = 1n;

  private _feeBps: number;
  private _protocolFeeBps: number;
  private _paused = false;
  private _totalVolume = 0n;
  private _inFlightVolume = 0n;
  private _platformFees = 0n;
  private _integratorFees = 0n;
  private _disputeWindowSeconds = 86_400n;
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
      pauseReason: null,
      pauseTimestamp: null,
      timelockSeconds: 86_400n,
      unpauseQuorum: 2,
      currentVoteCount: 0,
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

  // ─── Escrow read operations ────────────────────────────────────────────────

  async getEscrow(_sourceAddress: string, transferId: bigint): Promise<MockEscrow> {
    await this._applyFaults();
    const e = this.escrows.get(transferId);
    if (!e) throw new SwiftRemitError(ErrorCode.EscrowNotFound, `${transferId}`);
    return { ...e };
  }

  async getEscrowTtl(_sourceAddress: string): Promise<bigint> {
    await this._applyFaults();
    return 86_400n;
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
    for (const e of entries) {
      await this.createRemittance({ sender, agent: e.agent, amount: e.amount, expiry: e.expiry });
    }
    return { txHash: fakeTxHash() };
  }

  async createRemittanceBatch(
    sender: string,
    entries: BatchCreateEntry[],
  ): Promise<BatchCreateResponse> {
    await this._applyFaults();
    const results: BatchCreateResult[] = [];
    
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      try {
        const result = await this.createRemittance({
          sender,
          agent: entry.agent,
          amount: entry.amount,
          expiry: entry.expiry,
        });
        results.push({
          index,
          entry,
          success: true,
          tx: { txHash: result.txHash, id: result.id },
        });
      } catch (err) {
        results.push({
          index,
          entry,
          success: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    return {
      results,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
    };
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
    this.remittances.set(remittanceId, { ...processing, status: "Completed" });
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

  async registerAgent(_admin: string, agent: string, _kycHash?: Buffer): Promise<MockTxResult> {
    await this._applyFaults();
    if (this.agents.has(agent))
      throw new SwiftRemitError(ErrorCode.AgentAlreadyRegistered, agent);
    this.seedAgent(agent);
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

  async addAdmin(_caller: string, newAdmin: string): Promise<MockTxResult> {
    await this._applyFaults();
    this.admins.add(newAdmin);
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
      ttl: 86_400n,
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
    return { txHash: fakeTxHash() };
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
