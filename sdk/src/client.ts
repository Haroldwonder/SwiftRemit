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
  ContractConfig,
  KycApprovalEntry,
} from "./types.js";
import { parseContractError, SwiftRemitError, ErrorCode, TransactionTimeoutError } from "./errors.js";
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
  parseContractConfig,
} from "./convert.js";

/** Maximum number of entries allowed in a single batch remittance call. */
export const MAX_BATCH_SIZE = 50;

/** Maximum number of entries allowed in a single batch KYC update call. */
export const MAX_KYC_BATCH_SIZE = 50;

/** Maximum number of records returned by a paginated remittance-record view. */
export const MAX_REMITTANCE_RECORDS_LIMIT = 100;

/** Delay between confirmation polls after a transaction is submitted. */
export const CONFIRMATION_POLL_INTERVAL_MS = 1_000;

/** Default wall-clock budget for confirming a submitted transaction. */
export const DEFAULT_CONFIRMATION_WAIT_MS = 90_000;

/**
 * Hard cap on confirmation polls, independent of the wall-clock deadline. Sized
 * well above what `DEFAULT_CONFIRMATION_WAIT_MS` needs so it only ever fires if
 * the clock misbehaves.
 */
export const MAX_CONFIRMATION_POLLS = 300;

/** Options accepted by `submitTransaction` and `submitSignedTransaction`. */
export interface SubmitOptions {
  /**
   * Per-call retry policy that overrides the client's `writeRetryPolicy`.
   * Leave unset for non-idempotent operations.
   */
  retryPolicy?: RetryPolicy;
  /**
   * How long to wait for the transaction to reach a terminal status, in ms.
   * Defaults to {@link DEFAULT_CONFIRMATION_WAIT_MS}. Exceeding it throws
   * {@link TransactionTimeoutError} rather than hanging.
   */
  maxWaitMs?: number;
}

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
   * @param options.maxWaitMs - How long to wait for the transaction to reach a
   *   terminal status before giving up (default: 90 s). Throws
   *   {@link TransactionTimeoutError} when exceeded.
   * @throws {TransactionTimeoutError} if confirmation does not arrive within
   *   `maxWaitMs`. The transaction may still land in a later ledger.
   */
  async submitTransaction(
    tx: Transaction,
    keypair: Keypair,
    options?: SubmitOptions
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
   * @param options.maxWaitMs - How long to wait for the transaction to reach a
   *   terminal status before giving up (default: 90 s).
   * @throws {TransactionTimeoutError} if confirmation does not arrive within
   *   `maxWaitMs`. The transaction may still land in a later ledger.
   */
  async submitSignedTransaction(
    tx: Transaction,
    options?: SubmitOptions
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
    const maxWaitMs = options?.maxWaitMs ?? DEFAULT_CONFIRMATION_WAIT_MS;
    const startedAt = Date.now();
    let polls = 1;

    let getResult = await withRetryPolicy(
      () => this.server.getTransaction(sendResult.hash),
      readPolicy,
      defaults
    );
    while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      // Two independent bounds: a wall-clock deadline, plus a hard poll cap so a
      // stalled or time-warped clock can still not spin this loop forever.
      if (
        Date.now() - startedAt >= maxWaitMs ||
        polls >= MAX_CONFIRMATION_POLLS
      ) {
        throw new TransactionTimeoutError(
          sendResult.hash,
          Date.now() - startedAt,
          polls
        );
      }
      await new Promise((r) => setTimeout(r, CONFIRMATION_POLL_INTERVAL_MS));
      getResult = await withRetryPolicy(
        () => this.server.getTransaction(sendResult.hash),
        readPolicy,
        defaults
      );
      polls++;
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

  /**
   * Get paginated full remittance records for a sender.
   *
   * Unlike {@link getRemittancesBySender}, which returns only IDs and forces a
   * follow-up `getRemittance` simulation per item, this view returns the full
   * records in a single call — ideal for history pages.
   *
   * @param sourceAddress - Query account address
   * @param sender - Sender address to filter remittances
   * @param offset - Pagination offset
   * @param limit - Maximum number of records to return (capped at 100 by the contract)
   * @returns Array of full remittance records for the sender
   */
  async getRemittanceRecordsBySender(
    sourceAddress: string,
    sender: string,
    offset: bigint,
    limit: bigint
  ): Promise<Remittance[]> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_remittance_records_by_sender",
      [
        addressToScVal(sender),
        u64ToScVal(offset),
        u64ToScVal(limit),
      ]
    );
    const native = scValToNative(val) as unknown[];
    return native.map((_, i) => parseRemittance(xdr.ScVal.scvVec(
      (val.vec() ?? []).map((v) => v)
    ).vec()![i]));
  }

  /**
   * Get paginated full remittance records for an agent.
   *
   * Unlike {@link getRemittancesByAgent}, which returns only IDs and forces a
   * follow-up `getRemittance` simulation per item, this view returns the full
   * records in a single call — ideal for history pages.
   *
   * @param sourceAddress - Query account address
   * @param agent - Agent address to filter remittances
   * @param offset - Pagination offset
   * @param limit - Maximum number of records to return (capped at 100 by the contract)
   * @returns Array of full remittance records for the agent
   */
  async getRemittanceRecordsByAgent(
    sourceAddress: string,
    agent: string,
    offset: bigint,
    limit: bigint
  ): Promise<Remittance[]> {
    const val = await this.simulateCall(
      sourceAddress,
      "get_remittance_records_by_agent",
      [
        addressToScVal(agent),
        u64ToScVal(offset),
        u64ToScVal(limit),
      ]
    );
    const vec = val.vec() ?? [];
    return vec.map((item) => parseRemittance(item));
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

  /**
   * Get all admin-tunable configuration parameters in a single call.
   *
   * Replaces a fan-out of individual getters (`getPlatformFeeBps`,
   * `getProtocolFeeBps`, `getDisputeWindow`, `getProcessingTimeout`,
   * `getEscrowTtl`, `getRateLimitConfig`, `getMinAgentReputation`,
   * `getCooldownPeriod`, `getTreasury`, `getOracle`, ...) with one simulation —
   * ideal for admin dashboards and `ContractHealth` views.
   *
   * @param sourceAddress - Query account address
   * @returns The full contract configuration
   */
  async getConfig(sourceAddress: string): Promise<ContractConfig> {
    const val = await this.simulateCall(sourceAddress, "get_config", []);
    return parseContractConfig(val);
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
  /**
   * Create multiple remittances via independent transactions (partial failure tolerated).
   * 
   * This method submits each remittance as a separate transaction with retry logic.
   * If some transactions fail, the method still returns successfully with per-item
   * success/failure status in the result array.
   * 
   * @see {@link batchCreateRemittances} for atomic batch creation (all-or-nothing)
   * @see {@link createBatchRemittance} for atomic batch creation via create_batch_remittance contract method
   * 
   * @param sender - The sender's Stellar address
   * @param entries - Array of remittance entries (max 50)
   * @returns BatchCreateResponse with per-item results and success/failure counts
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
          return