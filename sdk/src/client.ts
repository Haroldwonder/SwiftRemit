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
  EventHandler,
} from "./types.js";
import { parseContractError, SwiftRemitError, ErrorCode } from "./errors.js";
import { withRetry } from "./retry.js";
import {
  parseRemittance,
  parseAgentStats,
  parseCircuitBreakerStatus,
  parseHealthStatus,
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

  /** Sign and submit a prepared transaction; wait for confirmation. */
  async submitTransaction(
    tx: Transaction,
    keypair: Keypair
  ): Promise<SorobanRpc.Api.GetSuccessfulTransactionResponse> {
    tx.sign(keypair);
    const sendResult = await withRetry(
      () => this.server.sendTransaction(tx),
      this.retries,
      this.retryDelayMs,
      this.retryBackoffFactor
    );
    if (sendResult.status === "ERROR") {
      throw new Error(`Submit failed: ${JSON.stringify(sendResult.errorResult)}`);
    }

    let getResult = await withRetry(
      () => this.server.getTransaction(sendResult.hash),
      this.retries,
      this.retryDelayMs,
      this.retryBackoffFactor
    );
    while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((r) => setTimeout(r, 1000));
      getResult = await withRetry(
        () => this.server.getTransaction(sendResult.hash),
        this.retries,
        this.retryDelayMs,
        this.retryBackoffFactor
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
    args: xdr.ScVal[]
  ): Promise<xdr.ScVal> {
    const account = await this.withTimeout(this.server.getAccount(sourceAddress));
    const tx = new TransactionBuilder(account, {
      fee: this.fee,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await withRetry(
      () => this.server.simulateTransaction(tx),
      this.retries,
      this.retryDelayMs,
      this.retryBackoffFactor
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

  /**
   * Subscribe to typed contract events with full TypeScript type safety.
   * 
   * @param eventType - The specific event type to listen for
   * @param handler - Callback function called when an event of this type is emitted
   * @param options - Optional subscription options (filter by remittanceId, sender, agent, etc)
   * @returns Unsubscribe function to stop listening
   * 
   * @example
   * const unsubscribe = client.on('created', (event) => {
   *   console.log(`Remittance ${event.data.remittanceId} created`);
   * });
   * // Later:
   * unsubscribe();
   */
  on<T extends RemittanceEventType>(
    eventType: T,
    handler: EventHandler<T>,
    options?: SubscribeOptions
  ): Unsubscribe {
    return this.subscribe(
      (event) => {
        if (event.type === eventType) {
          handler({
            type: eventType,
            data: event.raw,
            ledger: event.ledger,
            ledgerClosedAt: event.ledgerClosedAt,
          });
        }
      },
      options
    );
  }

  /**
   * Subscribe to multiple event types with a single handler.
   * 
   * @param eventTypes - Array of event types to listen for
   * @param handler - Callback called when any of the specified events are emitted
   * @param options - Optional subscription options
   * @returns Unsubscribe function
   * 
   * @example
   * const unsubscribe = client.onAny(['created', 'completed', 'failed'], (event) => {
   *   console.log(`Event: ${event.type}`);
   * });
   */
  onAny(
    eventTypes: RemittanceEventType[],
    handler: (event: { type: RemittanceEventType; ledger: number; ledgerClosedAt: string }) => Promise<void> | void,
    options?: SubscribeOptions
  ): Unsubscribe {
    return this.subscribe(
      (event) => {
        if (eventTypes.includes(event.type)) {
          handler({
            type: event.type,
            ledger: event.ledger,
            ledgerClosedAt: event.ledgerClosedAt,
          });
        }
      },
      options
    );
  }

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
