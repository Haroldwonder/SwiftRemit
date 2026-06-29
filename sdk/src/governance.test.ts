import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseProposal } from "../src/convert.js";
import {
  SwiftRemitClient,
  buildUpdateFeeProposal,
  buildRegisterAgentProposal,
  buildRemoveAgentProposal,
  buildAddAdminProposal,
  buildRemoveAdminProposal,
  buildUpdateQuorumProposal,
  buildUpdateTimelockProposal,
  buildUpdateCooldownPeriodProposal,
  buildWhitelistAssetProposal,
  buildAdjustReputationThresholdProposal,
} from "../src/client.js";
import type { Proposal, ProposalAction } from "../src/types.js";
import { makeProposalScVal } from "../src/test-utils.js";
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

const mockSimulateTransaction = vi.fn();
const mockGetAccount = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...((actual as unknown as Record<string, unknown>)["rpc"] as object),
      Server: class {
        constructor(..._args: unknown[]) {}
        getEvents = vi.fn();
        getAccount = mockGetAccount;
        simulateTransaction = mockSimulateTransaction;
        sendTransaction = vi.fn();
        getTransaction = vi.fn();
      },
    },
  };
});

// ─── parseProposal ────────────────────────────────────────────────────────────

describe("parseProposal", () => {
  it("parses a Pending UpdateFee proposal", () => {
    const p = parseProposal(makeProposalScVal());
    expect(p.id).toBe(1n);
    expect(p.state).toBe("Pending");
    expect(p.action).toEqual({ UpdateFee: 300 });
    expect(p.approvalCount).toBe(1);
    expect(p.approvalTimestamp).toBeNull();
  });

  it("parses an Approved proposal with approval_timestamp", () => {
    const p = parseProposal(
      makeProposalScVal({ state: { Approved: {} }, approval_timestamp: 1500 })
    );
    expect(p.state).toBe("Approved");
    expect(p.approvalTimestamp).toBe(1500n);
  });

  it("parses an Executed proposal", () => {
    const p = parseProposal(makeProposalScVal({ state: { Executed: {} } }));
    expect(p.state).toBe("Executed");
  });

  it("parses an Expired proposal", () => {
    const p = parseProposal(makeProposalScVal({ state: { Expired: {} } }));
    expect(p.state).toBe("Expired");
  });

  it("parses UpdateQuorum action", () => {
    const p = parseProposal(makeProposalScVal({ action: { UpdateQuorum: 3 } }));
    expect(p.action).toEqual({ UpdateQuorum: 3 });
  });

  it("parses UpdateTimelock action", () => {
    const p = parseProposal(makeProposalScVal({ action: { UpdateTimelock: 86400 } }));
    expect(p.action).toEqual({ UpdateTimelock: 86400n });
  });

  it("parses AddAdmin action", () => {
    const p = parseProposal(makeProposalScVal({ action: { AddAdmin: "GXYZ" } }));
    expect(p.action).toEqual({ AddAdmin: "GXYZ" });
  });

  it("parses RemoveAgent action", () => {
    const p = parseProposal(makeProposalScVal({ action: { RemoveAgent: "GXYZ" } }));
    expect(p.action).toEqual({ RemoveAgent: "GXYZ" });
  });

  it("parses UpdateCooldownPeriod action", () => {
    const p = parseProposal(
      makeProposalScVal({ action: { UpdateCooldownPeriod: 3600 } })
    );
    expect(p.action).toEqual({ UpdateCooldownPeriod: 3600n });
  });

  it("parses WhitelistAsset action", () => {
    const p = parseProposal(
      makeProposalScVal({ action: { WhitelistAsset: "GASSET" } })
    );
    expect(p.action).toEqual({ WhitelistAsset: "GASSET" });
  });

  it("parses AdjustReputationThreshold action", () => {
    const p = parseProposal(
      makeProposalScVal({ action: { AdjustReputationThreshold: 75 } })
    );
    expect(p.action).toEqual({ AdjustReputationThreshold: 75 });
  });
});

// ─── Proposal builder functions ───────────────────────────────────────────────

describe("proposal builder functions", () => {
  it("buildUpdateFeeProposal", () => {
    expect(buildUpdateFeeProposal(300)).toEqual({ UpdateFee: 300 });
  });

  it("buildRegisterAgentProposal", () => {
    expect(buildRegisterAgentProposal("GAGENT")).toEqual({
      RegisterAgent: "GAGENT",
    });
  });

  it("buildRemoveAgentProposal", () => {
    expect(buildRemoveAgentProposal("GAGENT")).toEqual({
      RemoveAgent: "GAGENT",
    });
  });

  it("buildAddAdminProposal", () => {
    expect(buildAddAdminProposal("GADMIN")).toEqual({ AddAdmin: "GADMIN" });
  });

  it("buildRemoveAdminProposal", () => {
    expect(buildRemoveAdminProposal("GADMIN")).toEqual({
      RemoveAdmin: "GADMIN",
    });
  });

  it("buildUpdateQuorumProposal", () => {
    expect(buildUpdateQuorumProposal(3)).toEqual({ UpdateQuorum: 3 });
  });

  it("buildUpdateTimelockProposal", () => {
    expect(buildUpdateTimelockProposal(86400n)).toEqual({
      UpdateTimelock: 86400n,
    });
  });

  it("buildUpdateCooldownPeriodProposal", () => {
    expect(buildUpdateCooldownPeriodProposal(3600n)).toEqual({
      UpdateCooldownPeriod: 3600n,
    });
  });

  it("buildWhitelistAssetProposal", () => {
    expect(buildWhitelistAssetProposal("GASSET")).toEqual({
      WhitelistAsset: "GASSET",
    });
  });

  it("buildAdjustReputationThresholdProposal", () => {
    expect(buildAdjustReputationThresholdProposal(80)).toEqual({
      AdjustReputationThreshold: 80,
    });
  });
});

// ─── getActiveProposals pagination ────────────────────────────────────────────

describe("getActiveProposals pagination", () => {
  let client: SwiftRemitClient;

  const makeScVal = (id: bigint, state: Proposal["state"]): xdr.ScVal => {
    const base: Record<string, unknown> = {
      id: Number(id),
      proposer: "GADMIN",
      action: { UpdateFee: 100 },
      state: { [state]: {} },
      created_at: Number(id),
      expiry: Number(id) + 1000,
      approval_count: state === "Approved" ? 2 : 0,
      approval_timestamp: state === "Approved" ? Number(id) + 500 : null,
      execute_after: state === "Approved" ? Number(id) + 600 : null,
    };
    return nativeToScVal(base);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccount.mockResolvedValue({});
    client = new SwiftRemitClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
  });

  it("returns only Pending and Approved proposals up to limit", async () => {
    const proposals: Proposal[] = [
      { id: 0n, proposer: "GADMIN", action: { UpdateFee: 100 }, state: "Pending", createdAt: 0n, expiry: 1000n, approvalCount: 0, approvalTimestamp: null, executeAfter: null },
      { id: 1n, proposer: "GADMIN", action: { UpdateFee: 200 }, state: "Approved", createdAt: 1n, expiry: 1001n, approvalCount: 2, approvalTimestamp: 500n, executeAfter: 600n },
      { id: 2n, proposer: "GADMIN", action: { UpdateFee: 300 }, state: "Executed", createdAt: 2n, expiry: 1002n, approvalCount: 2, approvalTimestamp: 500n, executeAfter: 600n },
      { id: 3n, proposer: "GADMIN", action: { UpdateFee: 400 }, state: "Expired", createdAt: 3n, expiry: 1003n, approvalCount: 0, approvalTimestamp: null, executeAfter: null },
    ];

    let callIndex = 0;
    mockSimulateTransaction.mockImplementation(async () => {
      const p = proposals[callIndex];
      callIndex++;
      if (!p) {
        throw new Error("Simulation failed: ResourceNotFound");
      }
      return {
        result: {
          retval: makeScVal(p.id, p.state),
        },
      };
    });

    const result = await client.getActiveProposals("GSOURCE", 0n, 50n);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.state)).toEqual(["Pending", "Approved"]);
  });

  it("respects limit", async () => {
    const proposals: Proposal[] = [
      { id: 0n, proposer: "GADMIN", action: { UpdateFee: 100 }, state: "Pending", createdAt: 0n, expiry: 1000n, approvalCount: 0, approvalTimestamp: null, executeAfter: null },
      { id: 1n, proposer: "GADMIN", action: { UpdateFee: 200 }, state: "Pending", createdAt: 1n, expiry: 1001n, approvalCount: 0, approvalTimestamp: null, executeAfter: null },
      { id: 2n, proposer: "GADMIN", action: { UpdateFee: 300 }, state: "Pending", createdAt: 2n, expiry: 1002n, approvalCount: 0, approvalTimestamp: null, executeAfter: null },
    ];

    let callIndex = 0;
    mockSimulateTransaction.mockImplementation(async () => {
      const p = proposals[callIndex];
      callIndex++;
      if (!p) {
        throw new Error("Simulation failed: ResourceNotFound");
      }
      return {
        result: {
          retval: makeScVal(p.id, p.state),
        },
      };
    });

    const result = await client.getActiveProposals("GSOURCE", 0n, 2n);
    expect(result).toHaveLength(2);
    expect(callIndex).toBe(2);
  });

  it("returns empty array when no active proposals exist", async () => {
    const proposals: Proposal[] = [
      { id: 0n, proposer: "GADMIN", action: { UpdateFee: 100 }, state: "Executed", createdAt: 0n, expiry: 1000n, approvalCount: 2, approvalTimestamp: 500n, executeAfter: 600n },
    ];

    let callIndex = 0;
    mockSimulateTransaction.mockImplementation(async () => {
      const p = proposals[callIndex];
      callIndex++;
      if (!p) {
        throw new Error("Simulation failed: ResourceNotFound");
      }
      return {
        result: {
          retval: makeScVal(p.id, p.state),
        },
      };
    });

    const result = await client.getActiveProposals("GSOURCE", 0n, 50n);
    expect(result).toHaveLength(0);
  });
});

// ─── getVoteStatus ────────────────────────────────────────────────────────────

describe("getVoteStatus", () => {
  let client: SwiftRemitClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccount.mockResolvedValue({});
    client = new SwiftRemitClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
  });

  it("returns true when voter has voted", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: {
        retval: xdr.ScVal.scvBool(true),
      },
    });

    const result = await client.getVoteStatus("GSOURCE", 1n, "GVOTER");
    expect(result).toBe(true);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns false when voter has not voted", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: {
        retval: xdr.ScVal.scvBool(false),
      },
    });

    const result = await client.getVoteStatus("GSOURCE", 1n, "GVOTER");
    expect(result).toBe(false);
  });
});
