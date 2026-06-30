/**
 * In-memory mock implementation of SwiftRemitClient for integration testing.
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
  AgentStats,
  CircuitBreakerStatus,
  HealthStatus,
  CreateRemittanceParams,
  BatchCreateEntry,
  GovernanceConfig,
  DailyLimitStatus,
  Proposal,
  PartialPayoutRecord,
  FeeEstimate,
  Corridor,
} from "../types.js";
import { SwiftRemitError, ErrorCode } from "../errors.js";

/** Returned by write operations on the mock client in place of a Stellar Transaction. */
export interface MockTxResult {
  /** Fake transaction hash generated for the operation. */
  txHash: string;
  /** The remittance ID that was created, if applicable. */
  id?: bigint;
}

let _txCounter = 0;
function fakeTxHash(): string {
  return `MOCK_TX_${(++_txCounter).toString().padStart(8, "0")}`;
}

export interface MockClientOptions {
  /** Initial platform fee in basis points (default: 100 = 1%). */
  feeBps?: number;
  /** Protocol fee in basis points (default: 0). */
  protocolFeeBps?: number;
}

/**
 * In-memory SwiftRemit client for integration tests.
 *
 * Write operations directly apply state mutations and return a {@link MockTxResult}.
 * Read operations mirror the real client's signatures exactly.
 */
export class SwiftRemitMockClient {
  private readonly remittances = new Map<bigint, Remittance>();
  private readonly agents = new Set<string>();
  private readonly tokens = new Set<string>();
  private readonly admins = new Set<string>();
  private readonly agentStats = new Map<string, AgentStats>();
  private readonly dailyLimits = new Map<string, { limit: bigint; used: bigint; resetsAt: Date }>();
  private nextId = 1n;
  private _feeBps: number;
  private _protocolFeeBps: number;
  private _paused = false;
  private _totalVolume = 0n;
  private _platformFees = 0n;
  private _integratorFees = 0n;

  constructor(options: MockClientOptions = {}) {
    this._feeBps = options.feeBps ?? 100;
    this._protocolFeeBps = options.protocolFeeBps ?? 0;
  }

  // ─── Seed helpers ─────────────────────────────────────────────────────────────

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
        lastActiveTimestamp: BigInt(Date.now()),
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
    if (r.id >= this.nextId) this.nextId = r.id + 1n;
    return this;
  }

  /** Set the platform fee in basis points. Chainable. */
  setFeeBps(bps: number): this {
    this._feeBps = bps;
    return this;
  }

  /** Return a snapshot of all remittances (useful for assertions). */
  getAllRemittances(): Remittance[] {
    return Array.from(this.remittances.values());
  }

  // ─── Read operations (match SwiftRemitClient signatures exactly) ──────────────

  async getRemittance(_sourceAddress: string, remittanceId: bigint): Promise<Remittance> {
    const r = this.remittances.get(remittanceId);
    if (!r) throw new SwiftRemitError(ErrorCode.RemittanceNotFound, `${remittanceId}`);
    return { ...r };
  }

  async getRemittancesBySender(
    _sourceAddress: string,
    sender: string,
    offset: bigint,
    limit: bigint
  ): Promise<bigint[]> {
    const ids = Array.from(this.remittances.values())
      .filter((r) => r.sender === sender)
      .map((r) => r.id);
    return ids.slice(Number(offset), Number(offset) + Number(limit));
  }

  async getAccumulatedFees(_sourceAddress: string): Promise<bigint> {
    return this._platformFees;
  }

  async getAccumulatedIntegratorFees(_sourceAddress: string): Promise<bigint> {
    return this._integratorFees;
  }

  async isAgentRegistered(_sourceAddress: string, agent: string): Promise<boolean> {
    return this.agents.has(agent);
  }

  async isTokenWhitelisted(_sourceAddress: string, token: string): Promise<boolean> {
    return this.tokens.has(token);
  }

  async getPlatformFeeBps(_sourceAddress: string): Promise<number> {
    return this._feeBps;
  }

  async getRemittanceCount(_sourceAddress: string): Promise<bigint> {
    return BigInt(this.remittances.size);
  }

  async getTotalVolume(_sourceAddress: string): Promise<bigint> {
    return this._totalVolume;
  }

  async getAdminCount(_sourceAddress: string): Promise<number> {
    return this.admins.size;
  }

  async health(_sourceAddress: string): Promise<HealthStatus> {
    return {
      initialized: true,
      paused: this._paused,
      adminCount: this.admins.size,
      totalRemittances: BigInt(this.remittances.size),
      accumulatedFees: this._platformFees,
    };
  }

  async getAgentStats(_sourceAddress: string, agent: string): Promise<AgentStats> {
    if (!this.agents.has(agent))
      throw new SwiftRemitError(ErrorCode.AgentNotRegistered, agent);
    return this.agentStats.get(agent)!;
  }

  async getAgentReputation(_sourceAddress: string, agent: string): Promise<number> {
    const stats = this.agentStats.get(agent);
    if (!stats) throw new SwiftRemitError(ErrorCode.AgentNotRegistered, agent);
    return Math.round(stats.successRateBps / 100);
  }

  async getCircuitBreakerStatus(_sourceAddress: string): Promise<CircuitBreakerStatus> {
    return {
      isPaused: this._paused,
      pauseReason: null,
      pauseTimestamp: null,
      timelockSeconds: 86_400n,
      unpauseQuorum: 2,
      currentVoteCount: 0,
    };
  }

  async getAgentDailyCap(_sourceAddress: string, _agent: string): Promise<bigint> {
    return 0n;
  }

  async getDisputeWindow(_sourceAddress: string): Promise<bigint> {
    return 86_400n;
  }

  async getDailyLimitStatus(
    _sourceAddress: string,
    sender: string,
    currency: string,
    country: string
  ): Promise<DailyLimitStatus> {
    const key = `${sender}:${currency}:${country}`;
    const entry = this.dailyLimits.get(key) ?? { limit: 0n, used: 0n, resetsAt: new Date(Date.now() + 86_400_000) };
    return {
      limit: entry.limit,
      used: entry.used,
      remaining: entry.limit === 0n ? BigInt(Number.MAX_SAFE_INTEGER) : entry.limit - entry.used,
      resetsAt: entry.resetsAt,
    };
  }

  async getRemittanceExpiryWindow(_sourceAddress: string): Promise<bigint> {
    return 0n;
  }

  async getPartialPayoutHistory(
    _sourceAddress: string,
    remittanceId: bigint
  ): Promise<PartialPayoutRecord[]> {
    if (!this.remittances.has(remittanceId))
      throw new SwiftRemitError(ErrorCode.RemittanceNotFound, `${remittanceId}`);
    return [];
  }

  async getGovernanceConfig(_sourceAddress: string): Promise<GovernanceConfig> {
    return { quorum: 2, timelockSeconds: 86_400n, proposalTtlSeconds: 604_800n };
  }

  async getProposal(_sourceAddress: string, _proposalId: bigint): Promise<Proposal> {
    throw new SwiftRemitError(ErrorCode.ProposalNotFound, `${_proposalId}`);
  }

  async getActiveProposals(_sourceAddress: string): Promise<Proposal[]> {
    return [];
  }

  async estimateFee(
    amount: bigint,
    _corridor: Corridor,
    _senderAddress: string
  ): Promise<FeeEstimate> {
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

  // ─── Write operations (apply state directly, return MockTxResult) ─────────────

  async createRemittance(params: CreateRemittanceParams): Promise<MockTxResult> {
    if (!this.agents.has(params.agent))
      throw new SwiftRemitError(ErrorCode.AgentNotRegistered, params.agent);
    if (params.amount <= 0n)
      throw new SwiftRemitError(ErrorCode.InvalidAmount, `${params.amount}`);

    const id = this.nextId++;
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
    entries: BatchCreateEntry[]
  ): Promise<MockTxResult> {
    for (const e of entries) {
      await this.createRemittance({
        sender,
        agent: e.agent,
        amount: e.amount,
        expiry: e.expiry,
      });
    }
    return { txHash: fakeTxHash() };
  }

  async confirmPayout(
    _agent: string,
    remittanceId: bigint
  ): Promise<MockTxResult> {
    const r = this._requireRemittance(remittanceId);
    this._requireStatus(r, "Pending");
    const fee = r.fee;
    this._platformFees += fee;
    this._totalVolume += r.amount;
    this.remittances.set(remittanceId, { ...r, status: "Completed" });
    this._bumpAgentStats(_agent, true, r.amount);
    return { txHash: fakeTxHash() };
  }

  async confirmPartialPayout(
    _agent: string,
    remittanceId: bigint,
    _amount: bigint
  ): Promise<MockTxResult> {
    const r = this._requireRemittance(remittanceId);
    this._requireStatus(r, "Pending");
    return { txHash: fakeTxHash() };
  }

  async cancelRemittance(
    _sender: string,
    remittanceId: bigint
  ): Promise<MockTxResult> {
    const r = this._requireRemittance(remittanceId);
    this._requireStatus(r, "Pending");
    this.remittances.set(remittanceId, { ...r, status: "Cancelled" });
    return { txHash: fakeTxHash() };
  }

  async markFailed(_agent: string, remittanceId: bigint): Promise<MockTxResult> {
    const r = this._requireRemittance(remittanceId);
    this._requireStatus(r, "Pending");
    const now = BigInt(Math.floor(Date.now() / 1000));
    this.remittances.set(remittanceId, { ...r, status: "Failed", failedAt: now });
    this._bumpAgentStats(_agent, false, 0n);
    return { txHash: fakeTxHash() };
  }

  async raiseDispute(
    _sender: string,
    remittanceId: bigint,
    _evidenceHash: Buffer
  ): Promise<MockTxResult> {
    const r = this._requireRemittance(remittanceId);
    this._requireStatus(r, "Failed");
    this.remittances.set(remittanceId, { ...r, status: "Disputed" });
    return { txHash: fakeTxHash() };
  }

  async resolveDispute(
    _admin: string,
    remittanceId: bigint,
    inFavourOfSender: boolean
  ): Promise<MockTxResult> {
    const r = this._requireRemittance(remittanceId);
    this._requireStatus(r, "Disputed");
    this.remittances.set(remittanceId, {
      ...r,
      status: inFavourOfSender ? "Cancelled" : "Completed",
    });
    return { txHash: fakeTxHash() };
  }

  async expireRemittance(_caller: string, remittanceId: bigint): Promise<MockTxResult> {
    const r = this._requireRemittance(remittanceId);
    this._requireStatus(r, "Pending");
    this.remittances.set(remittanceId, { ...r, status: "Cancelled" });
    return { txHash: fakeTxHash() };
  }

  async processExpiredRemittances(
    _caller: string,
    remittanceIds: bigint[]
  ): Promise<MockTxResult> {
    for (const id of remittanceIds) await this.expireRemittance(_caller, id);
    return { txHash: fakeTxHash() };
  }

  async withdrawFees(_admin: string, _to: string): Promise<MockTxResult> {
    if (this._platformFees === 0n)
      throw new SwiftRemitError(ErrorCode.NoFeesToWithdraw, "0");
    this._platformFees = 0n;
    return { txHash: fakeTxHash() };
  }

  async withdrawIntegratorFees(_integrator: string, _to: string): Promise<MockTxResult> {
    this._integratorFees = 0n;
    return { txHash: fakeTxHash() };
  }

  async registerAgent(_admin: string, agent: string): Promise<MockTxResult> {
    if (this.agents.has(agent))
      throw new SwiftRemitError(ErrorCode.AgentAlreadyRegistered, agent);
    this.seedAgent(agent);
    return { txHash: fakeTxHash() };
  }

  async removeAgent(_admin: string, agent: string): Promise<MockTxResult> {
    if (!this.agents.has(agent))
      throw new SwiftRemitError(ErrorCode.AgentNotRegistered, agent);
    this.agents.delete(agent);
    return { txHash: fakeTxHash() };
  }

  async updateFee(_admin: string, feeBps: number): Promise<MockTxResult> {
    this._feeBps = feeBps;
    return { txHash: fakeTxHash() };
  }

  async setDailyLimit(
    _admin: string,
    currency: string,
    country: string,
    limit: bigint
  ): Promise<MockTxResult> {
    const senderKey = `*:${currency}:${country}`;
    this.dailyLimits.set(senderKey, {
      limit,
      used: 0n,
      resetsAt: new Date(Date.now() + 86_400_000),
    });
    return { txHash: fakeTxHash() };
  }

  async setAgentDailyCap(_admin: string, _agent: string, _cap: bigint): Promise<MockTxResult> {
    return { txHash: fakeTxHash() };
  }

  async addAdmin(_caller: string, newAdmin: string): Promise<MockTxResult> {
    this.admins.add(newAdmin);
    return { txHash: fakeTxHash() };
  }

  async extendStorageTtl(_admin: string, _extendByLedgers: number): Promise<MockTxResult> {
    return { txHash: fakeTxHash() };
  }

  async initialize(_admin: string, _params: unknown): Promise<MockTxResult> {
    return { txHash: fakeTxHash() };
  }

  async voteOnProposal(_sourceAddress: string, _proposalId: bigint): Promise<MockTxResult> {
    return { txHash: fakeTxHash() };
  }

  async executeProposal(_sourceAddress: string, _proposalId: bigint): Promise<MockTxResult> {
    return { txHash: fakeTxHash() };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private _requireRemittance(id: bigint): Remittance {
    const r = this.remittances.get(id);
    if (!r) throw new SwiftRemitError(ErrorCode.RemittanceNotFound, `${id}`);
    return r;
  }

  private _requireStatus(r: Remittance, expected: RemittanceStatus): void {
    if (r.status !== expected)
      throw new SwiftRemitError(
        ErrorCode.InvalidStatus,
        `Expected ${expected}, got ${r.status}`
      );
  }

  private _bumpAgentStats(agent: string, success: boolean, _amount: bigint): void {
    const stats = this.agentStats.get(agent);
    if (!stats) return;
    stats.totalSettlements++;
    if (!success) stats.failedSettlements++;
    stats.successRateBps = stats.totalSettlements === 0
      ? 10_000
      : Math.round(((stats.totalSettlements - stats.failedSettlements) / stats.totalSettlements) * 10_000);
    stats.lastActiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
  }
}
