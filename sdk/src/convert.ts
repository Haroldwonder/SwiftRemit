import {
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";
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
  return {
    id: BigInt(map["id"] as number),
    sender: (map["sender"] as { toString(): string }).toString(),
    agent: (map["agent"] as { toString(): string }).toString(),
    amount: BigInt(map["amount"] as number),
    fee: BigInt(map["fee"] as number),
    status: parseStatus(map["status"] as Record<string, unknown>),
    expiry: map["expiry"] != null ? BigInt(map["expiry"] as number) : null,
    token: (map["token"] as { toString(): string }).toString(),
    createdAt: BigInt(map["created_at"] as number),
    failedAt:
      map["failed_at"] != null ? BigInt(map["failed_at"] as number) : null,
  };
}

function parseStatus(raw: Record<string, unknown>): RemittanceStatus {
  const key = Object.keys(raw)[0] as RemittanceStatus;
  return key;
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
