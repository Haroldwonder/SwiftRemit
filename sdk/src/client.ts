import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  Keypair,
  Transaction,
  scValToNative,
} from "@stellar/stellar-sdk";
import type {
  SwiftRemitClientOptions,
  Remittance,
  AgentStats,
  CircuitBreakerStatus,
  HealthStatus,
  CreateRemittanceParams,
  BatchCreateEntry,
  GovernanceConfig,
  DailyLimitStatus,
  Proposal,
  PartialPayoutRecord,
  RemittanceEvent,
  RemittanceEventType,
  SubscribeOptions,
  Unsubscribe,
  RetryPolicy,
  Corridor,
  FeeEstimate,
} from "./types.js";
import { parseContractError, SwiftRemitError, ErrorCode } from "./errors.js";
import { withRetry, withRetryPolicy } from "./retry.js";
import {
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
  parseProposal,
} from "./convert.js";

/** Maximum number of entries allowed in a single batch remittance call. */
export const MAX_BATCH_SIZE = 50;

function shouldAllowHttp(rpcUrl: string): boolean {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rpcUrl);
  } catch {
    return false;
  }

  if (parsedUrl.protocol !== "http:") {
    return false;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export class SwiftRemitClient {
  private readonly contract: Contract;
  private readonly server: SorobanRpc.Server;
  private readonly networkPassphrase: string;
  private readonly fee: string;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly retryBackoffFactor: number;
  private readonly writeRetryPolicy: RetryPolicy;
  private readonly feeCache = new Map<string, { cachedAt: number; estimate: FeeEstimate }>();
  private static readonly FEE_CACHE_TTL_MS = 30_000;

  constructor(options: SwiftRemitClientOptions) {
    this.contract = new Contract(options.contractId);
    const allowHttp = shouldAllowHttp(options.rpcUrl);
    this.server = new SorobanRpc.Server(options.rpcUrl, { allowHttp });
    if (allowHttp) {
      console.warn(
        `[SwiftRemitClient] Using insecure HTTP RPC connection for ${options.rpcUrl}. Restrict this to local or test environments.`
      );
    }
    this.networkPassphrase = options.networkPassphrase;
    this.fee = options.fee ?? BASE_FEE;
    this.retries = options.retries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.retryBackoffFactor = options.retryBackoffFactor ?? 2;
    this.writeRetryPolicy = options.writeRetryPolicy ?? { retries: 0 };
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs = 30_000): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`RPC call timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  private resolveWriteRetryPolicy(perCallPolicy?: RetryPolicy): RetryPolicy {
    return perCallPolicy ?? this.writeRetryPolicy;
  }

  // ─── Transaction helpers ────────────────────────────────────────────────────

  /**
   * Build, simulate, and return a prepared transaction ready for signing.
   * The caller signs and submits via `submitTransaction`.
   */
  async prepareTransaction(
    sourceAddress: string,
    method: string,
    args: xdr.ScVal[]
  ): Promise<Transaction> {
    const account = await this.withTimeout(this.server.getAccount(sourceAddress));
    const tx = new TransactionBuilder(account, {
      fee: this.fee,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simResult = await this.withTimeout(this.server.simulateTransaction(tx));
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      const typed = parseContractError(simResult.error);
      if (typed) throw typed;
      throw new Error(`Simulation failed: ${simResult.error}`);
    }
    return SorobanRpc.assembleTransaction(tx, simResult).build();
  }

  /**
   * Sign and submit a prepared transaction; wait for confirmation.
   *
   * @param tx - Transaction prepared by any write method (e.g. `createRemittance`)
   * @param keypair - Keypair used to sign the transaction
   * @param options.retryPolicy - Per-call retry policy that overrides the client's
   *   `writeRetryPolicy`. Idempotent operations (those using an idempotency key or
   *   inherently safe to re-submit) may opt in to retries by passing
   *   `RetryPolicies.AGGRESSIVE` here. Non-idempotent operations should leave this
   *   unset to rely on the default (no retries).
   */
  async submitTransaction(
    tx: Transaction,
    keypair: Keypair,
    options?: { retryPolicy?: RetryPolicy }
  ): Promise<SorobanRpc.Api.GetSuccessfulTransactionResponse> {
    const writePolicy = this.resolveWriteRetryPolicy(options?.retryPolicy);
    const defaults = { delayMs: this.retryDelayMs, backoffFactor: this.retryBackoffFactor };

    tx.sign(keypair);
    const sendResult = await withRetryPolicy(
      () => this.server.sendTransaction(tx),
      writePolicy,
      defaults
    );
    if (sendResult.status === "ERROR") {
      throw new Error(`Submit failed: ${JSON.stringify(sendResult.errorResult)}`);
    }

    // Polling for confirmation is always idempotent — use the global read retry config.
    const readPolicy: RetryPolicy = { retries: this.retries };
    let getResult = await withRetryPolicy(
      () => this.server.getTransaction(sendResult.hash),
      readPolicy,
      defaults
    );
    while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((r) => setTimeout(r, 1000));
      getResult = await withRetryPolicy(
        () => this.server.getTransaction(sendResult.hash),
        readPolicy,
        defaults
      );
    }

    if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      const raw = JSON.stringify(getResult);
      const typed = parseContractError(raw);
      if (typed) throw typed;
      throw new Error(`Transaction failed: ${raw}`);
    }
    return getResult as SorobanRpc.Api.GetSuccessfulTransactionResponse;
  }

  // ─── Read-only calls (simulate only) ────────────────────────────────────────

  private async simulateCall(
    sourceAddress: string,
    method: string,
    args: xdr.ScVal[],
    retryPolicy?: RetryPolicy
  ): Promise<xdr.ScVal> {
    const account = await this.withTimeout(this.server.getAccount(sourceAddress));
    const tx = new TransactionBuilder(account, {
      fee: this.fee,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const policy = retryPolicy ?? { retries: this.retries };
    const defaults = { delayMs: this.retryDelayMs, backoffFactor: this.retryBackoffFactor };
    const sim = await withRetryPolicy(
      () => this.server.simulateTransaction(tx),
      policy,
      defaults
    );
    if (SorobanRpc.Api.isSimulationError(sim)) {
      const typed = parseContractError(sim.error);
      if (typed) throw typed;
      throw new Error(`Simulation failed: ${sim.error}`);
    }
    const result = (sim as SorobanRpc.Api.SimulateTransactionSuccessResponse)
      .result;
    if (!result) throw new Error("No result from simulation");
    return result.retval;
  }

  // ─── Query functions ─────────────────────────────────────────────────────────

  /** Retrieve a remittance record by ID. */
  async getRemittance(
    sourceAddress: string,
    remittanceId: bigint
  ): Promise<Remittance> {
    const val = await this.simulateCall(sourceAddress, "get_remittance", [
      u64ToScVal(remittanceId),
    ]);
    return parseRemittance(val);
  }

  /** Get paginated remittance IDs for a sender. */
  async getRemittancesBySender(
    sourceAddress: string,
    sender: string,
    offset: bigint,
    limit: bigint
  ): Promise<bigint[]> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_remittances_by_sender",
      [
        addressToScVal(sender),
        u64ToScVal(offset),
        u64ToScVal(limit),
      ]
    );
    return (scValToNative(val) as number[]).map(BigInt);
  }

  /** Get total accumulated platform fees. */
  async getAccumulatedFees(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_accumulated_fees",
      []
    );
    return BigInt(scValToNative(val) as number);
  }

  /** Get total accumulated integrator fees. */
  async getAccumulatedIntegratorFees(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_accumulated_integrator_fees",
      []
    );
    return BigInt(scValToNative(val) as number);
  }

  /** Check if an address is a registered agent. */
  async isAgentRegistered(
    sourceAddress: string,
    agent: string
  ): Promise<boolean> {
    const val = await this.simulateCall(
      sourceAddress,
      "is_agent_registered",
      [addressToScVal(agent)]
    );
    return Boolean(scValToNative(val));
  }

  /** Check if a token is whitelisted. */
  async isTokenWhitelisted(
    sourceAddress: string,
    token: string
  ): Promise<boolean> {
    const val = await this.simulateCall(
      sourceAddress,
      "is_token_whitelisted",
      [addressToScVal(token)]
    );
    return Boolean(scValToNative(val));
  }

  /** Get current platform fee in basis points. */
  async getPlatformFeeBps(sourceAddress: string): Promise<number> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_platform_fee_bps",
      []
    );
    return Number(scValToNative(val));
  }

  /** Get total number of remittances ever created. */
  async getRemittanceCount(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_remittance_count",
      []
    );
    return BigInt(scValToNative(val) as number);
  }

  /** Get cumulative volume of all completed remittances. */
  async getTotalVolume(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(sourceAddress, "get_total_volume", []);
    return BigInt(scValToNative(val) as number);
  }

  /** Get number of registered admins. */
  async getAdminCount(sourceAddress: string): Promise<number> {
    const val = await this.simulateCall(sourceAddress, "get_admin_count", []);
    return Number(scValToNative(val));
  }

  /** On-chain health check. */
  async health(sourceAddress: string): Promise<HealthStatus> {
    const val = await this.simulateCall(sourceAddress, "health", []);
    return parseHealthStatus(val);
  }

  /** Get agent stats. */
  async getAgentStats(
    sourceAddress: string,
    agent: string
  ): Promise<AgentStats> {
    const val = await this.simulateCall(sourceAddress, "get_agent_stats", [
      addressToScVal(agent),
    ]);
    return parseAgentStats(val);
  }

  /** Get agent reputation score (0-100). */
  async getAgentReputation(
    sourceAddress: string,
    agent: string
  ): Promise<number> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_agent_reputation",
      [addressToScVal(agent)]
    );
    return Number(scValToNative(val));
  }

  /** Get circuit breaker status. */
  async getCircuitBreakerStatus(
    sourceAddress: string
  ): Promise<CircuitBreakerStatus> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_circuit_breaker_status",
      []
    );
    return parseCircuitBreakerStatus(val);
  }

  /** Get per-agent daily withdrawal cap (0 = no cap). */
  async getAgentDailyCap(
    sourceAddress: string,
    agent: string
  ): Promise<bigint> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_agent_daily_cap",
      [addressToScVal(agent)]
    );
    return BigInt(scValToNative(val) as number);
  }

  /** Get dispute window in seconds. */
  async getDisputeWindow(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_dispute_window",
      []
    );
    return BigInt(scValToNative(val) as number);
  }

  /**
   * Get a sender's daily limit status for a currency/country corridor.
   *
   * Returns the configured limit, amount already used in the rolling 24-hour
   * window, remaining sendable amount, and when the window resets.
   *
   * @param sourceAddress - Address used for simulation (can be any funded account)
   * @param sender - Sender address to query
   * @param currency - ISO 4217 currency code (e.g. "USDC")
   * @param country - ISO 3166-1 alpha-2 country code (e.g. "NG")
   */
  async getDailyLimitStatus(
    sourceAddress: string,
    sender: string,
    currency: string,
    country: string
  ): Promise<DailyLimitStatus> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_daily_limit_status",
      [
        addressToScVal(sender),
        stringToScVal(currency),
        stringToScVal(country),
      ]
    );
    const native = scValToNative(val) as [bigint | number, bigint | number, bigint | number, bigint | number];
    const [limit, used, remaining, resetsAtSecs] = native.map(BigInt) as [bigint, bigint, bigint, bigint];
    return {
      limit,
      used,
      remaining,
      resetsAt: new Date(Number(resetsAtSecs) * 1000),
    };
  }

  // ─── Write functions (return prepared tx) ────────────────────────────────────

  /**
   * Initialize the contract (one-time setup).
   * Returns a prepared transaction ready for signing.
   */
  async initialize(
    admin: string,
    params: {
      usdcToken: string;
      feeBps: number;
      rateLimitCooldown: bigint;
      protocolFeeBps: number;
      treasury: string;
    }
  ): Promise<Transaction> {
    return this.prepareTransaction(admin, "initialize", [
      addressToScVal(admin),
      addressToScVal(params.usdcToken),
      xdr.ScVal.scvU32(params.feeBps),
      u64ToScVal(params.rateLimitCooldown),
      xdr.ScVal.scvU32(params.protocolFeeBps),
      addressToScVal(params.treasury),
    ]);
  }

  /** Register an agent (admin only). */
  async registerAgent(
    admin: string,
    agent: string,
    kycHash?: Buffer
  ): Promise<Transaction> {
    return this.prepareTransaction(admin, "register_agent", [
      addressToScVal(agent),
      optionToScVal(kycHash ? bytesNToScVal(kycHash) : undefined),
    ]);
  }

  /** Remove an agent (admin only). */
  async removeAgent(admin: string, agent: string): Promise<Transaction> {
    return this.prepareTransaction(admin, "remove_agent", [
      addressToScVal(agent),
    ]);
  }

  /** Update platform fee (admin only). */
  async updateFee(admin: string, feeBps: number): Promise<Transaction> {
    return this.prepareTransaction(admin, "update_fee", [
      xdr.ScVal.scvU32(feeBps),
    ]);
  }

  /** Create a new remittance. */
  async createRemittance(params: CreateRemittanceParams): Promise<Transaction> {
    return this.prepareTransaction(params.sender, "create_remittance", [
      addressToScVal(params.sender),
      addressToScVal(params.agent),
      i128ToScVal(params.amount),
      optionToScVal(params.expiry !== undefined ? u64ToScVal(params.expiry) : undefined),
      optionToScVal(params.token ? addressToScVal(params.token) : undefined),
      optionToScVal(
        params.idempotencyKey
          ? stringToScVal(params.idempotencyKey)
          : undefined
      ),
      // settlement_config and recipient_hash omitted (void) for simplicity
      xdr.ScVal.scvVoid(),
      optionToScVal(
        params.recipientHash ? bytesNToScVal(params.recipientHash) : undefined
      ),
    ]);
  }

  /** Create multiple remittances in one batch. */
  async batchCreateRemittances(
    sender: string,
    entries: BatchCreateEntry[]
  ): Promise<Transaction> {
    if (entries.length === 0) {
      throw new SwiftRemitError(ErrorCode.InvalidBatchSize, "Batch must contain at least one entry");
    }
    if (entries.length > MAX_BATCH_SIZE) {
      throw new SwiftRemitError(
        ErrorCode.InvalidBatchSize,
        `Batch size ${entries.length} exceeds MAX_BATCH_SIZE (${MAX_BATCH_SIZE})`
      );
    }
    const entriesScVal = xdr.ScVal.scvVec(
      entries.map((e) =>
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("agent"),
            val: addressToScVal(e.agent),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("amount"),
            val: i128ToScVal(e.amount),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("expiry"),
            val: optionToScVal(
              e.expiry !== undefined ? u64ToScVal(e.expiry) : undefined
            ),
          }),
        ])
      )
    );
    return this.prepareTransaction(sender, "batch_create_remittances", [
      addressToScVal(sender),
      entriesScVal,
    ]);
  }

  /** Confirm payout for a remittance (agent only). */
  async confirmPayout(
    agent: string,
    remittanceId: bigint,
    proof?: Buffer,
    recipientDetailsHash?: Buffer
  ): Promise<Transaction> {
    return this.prepareTransaction(agent, "confirm_payout", [
      u64ToScVal(remittanceId),
      optionToScVal(proof ? bytesNToScVal(proof) : undefined),
      optionToScVal(
        recipientDetailsHash ? bytesNToScVal(recipientDetailsHash) : undefined
      ),
    ]);
  }

  /** Cancel a pending remittance (sender only). */
  async cancelRemittance(
    sender: string,
    remittanceId: bigint
  ): Promise<Transaction> {
    return this.prepareTransaction(sender, "cancel_remittance", [
      u64ToScVal(remittanceId),
    ]);
  }

  /** Mark a remittance as failed (agent only). */
  async markFailed(agent: string, remittanceId: bigint): Promise<Transaction> {
    return this.prepareTransaction(agent, "mark_failed", [
      u64ToScVal(remittanceId),
    ]);
  }

  /** Raise a dispute on a failed remittance (sender only). */
  async raiseDispute(
    sender: string,
    remittanceId: bigint,
    evidenceHash: Buffer
  ): Promise<Transaction> {
    return this.prepareTransaction(sender, "raise_dispute", [
      u64ToScVal(remittanceId),
      bytesNToScVal(evidenceHash),
    ]);
  }

  /** Resolve a dispute (admin only). */
  async resolveDispute(
    admin: string,
    remittanceId: bigint,
    inFavourOfSender: boolean
  ): Promise<Transaction> {
    return this.prepareTransaction(admin, "resolve_dispute", [
      u64ToScVal(remittanceId),
      xdr.ScVal.scvBool(inFavourOfSender),
    ]);
  }

  /** Process expired remittances in batch (permissionless). */
  async processExpiredRemittances(
    caller: string,
    remittanceIds: bigint[]
  ): Promise<Transaction> {
    return this.prepareTransaction(caller, "process_expired_remittances", [
      xdr.ScVal.scvVec(remittanceIds.map(u64ToScVal)),
    ]);
  }

  /** Withdraw accumulated platform fees (admin only). */
  async withdrawFees(admin: string, to: string): Promise<Transaction> {
    return this.prepareTransaction(admin, "withdraw_fees", [
      addressToScVal(to),
    ]);
  }

  /** Withdraw accumulated integrator fees (integrator auth required). */
  async withdrawIntegratorFees(
    integrator: string,
    to: string
  ): Promise<Transaction> {
    return this.prepareTransaction(integrator, "withdraw_integrator_fees", [
      addressToScVal(integrator),
      addressToScVal(to),
    ]);
  }

  /** Set daily send limit for a currency/country corridor (admin only). */
  async setDailyLimit(
    admin: string,
    currency: string,
    country: string,
    limit: bigint
  ): Promise<Transaction> {
    return this.prepareTransaction(admin, "set_daily_limit", [
      stringToScVal(currency),
      stringToScVal(country),
      i128ToScVal(limit),
    ]);
  }

  /** Set per-agent daily withdrawal cap (admin only). */
  async setAgentDailyCap(
    admin: string,
    agent: string,
    cap: bigint
  ): Promise<Transaction> {
    return this.prepareTransaction(admin, "set_agent_daily_cap", [
      addressToScVal(agent),
      i128ToScVal(cap),
    ]);
  }

  /**
   * Extend TTLs for critical contract storage keys (admin only).
   *
   * Call this periodically (e.g. daily) to prevent instance and persistent
   * storage entries from expiring. The backend scheduler calls this automatically.
   *
   * @param admin - Admin address
   * @param extendByLedgers - Number of ledgers to extend TTL by (max 3_110_400 ≈ 1 year)
   */
  async extendStorageTtl(admin: string, extendByLedgers: number): Promise<Transaction> {
    return this.prepareTransaction(admin, "extend_storage_ttl", [
      addressToScVal(admin),
      xdr.ScVal.scvU32(extendByLedgers),
    ]);
  }

  /** Add a new admin (existing admin only). */
  async addAdmin(
    caller: string,
    newAdmin: string
  ): Promise<Transaction> {
    return this.prepareTransaction(caller, "add_admin", [
      addressToScVal(caller),
      addressToScVal(newAdmin),
    ]);
  }

  // ── #835: Partial payout history ───────────────────────────────────────────

  /**
   * Returns the full disbursement history for a remittance's partial payouts.
   *
   * Each record includes the amount disbursed, the cumulative total, and the
   * remaining amount — allowing SDK consumers to track payout progress without
   * additional on-chain queries.
   */
  async getPartialPayoutHistory(
    sourceAddress: string,
    remittanceId: bigint
  ): Promise<PartialPayoutRecord[]> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_partial_payout_history",
      [u64ToScVal(remittanceId)]
    );
    const native = scValToNative(val) as Array<Record<string, unknown>>;
    return native.map((r) => ({
      amount: BigInt(r["amount"] as number),
      totalDisbursed: BigInt(r["total_disbursed"] as number),
      remainingAmount: BigInt(r["remaining_amount"] as number),
      timestamp: BigInt(r["timestamp"] as number),
      ledgerSequence: Number(r["ledger_sequence"]),
    }));
  }

  // ── #836: Time-based remittance expiry ──────────────────────────────────────

  /** Expire a pending remittance after its expiry window (permissionless). */
  async expireRemittance(
    caller: string,
    remittanceId: bigint
  ): Promise<Transaction> {
    return this.prepareTransaction(caller, "expire_remittance", [
      u64ToScVal(remittanceId),
    ]);
  }

  /** Get the global remittance auto-expiry window in seconds (0 = disabled). */
  async getRemittanceExpiryWindow(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_remittance_expiry_window",
      []
    );
    return BigInt(scValToNative(val) as number);
  }

  /** Confirm partial payout (agent only). */
  async confirmPartialPayout(
    agent: string,
    remittanceId: bigint,
    amount: bigint
  ): Promise<Transaction> {
    return this.prepareTransaction(agent, "confirm_partial_payout", [
      u64ToScVal(remittanceId),
      i128ToScVal(amount),
    ]);
  }

  /**
   * Returns the current governance configuration (quorum, timelock, proposal TTL).
   * Read-only — no transaction required.
   */
  async getGovernanceConfig(sourceAddress: string): Promise<GovernanceConfig> {
    const result = await this.simulateCall(
      sourceAddress,
      "query_governance_config",
      []
    );
    const native = scValToNative(result);
    return {
      quorum: Number(native.quorum),
      timelockSeconds: BigInt(native.timelock_seconds),
      proposalTtlSeconds: BigInt(native.proposal_ttl_seconds),
    };
  }

  // ─── Governance ──────────────────────────────────────────────────────────────

  /** Fetch a single proposal by ID. */
  async getProposal(sourceAddress: string, proposalId: bigint): Promise<Proposal> {
    const val = await this.simulateCall(sourceAddress, "get_proposal", [
      u64ToScVal(proposalId),
    ]);
    return parseProposal(val);
  }

  /**
   * Fetch all proposals with state Pending or Approved.
   * Iterates proposal IDs starting from 0 until the contract returns NotFound.
   */
  async getActiveProposals(sourceAddress: string): Promise<Proposal[]> {
    const proposals: Proposal[] = [];
    let id = 0n;
    while (true) {
      try {
        const val = await this.simulateCall(sourceAddress, "get_proposal", [
          u64ToScVal(id),
        ]);
        const p = parseProposal(val);
        if (p.state === "Pending" || p.state === "Approved") {
          proposals.push(p);
        }
        id++;
      } catch {
        break; // ProposalNotFound — no more proposals
      }
    }
    return proposals;
  }

  // ─── Fee estimation ──────────────────────────────────────────────────────────

  /**
   * Estimate the fee breakdown for a remittance before committing a transaction.
   *
   * Results are cached for 30 seconds per unique (senderAddress, amount, corridor)
   * combination. Pass `retryPolicy` to override the client's default read retry
   * behaviour for this call.
   *
   * @param amount - Send amount in stroops (use {@link toStroops} to convert from USDC)
   * @param corridor - Destination currency and country
   * @param senderAddress - Address used to simulate the contract call
   * @param retryPolicy - Optional per-call retry override (defaults to global read retries)
   */
  async estimateFee(
    amount: bigint,
    corridor: Corridor,
    senderAddress: string,
    retryPolicy?: RetryPolicy
  ): Promise<FeeEstimate> {
    const cacheKey = `${senderAddress}:${amount}:${corridor.currency}:${corridor.country}`;
    const cached = this.feeCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SwiftRemitClient.FEE_CACHE_TTL_MS) {
      return { ...cached.estimate, fromCache: true };
    }

    const val = await this.simulateCall(
      senderAddress,
      "get_fee_breakdown",
      [i128ToScVal(amount), stringToScVal(corridor.currency), stringToScVal(corridor.country)],
      retryPolicy
    );

    const breakdown = parseFeeBreakdown(val);
    const totalFee = breakdown.platformFee + breakdown.protocolFee;
    const estimate: FeeEstimate = {
      amount,
      platformFee: breakdown.platformFee,
      protocolFee: breakdown.protocolFee,
      netAmount: breakdown.netAmount,
      totalFee,
      estimatedAt: new Date(),
      fromCache: false,
    };

    this.feeCache.set(cacheKey, { cachedAt: Date.now(), estimate });
    return estimate;
  }

  /** Cast an approval vote on a pending proposal (admin only). */
  async voteOnProposal(
    sourceAddress: string,
    proposalId: bigint
  ): Promise<Transaction> {
    return this.prepareTransaction(sourceAddress, "vote", [
      addressToScVal(sourceAddress),
      u64ToScVal(proposalId),
    ]);
  }

  /** Execute an approved proposal after the timelock has elapsed (admin only). */
  async executeProposal(
    sourceAddress: string,
    proposalId: bigint
  ): Promise<Transaction> {
    return this.prepareTransaction(sourceAddress, "execute", [
      addressToScVal(sourceAddress),
      u64ToScVal(proposalId),
    ]);
  }

  /**
   * Subscribe to remittance contract events via polling.
   * Returns an unsubscribe function that stops polling when called.
   */
  subscribeToRemittanceEvents(
    callback: (event: RemittanceEvent) => void,
    options: SubscribeOptions = {}
  ): Unsubscribe {
    let active = true;
    let cursor = options.cursor;

    const poll = async (): Promise<void> => {
      while (active) {
        try {
          const result = await this.server.getEvents({
            filters: [
              {
                type: "contract",
                contractIds: [this.contract.contractId()],
              },
            ],
            ...(cursor ? { cursor } : {}),
          } as Parameters<typeof this.server.getEvents>[0]);

          for (const raw of (result as { events: unknown[] }).events) {
            const e = raw as {
              pagingToken: string;
              ledger: number;
              ledgerClosedAt: string;
              topic: { toXDR: () => Buffer }[];
              value: { toXDR: () => Buffer };
            };
            cursor = e.pagingToken;

            const typeSymbol = xdr.ScVal.fromXDR(e.topic[0].toXDR());
            const type = scValToNative(typeSymbol) as RemittanceEventType;
            const idVal = xdr.ScVal.fromXDR(e.topic[1].toXDR());
            const remittanceId = BigInt(scValToNative(idVal));

            if (
              options.remittanceId !== undefined &&
              remittanceId !== options.remittanceId
            ) {
              continue;
            }

            const event: RemittanceEvent = {
              type,
              remittanceId,
              ledger: e.ledger,
              ledgerClosedAt: e.ledgerClosedAt,
              raw: {
                topics: e.topic.map((t) => t.toXDR().toString("base64")),
                value: e.value.toXDR().toString("base64"),
              },
            };
            callback(event);
          }

          await new Promise((r) => setTimeout(r, 5_000));
        } catch {
          if (!active) break;
          await new Promise((r) => setTimeout(r, 1_000));
        }
      }
    };

    poll();
    return () => {
      active = false;
    };
  }
}
