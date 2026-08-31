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
  BatchCreateResult,
  BatchCreateResponse,
  GovernanceConfig,
  DailyLimitStatus,
  Proposal,
  ProposalAction,
  PartialPayoutRecord,
  RemittanceEvent,
  RemittanceEventType,
  SubscribeOptions,
  Unsubscribe,
  RetryPolicy,
  Corridor,
  FeeEstimate,
  EventHandler,
  AnyEventHandler,
  DecodedEventData,
  EventDataMap,
  RemittanceScopedEventType,
  Escrow,
  AssetVerification,
  VerificationStatus,
  PauseRecord,
  PauseReason,
  FeeStrategy,
  FeeCorridor,
  RateLimitConfig,
  RateLimitStatus,
  TransactionRecord,
  MigrationSnapshot,
  BatchSettlementEntry,
  Role,
  RemittanceStatus,
  FeeBreakdown,
  AdminOperationType,
  PendingOperation,
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
  validateAmount,
  validateAddress,
  u32ToScVal,
  boolToScVal,
  roleToScVal,
  verificationStatusToScVal,
  pauseReasonToScVal,
  feeStrategyToScVal,
  parseFeeStrategy,
  feeCorridorToScVal,
  parseFeeCorridor,
  parseEscrow,
  parseAssetVerification,
  parsePauseRecord,
  parseRateLimitConfig,
  parseRateLimitStatus,
  parseTransactionRecord,
  parseMigrationSnapshot,
  batchSettlementEntryToScVal,
  adminOperationTypeToScVal,
  parsePendingOperation,
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

// ─── Proposal action helpers ──────────────────────────────────────────────────

function proposalActionToScVal(action: ProposalAction): xdr.ScVal {
  let entry: xdr.ScMapEntry;
  if ("UpdateFee" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("UpdateFee"),
      val: xdr.ScVal.scvU32(action.UpdateFee),
    });
  } else if ("RegisterAgent" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("RegisterAgent"),
      val: addressToScVal(action.RegisterAgent),
    });
  } else if ("RemoveAgent" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("RemoveAgent"),
      val: addressToScVal(action.RemoveAgent),
    });
  } else if ("AddAdmin" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("AddAdmin"),
      val: addressToScVal(action.AddAdmin),
    });
  } else if ("RemoveAdmin" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("RemoveAdmin"),
      val: addressToScVal(action.RemoveAdmin),
    });
  } else if ("UpdateQuorum" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("UpdateQuorum"),
      val: xdr.ScVal.scvU32(action.UpdateQuorum),
    });
  } else if ("UpdateTimelock" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("UpdateTimelock"),
      val: u64ToScVal(action.UpdateTimelock),
    });
  } else if ("UpdateCooldownPeriod" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("UpdateCooldownPeriod"),
      val: u64ToScVal(action.UpdateCooldownPeriod),
    });
  } else if ("WhitelistAsset" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("WhitelistAsset"),
      val: addressToScVal(action.WhitelistAsset),
    });
  } else if ("AdjustReputationThreshold" in action) {
    entry = new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("AdjustReputationThreshold"),
      val: xdr.ScVal.scvU32(action.AdjustReputationThreshold),
    });
  } else {
    throw new SwiftRemitError(
      ErrorCode.DataCorruption,
      "Unknown proposal action type"
    );
  }
  return xdr.ScVal.scvMap([entry]);
}

/** Build a typed UpdateFee proposal action. */
export function buildUpdateFeeProposal(feeBps: number): ProposalAction {
  return { UpdateFee: feeBps };
}

/** Build a typed RegisterAgent proposal action. */
export function buildRegisterAgentProposal(agent: string): ProposalAction {
  return { RegisterAgent: agent };
}

/** Build a typed RemoveAgent proposal action. */
export function buildRemoveAgentProposal(agent: string): ProposalAction {
  return { RemoveAgent: agent };
}

/** Build a typed AddAdmin proposal action. */
export function buildAddAdminProposal(admin: string): ProposalAction {
  return { AddAdmin: admin };
}

/** Build a typed RemoveAdmin proposal action. */
export function buildRemoveAdminProposal(admin: string): ProposalAction {
  return { RemoveAdmin: admin };
}

/** Build a typed UpdateQuorum proposal action. */
export function buildUpdateQuorumProposal(quorum: number): ProposalAction {
  return { UpdateQuorum: quorum };
}

/** Build a typed UpdateTimelock proposal action. */
export function buildUpdateTimelockProposal(
  timelockSeconds: bigint
): ProposalAction {
  return { UpdateTimelock: timelockSeconds };
}

/** Build a typed UpdateCooldownPeriod proposal action. */
export function buildUpdateCooldownPeriodProposal(
  cooldownSeconds: bigint
): ProposalAction {
  return { UpdateCooldownPeriod: cooldownSeconds };
}

/** Build a typed WhitelistAsset proposal action. */
export function buildWhitelistAssetProposal(assetAddress: string): ProposalAction {
  return { WhitelistAsset: assetAddress };
}

/** Build a typed AdjustReputationThreshold proposal action. */
export function buildAdjustReputationThresholdProposal(
  threshold: number
): ProposalAction {
  return { AdjustReputationThreshold: threshold };
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

  /**
   * Initialize a SwiftRemit SDK client.
   * 
   * @param options - Client configuration
   * @param options.contractId - The deployed SwiftRemit contract address
   * @param options.networkPassphrase - Stellar network passphrase (e.g., Networks.TESTNET)
   * @param options.rpcUrl - Soroban RPC endpoint URL
   * @param options.fee - Optional: Transaction fee in stroops (default: 100)
   * @param options.retries - Optional: Retry attempts for transient errors (default: 3)
   * @param options.retryDelayMs - Optional: Initial retry delay in ms (default: 1000)
   * @param options.retryBackoffFactor - Optional: Backoff multiplier for retries (default: 2)
   * 
   * @example
   * import { SwiftRemitClient, Networks, RpcUrls } from '@swiftremit/sdk';
   * 
   * const client = new SwiftRemitClient({
   *   contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
   *   networkPassphrase: Networks.TESTNET,
   *   rpcUrl: RpcUrls.TESTNET,
   * });
   */
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
    tx.sign(keypair);
    return this.submitSignedTransaction(tx, options);
  }

  /**
   * Submit a transaction that has already been signed (e.g. by an external
   * wallet or a {@link SwiftRemitSigner}-style signer) and wait for confirmation.
   * Unlike {@link submitTransaction}, this does not sign the transaction itself.
   *
   * @param tx - A transaction that already carries a valid signature
   * @param options.retryPolicy - Per-call retry policy that overrides the client's
   *   `writeRetryPolicy`. See {@link submitTransaction} for guidance on when to opt in.
   */
  async submitSignedTransaction(
    tx: Transaction,
    options?: { retryPolicy?: RetryPolicy }
  ): Promise<SorobanRpc.Api.GetSuccessfulTransactionResponse> {
    const writePolicy = this.resolveWriteRetryPolicy(options?.retryPolicy);
    const defaults = { delayMs: this.retryDelayMs, backoffFactor: this.retryBackoffFactor };

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
  /**
   * Retrieve a single remittance by ID.
   * 
   * @param sourceAddress - Query account address
   * @param remittanceId - The remittance ID to retrieve
   * @returns The remittance details including sender, agent, amount, status, etc.
   * 
   * @example
   * const remittance = await client.getRemittance(senderAddress, 1n);
   * console.log(`Status: ${remittance.status}`);
   */
  async getRemittance(
    sourceAddress: string,
    remittanceId: bigint
  ): Promise<Remittance> {
    const val = await this.simulateCall(sourceAddress, "get_remittance", [
      u64ToScVal(remittanceId),
    ]);
    return parseRemittance(val);
  }

  /**
   * Get paginated remittance IDs for a sender.
   * 
   * @param sourceAddress - Query account address
   * @param sender - Sender address to filter remittances
   * @param offset - Pagination offset
   * @param limit - Maximum results to return
   * @returns Array of remittance IDs for the sender
   */
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

  /**
   * Create a new remittance transaction.
   * 
   * The sender approves USDC to the contract, and this method creates a remittance
   * escrow. The contract holds USDC until an agent confirms payout or the remittance expires.
   * 
   * @param params - Remittance creation parameters
   * @param params.sender - Sender's Stellar address (must authorize transaction)
   * @param params.agent - Agent's Stellar address to receive payout notification
   * @param params.amount - Amount in stroops (1 USDC = 10_000_000 stroops)
   * @param params.expiry - Optional: Ledger sequence after which remittance auto-expires
   * @param params.token - Optional: Token contract ID (defaults to USDC)
   * @param params.idempotencyKey - Optional: Prevent duplicate remittances on retry
   * @param params.recipientHash - Optional: Hash for recipient verification
   * @returns Prepared transaction ready for signing
   * 
   * @example
   * const tx = await client.createRemittance({
   *   sender: senderAddress,
   *   agent: agentAddress,
   *   amount: toStroops(100), // 100 USDC
   *   expiry: ledgerSeq + 1000, // ~5 minutes
   *   idempotencyKey: 'order-12345',
   * });
   * // Sign and submit tx
   */
  async createRemittance(params: CreateRemittanceParams): Promise<Transaction> {
    // ── Input validation (SR-090 / #1160) ──────────────────────────────────
    // Validate before building any XDR so callers get a clear error instead of
    // an opaque transaction-simulation failure or a silently wrong amount.
    validateAddress(params.sender);
    validateAddress(params.agent);
    validateAmount(params.amount);
    if (params.token) validateAddress(params.token);
    // ───────────────────────────────────────────────────────────────────────
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

  /**
   * Create multiple remittances with per-item success/failure handling.
   * Each entry is prepared independently; failures don't abort the batch.
   * Returns a BatchCreateResponse with per-item results.
   */
  async createRemittanceBatch(
    sender: string,
    entries: BatchCreateEntry[]
  ): Promise<BatchCreateResponse> {
    if (entries.length === 0) {
      throw new SwiftRemitError(ErrorCode.InvalidBatchSize, "Batch must contain at least one entry");
    }
    if (entries.length > MAX_BATCH_SIZE) {
      throw new SwiftRemitError(
        ErrorCode.InvalidBatchSize,
        `Batch size ${entries.length} exceeds MAX_BATCH_SIZE (${MAX_BATCH_SIZE})`
      );
    }

    const results: BatchCreateResult[] = await Promise.all(
      entries.map(async (entry, index): Promise<BatchCreateResult> => {
        try {
          const tx = await withRetry(
            () =>
              this.createRemittance({
                sender,
                agent: entry.agent,
                amount: entry.amount,
                expiry: entry.expiry,
              }),
            this.retries,
            this.retryDelayMs,
            this.retryBackoffFactor
          );
          return { index, entry, success: true, tx };
        } catch (err) {
          return { index, entry, success: false, error: err instanceof Error ? err : new Error(String(err)) };
        }
      })
    );

    return {
      results,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
    };
  }

  /**
   * Create multiple remittances in a single batch transaction.
   *
   * More efficient than individual create_remittance calls when creating many remittances.
   *
   * @param sender - Batch creator's address
   * @param entries - Array of remittance entries (max 50 per batch)
   * @returns Prepared batch transaction
   *
   * @example
   * const tx = await client.batchCreateRemittances(senderAddress, [
   *   { agent: agent1, amount: toStroops(100) },
   *   { agent: agent2, amount: toStroops(250) },
   * ]);
   */
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
    // ── Input validation (SR-090 / #1160) ──────────────────────────────────
    validateAddress(sender);
    entries.forEach((e, i) => {
      try {
        validateAddress(e.agent);
        validateAmount(e.amount);
      } catch (err) {
        if (err instanceof SwiftRemitError) {
          throw new SwiftRemitError(
            err.code,
            `Batch entry [${i}]: ${err.message}`
          );
        }
        throw err;
      }
    });
    // ───────────────────────────────────────────────────────────────────────
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
      "get_governance_config",
      []
    );
    const native = scValToNative(result) as Record<string, unknown>;
    return {
      quorum: Number(native.quorum),
      timelockSeconds: BigInt(native.timelock_seconds as number),
      proposalTtlSeconds: BigInt(native.proposal_ttl_seconds as number),
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
   * Fetch proposals with state Pending or Approved, starting from `offset`.
   *
   * @param offset - Proposal ID to start iterating from
   * @param limit - Maximum number of active proposals to return
   */
  async getActiveProposals(
    sourceAddress: string,
    offset: bigint = 0n,
    limit: bigint = 50n
  ): Promise<Proposal[]> {
    const proposals: Proposal[] = [];
    let id = offset;
    while (BigInt(proposals.length) < limit) {
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
        break;
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

  /** Check whether `voterAddress` has already voted on `proposalId`. */
  async getVoteStatus(
    sourceAddress: string,
    proposalId: bigint,
    voterAddress: string
  ): Promise<boolean> {
    const val = await this.simulateCall(sourceAddress, "get_vote_status", [
      u64ToScVal(proposalId),
      addressToScVal(voterAddress),
    ]);
    return Boolean(scValToNative(val));
  }

  /** Create a new governance proposal (admin only). */
  async propose(
    sourceAddress: string,
    action: ProposalAction
  ): Promise<Transaction> {
    return this.prepareTransaction(sourceAddress, "propose", [
      addressToScVal(sourceAddress),
      proposalActionToScVal(action),
    ]);
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

  // ─── Admin transfer ──────────────────────────────────────────────────────────

  /** Proposes a two-step admin transfer. Requires the current admin. Throws {@link ErrorCode.Unauthorized}. */
  async proposeAdmin(admin: string, newAdmin: string): Promise<Transaction> {
    return this.prepareTransaction(admin, "propose_admin", [addressToScVal(newAdmin)]);
  }

  /** Accepts a pending admin transfer. Requires the proposed new admin. Throws {@link ErrorCode.NoPendingAdminTransfer}. */
  async acceptAdmin(newAdmin: string): Promise<Transaction> {
    return this.prepareTransaction(newAdmin, "accept_admin", []);
  }

  /** Removes an admin. Requires an existing admin as caller. Throws {@link ErrorCode.CannotRemoveLastAdmin}. */
  async removeAdmin(caller: string, adminToRemove: string): Promise<Transaction> {
    return this.prepareTransaction(caller, "remove_admin", [
      addressToScVal(caller),
      addressToScVal(adminToRemove),
    ]);
  }

  // ─── Role-based authorization ─────────────────────────────────────────────────

  /** Grants a role to an address. Requires caller authorization. */
  async assignRole(caller: string, address: string, role: Role): Promise<Transaction> {
    return this.prepareTransaction(caller, "assign_role", [
      addressToScVal(caller),
      addressToScVal(address),
      roleToScVal(role),
    ]);
  }

  /** Revokes a role from an address. Requires caller authorization. */
  async removeRole(caller: string, address: string, role: Role): Promise<Transaction> {
    return this.prepareTransaction(caller, "remove_role", [
      addressToScVal(caller),
      addressToScVal(address),
      roleToScVal(role),
    ]);
  }

  /** Returns whether `address` currently holds `role`. */
  async hasRole(sourceAddress: string, address: string, role: Role): Promise<boolean> {
    const val = await this.simulateCall(sourceAddress, "has_role", [
      addressToScVal(address),
      roleToScVal(role),
    ]);
    return Boolean(scValToNative(val));
  }

  /** Returns whether `address` currently has admin privileges. */
  async isAdmin(sourceAddress: string, address: string): Promise<boolean> {
    const val = await this.simulateCall(sourceAddress, "is_admin", [addressToScVal(address)]);
    return Boolean(scValToNative(val));
  }

  // ─── Token whitelist ───────────────────────────────────────────────────────────

  /** Whitelists a token for use in the contract. Requires admin. Throws {@link ErrorCode.TokenAlreadyWhitelisted}. */
  async addWhitelistedToken(admin: string, token: string): Promise<Transaction> {
    return this.prepareTransaction(admin, "add_whitelisted_token", [addressToScVal(token)]);
  }

  /** Removes a token from the whitelist. Requires admin. Throws {@link ErrorCode.TokenNotWhitelisted}. */
  async removeWhitelistedToken(admin: string, token: string): Promise<Transaction> {
    return this.prepareTransaction(admin, "remove_whitelisted_token", [addressToScVal(token)]);
  }

  /** Returns all whitelisted token addresses. */
  async getWhitelistedTokens(sourceAddress: string): Promise<string[]> {
    const val = await this.simulateCall(sourceAddress, "get_whitelisted_tokens", []);
    return (scValToNative(val) as { toString(): string }[]).map((a) => a.toString());
  }

  // ─── Blacklist ───────────────────────────────────────────────────────────────

  /** Blacklists a user, preventing them from transacting. Requires admin. */
  async blacklistUser(admin: string, user: string): Promise<Transaction> {
    return this.prepareTransaction(admin, "blacklist_user", [addressToScVal(user)]);
  }

  /** Removes a user from the blacklist. Requires admin. */
  async removeFromBlacklist(admin: string, user: string): Promise<Transaction> {
    return this.prepareTransaction(admin, "remove_from_blacklist", [addressToScVal(user)]);
  }

  /** Sets a user's blacklist status directly. Requires admin. */
  async setUserBlacklisted(admin: string, user: string, blacklisted: boolean): Promise<Transaction> {
    return this.prepareTransaction(admin, "set_user_blacklisted", [
      addressToScVal(user),
      boolToScVal(blacklisted),
    ]);
  }

  /** Returns whether `user` is currently blacklisted. */
  async isUserBlacklisted(sourceAddress: string, user: string): Promise<boolean> {
    const val = await this.simulateCall(sourceAddress, "is_user_blacklisted", [addressToScVal(user)]);
    return Boolean(scValToNative(val));
  }

  // ─── KYC ─────────────────────────────────────────────────────────────────────

  /** Sets a user's KYC approval status and expiry. Requires admin. */
  async setKycApproved(admin: string, user: string, approved: boolean, expiry: bigint): Promise<Transaction> {
    return this.prepareTransaction(admin, "set_kyc_approved", [
      addressToScVal(user),
      boolToScVal(approved),
      u64ToScVal(expiry),
    ]);
  }

  /** Returns whether `user` has non-expired KYC approval. */
  async isKycApproved(sourceAddress: string, user: string): Promise<boolean> {
    const val = await this.simulateCall(sourceAddress, "is_kyc_approved", [addressToScVal(user)]);
    return Boolean(scValToNative(val));
  }

  /** Returns the agent's stored KYC document hash, or null if none is set. */
  async getAgentKycHash(sourceAddress: string, agent: string): Promise<string | null> {
    const val = await this.simulateCall(sourceAddress, "get_agent_kyc_hash", [addressToScVal(agent)]);
    const native = scValToNative(val);
    return native ? Buffer.from(native as Uint8Array).toString("hex") : null;
  }

  // ─── Circuit breaker / pause ─────────────────────────────────────────────────

  /** Legacy pause wrapper (bypasses timelock/quorum checks). Requires admin. */
  async pause(admin: string): Promise<Transaction> {
    return this.prepareTransaction(admin, "pause", []);
  }

  /** Legacy unpause wrapper (bypasses timelock/quorum checks). Requires admin. */
  async unpause(admin: string): Promise<Transaction> {
    return this.prepareTransaction(admin, "unpause", []);
  }

  /** Pauses the contract with a structured reason and audit trail. Requires admin. Throws {@link ErrorCode.AlreadyPaused}. */
  async emergencyPause(caller: string, reason: PauseReason): Promise<Transaction> {
    return this.prepareTransaction(caller, "emergency_pause", [
      addressToScVal(caller),
      pauseReasonToScVal(reason),
    ]);
  }

  /** Unpauses the contract, enforcing timelock/quorum unless bypassed. Requires admin. Throws {@link ErrorCode.TimelockActive}. */
  async emergencyUnpause(caller: string): Promise<Transaction> {
    return this.prepareTransaction(caller, "emergency_unpause", [addressToScVal(caller)]);
  }

  /** Casts an admin vote to unpause; auto-unpauses when quorum is reached. */
  async voteUnpause(caller: string): Promise<Transaction> {
    return this.prepareTransaction(caller, "vote_unpause", [addressToScVal(caller)]);
  }

  /** Returns whether the contract is currently paused. */
  async isPaused(sourceAddress: string): Promise<boolean> {
    const val = await this.simulateCall(sourceAddress, "is_paused", []);
    return Boolean(scValToNative(val));
  }

  /** Sets the emergency-unpause timelock duration in seconds (max 604800). Requires admin. */
  async setPauseTimelock(caller: string, seconds: bigint): Promise<Transaction> {
    return this.prepareTransaction(caller, "set_pause_timelock", [
      addressToScVal(caller),
      u64ToScVal(seconds),
    ]);
  }

  /** Sets the number of admin votes required to unpause. Requires admin. Throws {@link ErrorCode.InvalidQuorum}. */
  async setUnpauseQuorum(caller: string, quorum: number): Promise<Transaction> {
    return this.prepareTransaction(caller, "set_unpause_quorum", [
      addressToScVal(caller),
      u32ToScVal(quorum),
    ]);
  }

  /** Returns the configured post-unpause rate-limit cooldown window, in seconds. */
  async getCooldownPeriod(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(sourceAddress, "get_cooldown_period", []);
    return BigInt(scValToNative(val) as number);
  }

  /** Returns the active pause record, or null when the contract is not paused. */
  async getCurrentPauseRecord(sourceAddress: string): Promise<PauseRecord | null> {
    const val = await this.simulateCall(sourceAddress, "get_current_pause_record", []);
    const native = scValToNative(val);
    return native ? parsePauseRecord(val) : null;
  }

  /** Returns the pause record for a given sequence number. Throws when not found. */
  async getPauseRecord(sourceAddress: string, seq: bigint): Promise<PauseRecord> {
    const val = await this.simulateCall(sourceAddress, "get_pause_record", [u64ToScVal(seq)]);
    return parsePauseRecord(val);
  }

  /** Returns the total number of pause events ever recorded. */
  async getPauseHistoryCount(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(sourceAddress, "get_pause_history_count", []);
    return BigInt(scValToNative(val) as number);
  }

  // ─── Escrow ──────────────────────────────────────────────────────────────────

  /** Locks funds in escrow for `recipient`. Requires sender authorization. */
  async createEscrow(sender: string, recipient: string, amount: bigint): Promise<Transaction> {
    return this.prepareTransaction(sender, "create_escrow", [
      addressToScVal(sender),
      addressToScVal(recipient),
      i128ToScVal(amount),
    ]);
  }

  /** Releases escrowed funds to the recipient. Requires admin. Throws {@link ErrorCode.InvalidEscrowStatus}. */
  async releaseEscrow(admin: string, transferId: bigint): Promise<Transaction> {
    return this.prepareTransaction(admin, "release_escrow", [u64ToScVal(transferId)]);
  }

  /** Refunds escrowed funds back to the sender. Requires the escrow's original sender. */
  async refundEscrow(sender: string, transferId: bigint): Promise<Transaction> {
    return this.prepareTransaction(sender, "refund_escrow", [u64ToScVal(transferId)]);
  }

  /** Returns the escrow record for `transferId`. Throws {@link ErrorCode.EscrowNotFound}. */
  async getEscrow(sourceAddress: string, transferId: bigint): Promise<Escrow> {
    const val = await this.simulateCall(sourceAddress, "get_escrow", [u64ToScVal(transferId)]);
    return parseEscrow(val);
  }

  /** Returns the configured escrow storage TTL in ledgers. */
  async getEscrowTtl(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(sourceAddress, "get_escrow_ttl", []);
    return BigInt(scValToNative(val) as number);
  }

  /** Updates the escrow storage TTL. Requires admin. */
  async updateEscrowTtl(admin: string, ttl: bigint): Promise<Transaction> {
    return this.prepareTransaction(admin, "update_escrow_ttl", [u64ToScVal(ttl)]);
  }

  /** Processes a batch of expired escrows, refunding senders. Returns the IDs successfully processed. */
  async processExpiredEscrows(caller: string, transferIds: bigint[]): Promise<Transaction> {
    return this.prepareTransaction(caller, "process_expired_escrows", [
      xdr.ScVal.scvVec(transferIds.map((id) => u64ToScVal(id))),
    ]);
  }

  /** Returns the remittance status for a transfer, or null if not found. */
  async getTransferState(sourceAddress: string, transferId: bigint): Promise<RemittanceStatus | null> {
    const val = await this.simulateCall(sourceAddress, "get_transfer_state", [u64ToScVal(transferId)]);
    const native = scValToNative(val);
    if (!native) return null;
    return Object.keys(native as Record<string, unknown>)[0] as RemittanceStatus;
  }

  // ─── Asset verification ──────────────────────────────────────────────────────

  /** Stores or updates an asset's verification record. Requires admin. Throws {@link ErrorCode.InvalidReputationScore}. */
  async setAssetVerification(
    admin: string,
    assetCode: string,
    issuer: string,
    status: VerificationStatus,
    reputationScore: number,
    trustlineCount: bigint,
    hasToml: boolean
  ): Promise<Transaction> {
    return this.prepareTransaction(admin, "set_asset_verification", [
      stringToScVal(assetCode),
      addressToScVal(issuer),
      verificationStatusToScVal(status),
      u32ToScVal(reputationScore),
      u64ToScVal(trustlineCount),
      boolToScVal(hasToml),
    ]);
  }

  /** Returns the verification record for an asset. Throws {@link ErrorCode.AssetNotFound}. */
  async getAssetVerification(sourceAddress: string, assetCode: string, issuer: string): Promise<AssetVerification> {
    const val = await this.simulateCall(sourceAddress, "get_asset_verification", [
      stringToScVal(assetCode),
      addressToScVal(issuer),
    ]);
    return parseAssetVerification(val);
  }

  /** Returns whether a verification record exists for the given asset. */
  async hasAssetVerification(sourceAddress: string, assetCode: string, issuer: string): Promise<boolean> {
    const val = await this.simulateCall(sourceAddress, "has_asset_verification", [
      stringToScVal(assetCode),
      addressToScVal(issuer),
    ]);
    return Boolean(scValToNative(val));
  }

  /** Validates that an asset is safe to use. Throws {@link ErrorCode.SuspiciousAsset} if flagged. */
  async validateAssetSafety(caller: string, assetCode: string, issuer: string): Promise<Transaction> {
    return this.prepareTransaction(caller, "validate_asset_safety", [
      stringToScVal(assetCode),
      addressToScVal(issuer),
    ]);
  }

  // ─── Fee corridors / strategy ─────────────────────────────────────────────────

  /** Sets a per-corridor fee configuration. Requires admin. */
  async setFeeCorridor(caller: string, corridor: FeeCorridor): Promise<Transaction> {
    return this.prepareTransaction(caller, "set_fee_corridor", [
      addressToScVal(caller),
      feeCorridorToScVal(corridor),
    ]);
  }

  /** Removes a corridor's fee configuration, reverting to the global default. Requires admin. */
  async removeFeeCorridor(caller: string, fromCountry: string, toCountry: string): Promise<Transaction> {
    return this.prepareTransaction(caller, "remove_fee_corridor", [
      addressToScVal(caller),
      stringToScVal(fromCountry),
      stringToScVal(toCountry),
    ]);
  }

  /** Returns the fee corridor configuration for a country pair, or null if unset. */
  async getFeeCorridor(sourceAddress: string, fromCountry: string, toCountry: string): Promise<FeeCorridor | null> {
    const val = await this.simulateCall(sourceAddress, "get_fee_corridor", [
      stringToScVal(fromCountry),
      stringToScVal(toCountry),
    ]);
    const native = scValToNative(val);
    return native ? parseFeeCorridor(val) : null;
  }

  /** Updates the globally active fee strategy. Requires admin. */
  async updateFeeStrategy(caller: string, strategy: FeeStrategy): Promise<Transaction> {
    return this.prepareTransaction(caller, "update_fee_strategy", [
      addressToScVal(caller),
      feeStrategyToScVal(strategy),
    ]);
  }

  /** Returns the currently active fee strategy. */
  async getFeeStrategy(sourceAddress: string): Promise<FeeStrategy> {
    const val = await this.simulateCall(sourceAddress, "get_fee_strategy", []);
    return parseFeeStrategy(scValToNative(val));
  }

  /** Calculates the fee breakdown for `amount` using the active global strategy. */
  async calculateFeeBreakdown(sourceAddress: string, amount: bigint): Promise<FeeBreakdown> {
    const val = await this.simulateCall(sourceAddress, "calculate_fee_breakdown", [i128ToScVal(amount)]);
    return parseFeeBreakdown(val);
  }

  /** Calculates the fee breakdown for `amount` under a specific corridor's configuration. */
  async feeBreakdownCorridor(sourceAddress: string, amount: bigint, corridor: FeeCorridor): Promise<FeeBreakdown> {
    const val = await this.simulateCall(sourceAddress, "fee_breakdown_corridor", [
      i128ToScVal(amount),
      feeCorridorToScVal(corridor),
    ]);
    return parseFeeBreakdown(val);
  }

  /** Returns the global protocol fee in basis points. */
  async getProtocolFeeBps(sourceAddress: string): Promise<number> {
    const val = await this.simulateCall(sourceAddress, "get_protocol_fee_bps", []);
    return Number(scValToNative(val));
  }

  /** Updates the global protocol fee in basis points. Requires admin. Throws {@link ErrorCode.InvalidFeeBps}. */
  async updateProtocolFee(caller: string, feeBps: number): Promise<Transaction> {
    return this.prepareTransaction(caller, "update_protocol_fee", [
      addressToScVal(caller),
      u32ToScVal(feeBps),
    ]);
  }

  /** Returns a token-specific fee override in basis points, or null if unset. */
  async getTokenFeeBps(sourceAddress: string, token: string): Promise<number | null> {
    const val = await this.simulateCall(sourceAddress, "get_token_fee_bps", [addressToScVal(token)]);
    const native = scValToNative(val);
    return native != null ? Number(native) : null;
  }

  /** Sets a token-specific fee override in basis points. Requires admin. */
  async updateTokenFee(caller: string, token: string, feeBps: number): Promise<Transaction> {
    return this.prepareTransaction(caller, "update_token_fee", [
      addressToScVal(caller),
      addressToScVal(token),
      u32ToScVal(feeBps),
    ]);
  }

  // ─── Treasury ────────────────────────────────────────────────────────────────

  /** Returns the configured treasury address. Throws {@link ErrorCode.NotInitialized}. */
  async getTreasury(sourceAddress: string): Promise<string> {
    const val = await this.simulateCall(sourceAddress, "get_treasury", []);
    return String(scValToNative(val));
  }

  /** Updates the treasury address. Requires admin. */
  async updateTreasury(caller: string, treasury: string): Promise<Transaction> {
    return this.prepareTransaction(caller, "update_treasury", [
      addressToScVal(caller),
      addressToScVal(treasury),
    ]);
  }

  // ─── Oracle ──────────────────────────────────────────────────────────────────

  /** Configures the FX-rate oracle address and optional staleness window (in ledgers). Requires caller authorization. */
  async setOracle(caller: string, oracle: string, stalenessWindowLedgers?: number): Promise<Transaction> {
    return this.prepareTransaction(caller, "set_oracle", [
      addressToScVal(caller),
      addressToScVal(oracle),
      optionToScVal(stalenessWindowLedgers !== undefined ? u32ToScVal(stalenessWindowLedgers) : undefined),
    ]);
  }

  /** Returns the configured oracle address, or null if unconfigured. */
  async getOracle(sourceAddress: string): Promise<string | null> {
    const val = await this.simulateCall(sourceAddress, "get_oracle", []);
    const native = scValToNative(val);
    return native ? (native as { toString(): string }).toString() : null;
  }

  /** Returns the current FX rate in basis points from the configured oracle, or null if unavailable. */
  async getOracleRate(sourceAddress: string): Promise<number | null> {
    const val = await this.simulateCall(sourceAddress, "get_oracle_rate", []);
    const native = scValToNative(val);
    return native != null ? Number(native) : null;
  }

  // ─── Rate limiting ───────────────────────────────────────────────────────────

  /** Returns the global rate-limit configuration: max requests, window (seconds), enabled. */
  async getRateLimitConfig(sourceAddress: string): Promise<RateLimitConfig> {
    const val = await this.simulateCall(sourceAddress, "get_rate_limit_config", []);
    return parseRateLimitConfig(scValToNative(val) as [number, bigint | number, boolean]);
  }

  /** Updates the global rate-limit configuration. Requires admin. */
  async updateRateLimitConfig(
    caller: string,
    maxRequests: number,
    windowSeconds: bigint,
    enabled: boolean
  ): Promise<Transaction> {
    return this.prepareTransaction(caller, "update_rate_limit_config", [
      addressToScVal(caller),
      u32ToScVal(maxRequests),
      u64ToScVal(windowSeconds),
      boolToScVal(enabled),
    ]);
  }

  /** Returns the rate-limit status for a specific address. */
  async getRateLimitStatus(sourceAddress: string, address: string): Promise<RateLimitStatus> {
    const val = await this.simulateCall(sourceAddress, "get_rate_limit_status", [addressToScVal(address)]);
    return parseRateLimitStatus(scValToNative(val) as [number, number, bigint | number]);
  }

  /** Returns the post-unpause rate-limit cooldown window, in seconds. */
  async getRateLimitCooldown(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(sourceAddress, "get_rate_limit_cooldown", []);
    return BigInt(scValToNative(val) as number);
  }

  /** Sets the post-unpause rate-limit cooldown window, in seconds. Requires admin. */
  async updateRateLimit(admin: string, cooldownSeconds: bigint): Promise<Transaction> {
    return this.prepareTransaction(admin, "update_rate_limit", [u64ToScVal(cooldownSeconds)]);
  }

  /** Clears stale rate-limit tracking entries for an address, freeing storage. */
  async cleanupRateLimitEntries(caller: string, address: string): Promise<Transaction> {
    return this.prepareTransaction(caller, "cleanup_rate_limit_entries", [addressToScVal(address)]);
  }

  // ─── Remittance / agent extras ────────────────────────────────────────────────

  /** Returns up to `limit` remittance IDs created by `agent`, starting at `offset`. */
  async getRemittancesByAgent(
    sourceAddress: string,
    agent: string,
    offset: bigint,
    limit: bigint
  ): Promise<bigint[]> {
    const val = await this.simulateCall(sourceAddress, "get_remittances_by_agent", [
      addressToScVal(agent),
      u64ToScVal(offset),
      u64ToScVal(limit),
    ]);
    return (scValToNative(val) as number[]).map((id) => BigInt(id));
  }

  /** Returns the minimum agent reputation score required for new agent registration. */
  async getMinAgentReputation(sourceAddress: string): Promise<number> {
    const val = await this.simulateCall(sourceAddress, "get_min_agent_reputation", []);
    return Number(scValToNative(val));
  }

  /** Sets the minimum agent reputation threshold (0-100). Requires admin. Throws {@link ErrorCode.InvalidReputationScore}. */
  async setMinAgentReputation(admin: string, threshold: number): Promise<Transaction> {
    return this.prepareTransaction(admin, "set_min_agent_reputation", [u32ToScVal(threshold)]);
  }

  /** Returns the configured daily limit for a currency/country corridor, or null if unset. */
  async getDailyLimit(sourceAddress: string, currency: string, country: string): Promise<bigint | null> {
    const val = await this.simulateCall(sourceAddress, "get_daily_limit", [
      stringToScVal(currency),
      stringToScVal(country),
    ]);
    const native = scValToNative(val);
    return native != null ? BigInt(native as number) : null;
  }

  /** Sets the dispute window in seconds. Requires admin. */
  async setDisputeWindow(admin: string, seconds: bigint): Promise<Transaction> {
    return this.prepareTransaction(admin, "set_dispute_window", [u64ToScVal(seconds)]);
  }

  /** Sets the maximum batch size for `process_expired_remittances` (1-200). Requires admin. Throws {@link ErrorCode.InvalidBatchSize}. */
  async setMaxExpiredBatchSize(admin: string, size: number): Promise<Transaction> {
    return this.prepareTransaction(admin, "set_max_expired_batch_size", [u32ToScVal(size)]);
  }

  /** Sets the abuse-protection cooldown period in seconds (max 604800). Requires admin. */
  async setCooldownPeriod(caller: string, seconds: bigint): Promise<Transaction> {
    return this.prepareTransaction(caller, "set_cooldown_period", [
      addressToScVal(caller),
      u64ToScVal(seconds),
    ]);
  }

  /** Creates a remittance using corridor-specific fee rules for the given country pair. */
  async createRemittanceWithCorridor(
    sender: string,
    agent: string,
    amount: bigint,
    expiry?: bigint,
    fromCountry?: string,
    toCountry?: string
  ): Promise<Transaction> {
    return this.prepareTransaction(sender, "create_remittance_with_corridor", [
      addressToScVal(sender),
      addressToScVal(agent),
      i128ToScVal(amount),
      optionToScVal(expiry !== undefined ? u64ToScVal(expiry) : undefined),
      optionToScVal(fromCountry !== undefined ? stringToScVal(fromCountry) : undefined),
      optionToScVal(toCountry !== undefined ? stringToScVal(toCountry) : undefined),
    ]);
  }

  /** Creates multiple remittances atomically in a single call, emitting a batch-created event. */
  async createBatchRemittance(sender: string, entries: BatchCreateEntry[]): Promise<Transaction> {
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
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("agent"), val: addressToScVal(e.agent) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount"), val: i128ToScVal(e.amount) }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("expiry"),
            val: optionToScVal(e.expiry !== undefined ? u64ToScVal(e.expiry) : undefined),
          }),
        ])
      )
    );
    return this.prepareTransaction(sender, "create_batch_remittance", [
      addressToScVal(sender),
      entriesScVal,
    ]);
  }

  /** Confirms payout for a batch of remittances in one call. Requires the assigned agent. */
  async confirmBatchPayout(agent: string, remittanceIds: bigint[]): Promise<Transaction> {
    return this.prepareTransaction(agent, "confirm_batch_payout", [
      addressToScVal(agent),
      xdr.ScVal.scvVec(remittanceIds.map((id) => u64ToScVal(id))),
    ]);
  }

  /** Force-finalizes a remittance. Requires admin. */
  async finalizeRemittance(caller: string, remittanceId: bigint): Promise<Transaction> {
    return this.prepareTransaction(caller, "finalize_remittance", [
      addressToScVal(caller),
      u64ToScVal(remittanceId),
    ]);
  }

  // ─── Transaction controller ──────────────────────────────────────────────────

  /** Executes a full remittance + anchor transaction lifecycle. Requires user authorization. */
  async executeTransaction(
    user: string,
    agent: string,
    amount: bigint,
    expiry?: bigint
  ): Promise<Transaction> {
    return this.prepareTransaction(user, "execute_transaction", [
      addressToScVal(user),
      addressToScVal(agent),
      i128ToScVal(amount),
      optionToScVal(expiry !== undefined ? u64ToScVal(expiry) : undefined),
    ]);
  }

  /** Retries a previously failed transaction. */
  async retryTransaction(caller: string, remittanceId: bigint): Promise<Transaction> {
    return this.prepareTransaction(caller, "retry_transaction", [u64ToScVal(remittanceId)]);
  }

  /** Returns the transaction controller's audit record for a remittance. Throws {@link ErrorCode.TransactionNotFound}. */
  async getTransactionStatus(sourceAddress: string, remittanceId: bigint): Promise<TransactionRecord> {
    const val = await this.simulateCall(sourceAddress, "get_transaction_status", [u64ToScVal(remittanceId)]);
    return parseTransactionRecord(val);
  }

  // ─── Settlement / netting ────────────────────────────────────────────────────

  /** Settles a batch of remittances with net settlement optimization. */
  async batchSettleWithNetting(caller: string, entries: BatchSettlementEntry[]): Promise<Transaction> {
    return this.prepareTransaction(caller, "batch_settle_with_netting", [
      xdr.ScVal.scvVec(entries.map(batchSettlementEntryToScVal)),
    ]);
  }

  /** Computes the settlement hash that would be produced for a remittance. */
  async computeSettlementHash(sourceAddress: string, remittanceId: bigint): Promise<string> {
    const val = await this.simulateCall(sourceAddress, "compute_settlement_hash", [u64ToScVal(remittanceId)]);
    return Buffer.from(scValToNative(val) as Uint8Array).toString("hex");
  }

  /** Returns the stored settlement hash for a completed remittance. */
  async getSettlementHash(sourceAddress: string, remittanceId: bigint): Promise<string> {
    const val = await this.simulateCall(sourceAddress, "get_settlement_hash", [u64ToScVal(remittanceId)]);
    return Buffer.from(scValToNative(val) as Uint8Array).toString("hex");
  }

  /** Returns the timestamp of a sender's most recent settlement, or null if none. */
  async getLastSettlementTime(sourceAddress: string, sender: string): Promise<bigint | null> {
    const val = await this.simulateCall(sourceAddress, "get_last_settlement_time", [addressToScVal(sender)]);
    const native = scValToNative(val);
    return native != null ? BigInt(native as number) : null;
  }

  /** Returns the total volume currently in-flight (not yet settled), in stroops. */
  async getInFlightVolume(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(sourceAddress, "get_in_flight_volume", []);
    return BigInt(scValToNative(val) as number);
  }

  // ─── Migration ───────────────────────────────────────────────────────────────

  /** Exports a full contract-state snapshot for migration. Requires admin. */
  async exportMigrationSnapshot(caller: string): Promise<MigrationSnapshot> {
    const val = await this.simulateCall(caller, "export_migration_snapshot", [addressToScVal(caller)]);
    return parseMigrationSnapshot(val);
  }

  // ─── Misc ────────────────────────────────────────────────────────────────────

  /** Returns the deployed contract's semantic version string. */
  async getVersion(sourceAddress: string): Promise<string> {
    const val = await this.simulateCall(sourceAddress, "get_version", []);
    return String(scValToNative(val));
  }

  // ─── DAO governance ──────────────────────────────────────────────────────────

  /** One-time migration from single-admin to multi-admin DAO governance. Requires admin. Throws {@link ErrorCode.GovernanceAlreadyInitialized}. */
  async migrateToGovernance(
    caller: string,
    quorum: number,
    timelockSeconds: bigint,
    proposalTtlSeconds: bigint
  ): Promise<Transaction> {
    return this.prepareTransaction(caller, "migrate_to_governance", [
      addressToScVal(caller),
      u32ToScVal(quorum),
      u64ToScVal(timelockSeconds),
      u64ToScVal(proposalTtlSeconds),
    ]);
  }

  /** Expires a proposal whose TTL has elapsed. Anyone may call this. */
  async expireProposal(caller: string, proposalId: bigint): Promise<Transaction> {
    return this.prepareTransaction(caller, "expire_proposal", [u64ToScVal(proposalId)]);
  }

  /** Deletes already-executed or already-expired proposals to reclaim storage. */
  async cleanupExpiredProposals(caller: string, proposalIds: bigint[]): Promise<Transaction> {
    return this.prepareTransaction(caller, "cleanup_expired_proposals", [
      addressToScVal(caller),
      xdr.ScVal.scvVec(proposalIds.map((id) => u64ToScVal(id))),
    ]);
  }

  /** Returns the list of current admin addresses. */
  async getAdminList(sourceAddress: string): Promise<string[]> {
    const val = await this.simulateCall(sourceAddress, "get_admin_list", []);
    return (scValToNative(val) as { toString(): string }[]).map((a) => a.toString());
  }

  /** Returns the current governance quorum (number of approvals required). */
  async getQuorum(sourceAddress: string): Promise<number> {
    const val = await this.simulateCall(sourceAddress, "get_quorum", []);
    return Number(scValToNative(val));
  }

  /** Returns the current governance timelock in seconds. */
  async getTimelockSeconds(sourceAddress: string): Promise<bigint> {
    const val = await this.simulateCall(sourceAddress, "get_timelock_seconds", []);
    return BigInt(scValToNative(val) as number);
  }

  // ─── Multi-sig admin operations ─────────────────────────────────────────────

  /** Proposes a high-impact admin operation (fee update, fee withdrawal, pause, unpause). */
  async proposeOperation(
    proposer: string,
    operationType: AdminOperationType,
    feeBps: number,
    withdrawTo?: string
  ): Promise<Transaction> {
    return this.prepareTransaction(proposer, "propose_operation", [
      addressToScVal(proposer),
      adminOperationTypeToScVal(operationType),
      u32ToScVal(feeBps),
      optionToScVal(withdrawTo !== undefined ? addressToScVal(withdrawTo) : undefined),
    ]);
  }

  /** Approves a pending multi-sig admin operation; auto-executes once the threshold is met. */
  async approveOperation(approver: string, operationId: bigint): Promise<Transaction> {
    return this.prepareTransaction(approver, "approve_operation", [
      addressToScVal(approver),
      u64ToScVal(operationId),
    ]);
  }

  /** Expires a pending multi-sig operation whose TTL has elapsed. Anyone may call this. */
  async expireOperation(caller: string, operationId: bigint): Promise<Transaction> {
    return this.prepareTransaction(caller, "expire_operation", [u64ToScVal(operationId)]);
  }

  /** Returns a pending multi-sig admin operation by ID. Throws {@link ErrorCode.OperationNotFound}. */
  async getPendingOperation(sourceAddress: string, operationId: bigint): Promise<PendingOperation> {
    const val = await this.simulateCall(sourceAddress, "get_pending_operation", [u64ToScVal(operationId)]);
    return parsePendingOperation(val);
  }

  /** Configures the multi-sig approval threshold and operation TTL. Requires admin. Throws {@link ErrorCode.InvalidMultiSigThreshold}. */
  async setMultisigConfig(caller: string, threshold: number, ttlSeconds: bigint): Promise<Transaction> {
    return this.prepareTransaction(caller, "set_multisig_config", [
      addressToScVal(caller),
      u32ToScVal(threshold),
      u64ToScVal(ttlSeconds),
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

            // Not every contract event carries a remittance id in topic[1]
            // (e.g. admin_added, token_whitelisted, proposal_created), so this
            // is parsed defensively and left undefined when absent.
            let remittanceId: bigint | undefined;
            const idTopic = e.topic[1];
            if (idTopic) {
              try {
                const native = scValToNative(xdr.ScVal.fromXDR(idTopic.toXDR()));
                if (
                  typeof native === "bigint" ||
                  typeof native === "number" ||
                  typeof native === "string"
                ) {
                  remittanceId = BigInt(native);
                }
              } catch {
                remittanceId = undefined;
              }
            }

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

  /**
   * Decode a subscription event's base64 XDR topics and value into native values.
   *
   * `subscribeToRemittanceEvents` hands callers the wire form; `on`/`onAny`
   * deliver this decoded form so handlers never see raw XDR.
   */
  private decodeEventData(event: RemittanceEvent): DecodedEventData {
    const topics = event.raw.topics.map((t) =>
      scValToNative(xdr.ScVal.fromXDR(t, "base64"))
    );
    const value = scValToNative(xdr.ScVal.fromXDR(event.raw.value, "base64"));
    return { topics, value, raw: event.raw };
  }

  /**
   * Subscribe to typed contract events with full TypeScript type safety.
   *
   * `event.data` carries the decoded event: `topics` and `value` converted from
   * XDR to native values, plus `remittanceId` for remittance-scoped event types.
   * The original base64 XDR remains available at `event.data.raw`.
   *
   * Remittance-scoped events whose ID topic cannot be decoded are skipped, so
   * `event.data.remittanceId` is always present for those event types.
   *
   * @param eventType - The specific event type to listen for
   * @param handler - Callback function called when an event of this type is emitted
   * @param options - Optional subscription options (filter by remittanceId, sender, agent, etc)
   * @returns Unsubscribe function to stop listening
   *
   * @example
   * const unsubscribe = client.on('created', (event) => {
   *   console.log(`Remittance ${event.data.remittanceId} created`);
   *   console.log('payload:', event.data.value);
   * });
   * // Later:
   * unsubscribe();
   */
  on<T extends RemittanceEventType>(
    eventType: T,
    handler: EventHandler<T>,
    options?: SubscribeOptions
  ): Unsubscribe {
    return this.subscribeToRemittanceEvents(
      (event) => {
        if (event.type !== eventType) return;
        const data = this.buildEventData(event);
        if (!data) return;
        handler({
          type: eventType,
          data: data as EventDataMap[T],
          ledger: event.ledger,
          ledgerClosedAt: event.ledgerClosedAt,
        });
      },
      options
    );
  }

  /**
   * Subscribe to multiple event types with a single handler.
   *
   * `event.data` follows the same decoded shape as {@link on}.
   *
   * @param eventTypes - Array of event types to listen for
   * @param handler - Callback called when any of the specified events are emitted
   * @param options - Optional subscription options
   * @returns Unsubscribe function
   *
   * @example
   * const unsubscribe = client.onAny(['created', 'completed', 'failed'], (event) => {
   *   console.log(`Event: ${event.type}`, event.data.value);
   * });
   */
  onAny(
    eventTypes: RemittanceEventType[],
    handler: AnyEventHandler,
    options?: SubscribeOptions
  ): Unsubscribe {
    return this.subscribeToRemittanceEvents(
      (event) => {
        if (!eventTypes.includes(event.type)) return;
        const data = this.buildEventData(event);
        if (!data) return;
        handler({
          type: event.type,
          data: data as EventDataMap[RemittanceEventType],
          ledger: event.ledger,
          ledgerClosedAt: event.ledgerClosedAt,
        });
      },
      options
    );
  }

  /**
   * Decode an event for handler delivery, returning null when the event is
   * remittance-scoped but carries no decodable ID — such an event is malformed
   * and would break the `remittanceId: bigint` contract of {@link EventDataMap}.
   */
  private buildEventData(
    event: RemittanceEvent
  ): DecodedEventData | (DecodedEventData & { remittanceId: bigint }) | null {
    const decoded = this.decodeEventData(event);
    const scoped: readonly string[] = SwiftRemitClient.REMITTANCE_SCOPED_EVENTS;
    if (!scoped.includes(event.type)) {
      return decoded;
    }
    if (event.remittanceId === undefined) return null;
    return { ...decoded, remittanceId: event.remittanceId };
  }

  /** Event types that carry a remittance ID in their second topic. */
  private static readonly REMITTANCE_SCOPED_EVENTS: RemittanceScopedEventType[] = [
    "created",
    "completed",
    "cancelled",
    "failed",
    "disputed",
    "partial_payout",
    "expired",
    "dispute_raised",
    "dispute_resolved",
    "settlement_completed",
  ];

  /**
   * Get all available contract event types.
   */
  static readonly ALL_EVENTS: RemittanceEventType[] = [
    "created",
    "completed",
    "cancelled",
    "failed",
    "disputed",
    "partial_payout",
    "expired",
    "agent_registered",
    "agent_removed",
    "fee_updated",
    "paused",
    "unpaused",
    "admin_added",
    "admin_removed",
    "circuit_breaker_paused",
    "circuit_breaker_unpaused",
    "user_blacklisted",
    "user_removed_from_blacklist",
    "token_whitelisted",
    "token_removed_from_whitelist",
    "daily_limit_updated",
    "dispute_raised",
    "dispute_resolved",
    "proposal_created",
    "proposal_voted",
    "proposal_approved",
    "proposal_executed",
    "settlement_completed",
  ];
}
