import {
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
  StrKey,
} from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { SwiftRemitError, ErrorCode } from "./errors.js";
import type {
  Remittance,
  RemittanceStatus,
  AgentStats,
  CircuitBreakerStatus,
  PauseReason,
  HealthStatus,
  FeeBreakdown,
  Proposal,
  ProposalState,
  ProposalAction,
  Escrow,
  EscrowStatus,
  AssetVerification,
  VerificationStatus,
  PauseRecord,
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
  RecipientDetails,
} from "./types.js";

// ─── ScVal → Native ──────────────────────────────────────────────────────────

export function parseRemittance(val: xdr.ScVal): Remittance {
  const map = scValToNative(val) as Record<string, unknown>;

  const id = assertDefined<number>(map, "id");
  const sender = assertDefined<{ toString(): string }>(map, "sender");
  const agent = assertDefined<{ toString(): string }>(map, "agent");
  const amount = assertDefined<number>(map, "amount");
  const fee = assertDefined<number>(map, "fee");
  const status = assertDefined<Record<string, unknown>>(map, "status");
  const token = assertDefined<{ toString(): string }>(map, "token");
  const createdAt = assertDefined<number>(map, "created_at");

  return {
    id: BigInt(id),
    sender: sender.toString(),
    agent: agent.toString(),
    amount: BigInt(amount),
    fee: BigInt(fee),
    status: parseStatus(status),
    expiry: map["expiry"] != null ? BigInt(map["expiry"] as number) : null,
    token: token.toString(),
    createdAt: BigInt(createdAt),
    failedAt:
      map["failed_at"] != null ? BigInt(map["failed_at"] as number) : null,
    expiresAt:
      map["expires_at"] != null ? BigInt(map["expires_at"] as number) : null,
  };
}

function assertDefined<T>(map: Record<string, unknown>, key: string): T {
  const value = map[key];
  if (value === undefined || value === null) {
    throw new SwiftRemitError(
      ErrorCode.DataCorruption,
      `parseRemittance: missing required field "${key}"`
    );
  }
  return value as T;
}

function parseStatus(raw: Record<string, unknown>): RemittanceStatus {
  if (!raw || typeof raw !== "object") {
    throw new SwiftRemitError(
      ErrorCode.DataCorruption,
      "parseRemittance: invalid status value"
    );
  }

  const statusKeys = Object.keys(raw);
  if (statusKeys.length !== 1) {
    throw new SwiftRemitError(
      ErrorCode.DataCorruption,
      "parseRemittance: invalid or missing status field"
    );
  }

  const statusKey = statusKeys[0];
  const validStatuses = [
    "Pending",
    "Processing",
    "Completed",
    "Cancelled",
    "Failed",
    "Disputed",
  ] as const;

  if (!validStatuses.includes(statusKey as RemittanceStatus)) {
    throw new SwiftRemitError(
      ErrorCode.DataCorruption,
      `parseRemittance: unknown status \"${statusKey}\"`
    );
  }

  return statusKey as RemittanceStatus;
}

export function parseAgentStats(val: xdr.ScVal): AgentStats {
  const map = scValToNative(val) as Record<string, unknown>;
  return {
    totalSettlements: Number(map["total_settlements"]),
    failedSettlements: Number(map["failed_settlements"]),
    totalSettlementTime: BigInt(map["total_settlement_time"] as number),
    disputeCount: Number(map["dispute_count"]),
    successRateBps: Number(map["success_rate_bps"]),
    lastActiveTimestamp: BigInt(map["last_active_timestamp"] as number),
  };
}

export function parseCircuitBreakerStatus(
  val: xdr.ScVal
): CircuitBreakerStatus {
  const map = scValToNative(val) as Record<string, unknown>;
  const reasonRaw = map["pause_reason"] as Record<string, unknown> | null;
  return {
    isPaused: Boolean(map["is_paused"]),
    pauseReason: reasonRaw
      ? (Object.keys(reasonRaw)[0] as PauseReason)
      : null,
    pauseTimestamp:
      map["pause_timestamp"] != null
        ? BigInt(map["pause_timestamp"] as number)
        : null,
    timelockSeconds: BigInt(map["timelock_seconds"] as number),
    unpauseQuorum: Number(map["unpause_quorum"]),
    currentVoteCount: Number(map["current_vote_count"]),
  };
}

export function parseHealthStatus(val: xdr.ScVal): HealthStatus {
  const map = scValToNative(val) as Record<string, unknown>;
  return {
    initialized: Boolean(map["initialized"]),
    paused: Boolean(map["paused"]),
    adminCount: Number(map["admin_count"]),
    totalRemittances: BigInt(map["total_remittances"] as number),
    accumulatedFees: BigInt(map["accumulated_fees"] as number),
  };
}

export function parseFeeBreakdown(val: xdr.ScVal): FeeBreakdown {
  const map = scValToNative(val) as Record<string, unknown>;
  return {
    platformFee: BigInt(map["platform_fee"] as number),
    protocolFee: BigInt(map["protocol_fee"] as number),
    netAmount: BigInt(map["net_amount"] as number),
  };
}

export function parseProposal(val: xdr.ScVal): Proposal {
  const map = scValToNative(val) as Record<string, unknown>;
  const stateRaw = map["state"] as Record<string, unknown>;
  const actionRaw = map["action"] as Record<string, unknown>;
  const actionKey = Object.keys(actionRaw)[0];
  const actionVal = actionRaw[actionKey];

  let action: ProposalAction;
  if (actionKey === "UpdateFee") {
    action = { UpdateFee: Number(actionVal) };
  } else if (actionKey === "UpdateQuorum") {
    action = { UpdateQuorum: Number(actionVal) };
  } else if (actionKey === "UpdateTimelock") {
    action = { UpdateTimelock: BigInt(actionVal as number) };
  } else if (actionKey === "UpdateCooldownPeriod") {
    action = { UpdateCooldownPeriod: BigInt(actionVal as number) };
  } else if (actionKey === "AdjustReputationThreshold") {
    action = { AdjustReputationThreshold: Number(actionVal) };
  } else {
    action = { [actionKey]: String(actionVal) } as ProposalAction;
  }

  return {
    id: BigInt(map["id"] as number),
    proposer: String(map["proposer"]),
    action,
    state: Object.keys(stateRaw)[0] as ProposalState,
    createdAt: BigInt(map["created_at"] as number),
    expiry: BigInt(map["expiry"] as number),
    approvalCount: Number(map["approval_count"]),
    approvalTimestamp:
      map["approval_timestamp"] != null
        ? BigInt(map["approval_timestamp"] as number)
        : null,
    executeAfter:
      map["execute_after"] != null
        ? BigInt(map["execute_after"] as number)
        : null,
  };
}

// ─── Input validation ─────────────────────────────────────────────────────────

/**
 * Validate a remittance amount before building any transaction.
 *
 * Rules:
 *  - Must be a `bigint` (rejects floats and strings that would silently round).
 *  - Must be strictly greater than zero (zero amounts are contract-rejected anyway,
 *    but catching it here gives a cleaner error message).
 *  - Must not be negative.
 *
 * @throws {SwiftRemitError} with `ErrorCode.InvalidAmount` on any violation.
 */
export function validateAmount(amount: bigint): void {
  if (typeof amount !== "bigint") {
    throw new SwiftRemitError(
      ErrorCode.InvalidAmount,
      `Amount must be a bigint (e.g. toStroops(100)); received ${typeof amount}. ` +
        `Passing a floating-point number can silently produce a wrong value.`
    );
  }
  if (amount <= 0n) {
    throw new SwiftRemitError(
      ErrorCode.InvalidAmount,
      `Amount must be greater than zero; received ${amount}.`
    );
  }
}

/**
 * Validate a Stellar/Soroban address before building any transaction.
 *
 * Rules:
 *  - Must be a non-empty string.
 *  - Must start with "G" (Stellar public-key prefix) or "C" (contract address prefix).
 *  - Must be exactly 56 characters long (StrKey encoding of a 32-byte key).
 *  - Must consist only of valid Base-32 characters (A-Z, 2-7).
 *
 * We intentionally do NOT call `Address.fromString` here because that throws an
 * opaque XDR error; we want a clear, actionable message.
 *
 * @throws {SwiftRemitError} with `ErrorCode.InvalidAddress` on any violation.
 */
export function validateAddress(address: string): void {
  if (typeof address !== "string" || address.length === 0) {
    throw new SwiftRemitError(
      ErrorCode.InvalidAddress,
      `Address must be a non-empty string; received ${JSON.stringify(address)}.`
    );
  }
  // Stellar public key = 56 characters, starts with G.
  // Contract address  = 56 characters, starts with C.
  if (address.length !== 56) {
    throw new SwiftRemitError(
      ErrorCode.InvalidAddress,
      `Address must be exactly 56 characters long; received ${address.length} characters: "${address}".`
    );
  }
  if (address[0] !== "G" && address[0] !== "C") {
    throw new SwiftRemitError(
      ErrorCode.InvalidAddress,
      `Address must start with "G" (account) or "C" (contract); received "${address[0]}".`
    );
  }
  // StrKey alphabet: A-Z and 2-7 (RFC 4648 Base32, uppercase, no padding)
  if (!/^[A-Z2-7]{56}$/.test(address)) {
    throw new SwiftRemitError(
      ErrorCode.InvalidAddress,
      `Address contains invalid characters. A Stellar StrKey must use only [A-Z2-7]: "${address}".`
    );
  }
}

// ─── Native → ScVal ──────────────────────────────────────────────────────────

/**
 * Convert a Stellar address string to an ScVal, with pre-validation.
 * Throws a clear `SwiftRemitError(InvalidAddress)` instead of an opaque XDR error.
 */
export function addressToScVal(address: string): xdr.ScVal {
  validateAddress(address);
  return nativeToScVal(Address.fromString(address), { type: "address" });
}

export function u64ToScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

export function i128ToScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

export function optionToScVal(
  value: xdr.ScVal | undefined
): xdr.ScVal {
  if (value === undefined) {
    return xdr.ScVal.scvVoid();
  }
  return xdr.ScVal.scvVec([value]);
}

export function bytesNToScVal(buf: Buffer): xdr.ScVal {
  return xdr.ScVal.scvBytes(buf);
}

export function stringToScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "string" });
}

export function u32ToScVal(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

export function boolToScVal(value: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(value);
}

export function bytes32HexToScVal(hex: string): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(hex.replace(/^0x/, ""), "hex"));
}

/**
 * Encode a fieldless (unit) `#[contracttype] enum` variant as a Soroban
 * ScVal: a single-entry map of `{ Symbol(variant): void }`, matching the
 * wire format Soroban SDK generates for enums (see {@link parseUnitEnum}).
 */
export function unitEnumToScVal(variant: string): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol(variant),
      val: xdr.ScVal.scvVoid(),
    }),
  ]);
}

/** Encode an enum variant that carries a single associated value. */
export function dataEnumToScVal(variant: string, value: xdr.ScVal): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(variant), val: value }),
  ]);
}

/** Read the single variant name out of a decoded unit/data enum object. */
function parseUnitEnum<T extends string>(raw: unknown, fieldName: string): T {
  if (!raw || typeof raw !== "object") {
    throw new SwiftRemitError(ErrorCode.DataCorruption, `${fieldName}: invalid enum value`);
  }
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length !== 1) {
    throw new SwiftRemitError(ErrorCode.DataCorruption, `${fieldName}: invalid enum value`);
  }
  return keys[0] as T;
}

export function roleToScVal(role: Role): xdr.ScVal {
  return unitEnumToScVal(role);
}

export function verificationStatusToScVal(status: VerificationStatus): xdr.ScVal {
  return unitEnumToScVal(status);
}

export function pauseReasonToScVal(reason: PauseReason): xdr.ScVal {
  return unitEnumToScVal(reason);
}

export function feeStrategyToScVal(strategy: FeeStrategy): xdr.ScVal {
  if (strategy === "Corridor") return unitEnumToScVal("Corridor");
  if ("Percentage" in strategy) return dataEnumToScVal("Percentage", u32ToScVal(strategy.Percentage));
  if ("Flat" in strategy) return dataEnumToScVal("Flat", i128ToScVal(strategy.Flat));
  if ("Dynamic" in strategy) return dataEnumToScVal("Dynamic", u32ToScVal(strategy.Dynamic));
  throw new SwiftRemitError(ErrorCode.DataCorruption, "feeStrategyToScVal: unknown strategy variant");
}

export function parseFeeStrategy(raw: unknown): FeeStrategy {
  if (raw === null || typeof raw !== "object") {
    throw new SwiftRemitError(ErrorCode.DataCorruption, "parseFeeStrategy: invalid value");
  }
  const map = raw as Record<string, unknown>;
  const keys = Object.keys(map);
  if (keys.length !== 1) {
    throw new SwiftRemitError(ErrorCode.DataCorruption, "parseFeeStrategy: invalid value");
  }
  const key = keys[0];
  if (key === "Corridor") return "Corridor";
  if (key === "Percentage") return { Percentage: Number(map[key]) };
  if (key === "Flat") return { Flat: BigInt(map[key] as number) };
  if (key === "Dynamic") return { Dynamic: Number(map[key]) };
  throw new SwiftRemitError(ErrorCode.DataCorruption, `parseFeeStrategy: unknown variant "${key}"`);
}

export function feeCorridorToScVal(corridor: FeeCorridor): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("from_country"), val: stringToScVal(corridor.fromCountry) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("to_country"), val: stringToScVal(corridor.toCountry) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("strategy"), val: feeStrategyToScVal(corridor.strategy) }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("protocol_fee_bps"),
      val: optionToScVal(corridor.protocolFeeBps != null ? u32ToScVal(corridor.protocolFeeBps) : undefined),
    }),
  ]);
}

export function parseFeeCorridor(val: xdr.ScVal): FeeCorridor {
  const map = scValToNative(val) as Record<string, unknown>;
  return {
    fromCountry: String(map["from_country"]),
    toCountry: String(map["to_country"]),
    strategy: parseFeeStrategy(map["strategy"]),
    protocolFeeBps: map["protocol_fee_bps"] != null ? Number(map["protocol_fee_bps"]) : null,
  };
}

export function parseEscrow(val: xdr.ScVal): Escrow {
  const map = scValToNative(val) as Record<string, unknown>;
  return {
    transferId: BigInt(map["transfer_id"] as number),
    sender: String(map["sender"]),
    recipient: String(map["recipient"]),
    amount: BigInt(map["amount"] as number),
    expiry: map["expiry"] != null ? BigInt(map["expiry"] as number) : null,
    status: parseUnitEnum<EscrowStatus>(map["status"], "parseEscrow.status"),
  };
}

export function parseAssetVerification(val: xdr.ScVal): AssetVerification {
  const map = scValToNative(val) as Record<string, unknown>;
  return {
    assetCode: String(map["asset_code"]),
    issuer: String(map["issuer"]),
    status: parseUnitEnum<VerificationStatus>(map["status"], "parseAssetVerification.status"),
    reputationScore: Number(map["reputation_score"]),
    lastVerified: BigInt(map["last_verified"] as number),
    trustlineCount: BigInt(map["trustline_count"] as number),
    hasToml: Boolean(map["has_toml"]),
  };
}

export function parsePauseRecord(val: xdr.ScVal): PauseRecord {
  const map = scValToNative(val) as Record<string, unknown>;
  return {
    seq: BigInt(map["seq"] as number),
    caller: String(map["caller"]),
    timestamp: BigInt(map["timestamp"] as number),
    reason: parseUnitEnum<PauseReason>(map["reason"], "parsePauseRecord.reason"),
  };
}

export function parseRateLimitConfig(tuple: [number, bigint | number, boolean]): RateLimitConfig {
  return {
    maxRequests: Number(tuple[0]),
    windowSeconds: BigInt(tuple[1] as number),
    enabled: Boolean(tuple[2]),
  };
}

export function parseRateLimitStatus(tuple: [number, number, bigint | number]): RateLimitStatus {
  return {
    requestCount: Number(tuple[0]),
    remaining: Number(tuple[1]),
    resetAt: BigInt(tuple[2] as number),
  };
}

function parseTransactionState(raw: unknown): TransactionState {
  if (!raw || typeof raw !== "object") {
    throw new SwiftRemitError(ErrorCode.DataCorruption, "parseTransactionState: invalid value");
  }
  const map = raw as Record<string, unknown>;
  const keys = Object.keys(map);
  if (keys.length !== 1) {
    throw new SwiftRemitError(ErrorCode.DataCorruption, "parseTransactionState: invalid value");
  }
  const key = keys[0];
  if (key === "ContractCalled" || key === "AnchorInitiated") {
    return { [key]: BigInt(map[key] as number) } as TransactionState;
  }
  return key as TransactionState;
}

export function parseTransactionRecord(val: xdr.ScVal): TransactionRecord {
  const map = scValToNative(val) as Record<string, unknown>;
  return {
    user: String(map["user"]),
    agent: String(map["agent"]),
    amount: BigInt(map["amount"] as number),
    remittanceId: map["remittance_id"] != null ? BigInt(map["remittance_id"] as number) : null,
    anchorTxId: map["anchor_tx_id"] != null ? BigInt(map["anchor_tx_id"] as number) : null,
    state: parseTransactionState(map["state"]),
    retryCount: Number(map["retry_count"]),
    timestamp: BigInt(map["timestamp"] as number),
  };
}

export function parseMigrationSnapshot(val: xdr.ScVal): MigrationSnapshot {
  const map = scValToNative(val) as Record<string, unknown>;
  const hash = map["verification_hash"];
  return {
    version: Number(map["version"]),
    timestamp: BigInt(map["timestamp"] as number),
    ledgerSequence: Number(map["ledger_sequence"]),
    instanceData: (map["instance_data"] as Record<string, unknown>) ?? {},
    persistentData: (map["persistent_data"] as Record<string, unknown>) ?? {},
    verificationHash: hash instanceof Uint8Array ? Buffer.from(hash).toString("hex") : String(hash),
  };
}

export function batchSettlementEntryToScVal(entry: BatchSettlementEntry): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("remittance_id"), val: u64ToScVal(entry.remittanceId) }),
  ]);
}

export function parseBatchSettlementResult(val: xdr.ScVal): BatchSettlementResult {
  const map = scValToNative(val) as Record<string, unknown>;
  const ids = (map["settled_ids"] as number[]) ?? [];
  return { settledIds: ids.map((id) => BigInt(id)) };
}

export function adminOperationTypeToScVal(type: AdminOperationType): xdr.ScVal {
  return unitEnumToScVal(type);
}

export function parsePendingOperation(val: xdr.ScVal): PendingOperation {
  const map = scValToNative(val) as Record<string, unknown>;
  const approvers = (map["approvers"] as { toString(): string }[]) ?? [];
  return {
    id: BigInt(map["id"] as number),
    operationType: parseUnitEnum<AdminOperationType>(map["operation_type"], "parsePendingOperation.operationType"),
    proposer: String(map["proposer"]),
    approvers: approvers.map((a) => a.toString()),
    threshold: Number(map["threshold"]),
    proposedAt: BigInt(map["proposed_at"] as number),
    ttlSeconds: BigInt(map["ttl_seconds"] as number),
    feeBps: Number(map["fee_bps"]),
    withdrawTo: map["withdraw_to"] != null ? String(map["withdraw_to"]) : null,
  };
}

// ─── SR-195: Recipient hash builder ──────────────────────────────────────────

/**
 * Compute the canonical SHA-256 recipient hash that the SwiftRemit contract
 * expects for `createRemittance.recipientHash` and
 * `confirmPayout.recipientDetailsHash`.
 *
 * This mirrors the byte layout produced by `compute_recipient_hash()` in
 * `src/recipient_verification.rs` (schema version 1):
 *
 * **Wallet variant**
 * ```
 * SHA-256( [0x01] | XDR-encoded Stellar Address )
 * ```
 * The XDR encoding of a Soroban `Address` as produced by `Address::to_xdr(env)` is:
 *   ScAddressType::Account (u32-BE = 0, 4 bytes)
 *   PublicKeyType::PublicKeyTypeEd25519 (u32-BE = 0, 4 bytes)
 *   32-byte raw ed25519 public key
 * Total = 40 bytes
 *
 * **Bank variant**
 * ```
 * SHA-256(
 *   [0x02]
 *   | u32-BE( byteLength(account_number) ) | UTF-8(account_number)
 *   | u32-BE( byteLength(routing_code)   ) | UTF-8(routing_code)
 * )
 * ```
 *
 * @example — wallet recipient
 * ```ts
 * import { computeRecipientHash } from '@swiftremit/sdk';
 *
 * const hash = computeRecipientHash({ type: 'Wallet', address: 'GABC...' });
 * const tx = await client.createRemittance({ ..., recipientHash: hash });
 * ```
 *
 * @example — bank recipient
 * ```ts
 * const hash = computeRecipientHash({
 *   type: 'Bank',
 *   accountNumber: '1234567890',
 *   routingCode: '021000021',
 * });
 * ```
 *
 * @param details - Recipient details (Wallet or Bank)
 * @returns 32-byte SHA-256 Buffer suitable for on-chain hash comparison
 * @throws {SwiftRemitError} ErrorCode.InvalidAddress if the wallet address is invalid
 */
export function computeRecipientHash(details: RecipientDetails): Buffer {
  const h = createHash("sha256");

  if (details.type === "Wallet") {
    // Type tag = 0x01
    h.update(Buffer.from([0x01]));

    // Decode the StrKey to extract the raw 32-byte ed25519 public key
    validateAddress(details.address);
    const rawPubKey = Buffer.from(StrKey.decodeEd25519PublicKey(details.address));

    // Replicate what Soroban's `Address::to_xdr(env)` produces for an Account address:
    //   ScAddressType::Account = 0  (u32 big-endian, 4 bytes)
    //   PublicKeyTypeEd25519   = 0  (u32 big-endian, 4 bytes)
    //   raw ed25519 key            (32 bytes)
    // Total = 40 bytes
    const xdrBuf = Buffer.alloc(40);
    xdrBuf.writeUInt32BE(0, 0);  // ScAddressType::Account discriminant
    xdrBuf.writeUInt32BE(0, 4);  // PublicKeyType::Ed25519 discriminant
    rawPubKey.copy(xdrBuf, 8);
    h.update(xdrBuf);
  } else {
    // Bank variant — type tag = 0x02
    h.update(Buffer.from([0x02]));

    const acctBytes = Buffer.from(details.accountNumber, "utf8");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(acctBytes.byteLength, 0);
    h.update(lenBuf);
    h.update(acctBytes);

    const routeBytes = Buffer.from(details.routingCode, "utf8");
    lenBuf.writeUInt32BE(routeBytes.byteLength, 0);
    h.update(lenBuf);
    h.update(routeBytes);
  }

  return h.digest();
}
