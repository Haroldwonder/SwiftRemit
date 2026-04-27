import {
  Contract,
  SorobanRpc,
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
  RemittanceEvent,
  RemittanceEventType,
  SubscribeOptions,
  Unsubscribe,
} from "./types.js";
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
} from "./convert.js";

/** Errors that should NOT be retried (auth failures, validation errors, etc.) */
function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // Retry on network errors, 429 Too Many Requests, and 503 Service Unavailable
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("network") ||
    msg.includes("timeout")
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: number,
  backoffFactor: number
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransientError(err)) throw err;
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(backoffFactor, attempt)));
      attempt++;
    }
  }
}

export class SwiftRemitClient {
  private readonly contract: Contract;
  private readonly server: SorobanRpc.Server;
  private readonly networkPassphrase: string;
  private readonly fee: string;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly retryBackoffFactor: number;

  constructor(options: SwiftRemitClientOptions) {
    this.contract = new Contract(options.contractId);
    this.server = new SorobanRpc.Server(options.rpcUrl, { allowHttp: true });
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
    const account = await this.server.getAccount(sourceAddress);
    const tx = new TransactionBuilder(account, {
      fee: this.fee,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simResult = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
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

    let getResult = await this.server.getTransaction(sendResult.hash);
    while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((r) => setTimeout(r, 1000));
      getResult = await this.server.getTransaction(sendResult.hash);
    }

    if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`Transaction failed: ${JSON.stringify(getResult)}`);
    }
    return getResult as SorobanRpc.Api.GetSuccessfulTransactionResponse;
  }

  // ─── Read-only calls (simulate only) ────────────────────────────────────────

  private async simulateCall(
    sourceAddress: string,
    method: string,
    args: xdr.ScVal[]
  ): Promise<xdr.ScVal> {
    const account = await this.server.getAccount(sourceAddress);
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

  // ─── Event subscription ──────────────────────────────────────────────────────

  /**
   * Subscribe to real-time remittance contract events via Horizon SSE.
   *
   * Uses `SorobanRpc.Server.getEvents` under the hood, polling from the latest
   * ledger and reconnecting automatically on stream disconnect.
   *
   * @param callback - Called for each matching event.
   * @param options  - Optional filters (remittanceId, sender, agent) and cursor.
   * @returns An `Unsubscribe` function — call it to stop the subscription.
   *
   * @example
   * ```ts
   * const unsub = client.subscribeToRemittanceEvents(
   *   (event) => console.log(event.type, event.remittanceId),
   *   { remittanceId: 42n }
   * );
   * // later…
   * unsub();
   * ```
   */
  subscribeToRemittanceEvents(
    callback: (event: RemittanceEvent) => void,
    options: SubscribeOptions = {}
  ): Unsubscribe {
    let stopped = false;
    let cursor = options.cursor ?? "now";
    // Reconnect delay in ms; doubles on each failure up to 30 s
    let reconnectDelayMs = 1_000;

    const contractId = this.contract.contractId();

    const poll = async (): Promise<void> => {
      while (!stopped) {
        try {
          const response = await this.server.getEvents({
            startLedger: cursor === "now" ? undefined : undefined,
            filters: [
              {
                type: "contract",
                contractIds: [contractId],
                topics: [EVENT_TYPES.map((t) => xdr.ScVal.scvSymbol(t))],
              },
            ],
            cursor: cursor === "now" ? undefined : cursor,
            limit: 100,
          } as Parameters<typeof this.server.getEvents>[0]);

          reconnectDelayMs = 1_000; // reset on success

          for (const event of response.events) {
            // Advance cursor so we don't re-process on reconnect
            cursor = event.pagingToken;

            const eventType = this.parseEventType(event);
            if (!eventType) continue;

            const remittanceId = this.parseRemittanceId(event);

            // Apply filters
            if (options.remittanceId !== undefined && remittanceId !== options.remittanceId) continue;

            const remittanceEvent: RemittanceEvent = {
              type: eventType,
              remittanceId,
              ledger: event.ledger,
              ledgerClosedAt: event.ledgerClosedAt,
              raw: {
                topics: event.topic.map((t) => t.toXDR("base64")),
                value: event.value.toXDR("base64"),
              },
            };

            try {
              callback(remittanceEvent);
            } catch {
              // Swallow callback errors so the stream stays alive
            }
          }

          // Wait before next poll (Horizon closes SSE after ~60 s; we poll every 5 s)
          await this.sleep(5_000);
        } catch (err) {
          if (stopped) break;
          console.warn(
            `[SwiftRemitClient] Event stream error, reconnecting in ${reconnectDelayMs}ms:`,
            err
          );
          await this.sleep(reconnectDelayMs);
          reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
        }
      }
    };

    // Start polling in the background (fire-and-forget)
    poll().catch(() => {/* already handled inside */});

    return () => {
      stopped = true;
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseEventType(event: SorobanRpc.Api.EventResponse): RemittanceEventType | null {
    if (!event.topic.length) return null;
    try {
      const sym = scValToNative(event.topic[0]) as string;
      if ((EVENT_TYPES as string[]).includes(sym)) return sym as RemittanceEventType;
    } catch {
      // ignore malformed topics
    }
    return null;
  }

  private parseRemittanceId(event: SorobanRpc.Api.EventResponse): bigint {
    try {
      // Convention: second topic is the remittance ID (u64)
      if (event.topic.length >= 2) {
        return BigInt(scValToNative(event.topic[1]) as number);
      }
    } catch {
      // ignore
    }
    return 0n;
  }
}
