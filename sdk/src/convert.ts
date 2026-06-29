import {
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";
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

// ─── Native → ScVal ──────────────────────────────────────────────────────────

export function addressToScVal(address: string): xdr.ScVal {
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
