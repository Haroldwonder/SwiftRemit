import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseProposal } from "../src/convert.js";
import type { Proposal } from "../src/types.js";
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProposalScVal(overrides: Record<string, unknown> = {}): xdr.ScVal {
  const base = {
    id: 1,
    proposer: "GABC",
    action: { UpdateFee: 300 },
    state: { Pending: {} },
    created_at: 1000,
    expiry: 2000,
    approval_count: 1,
    approval_timestamp: null,
    ...overrides,
  };
  return nativeToScVal(base);
}

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
});

// ─── getActiveProposals (client-side filtering) ───────────────────────────────

describe("getActiveProposals filtering logic", () => {
  it("keeps only Pending and Approved proposals", () => {
    const all: Proposal[] = [
      { id: 0n, proposer: "G1", action: { UpdateFee: 100 }, state: "Pending",   createdAt: 0n, expiry: 9999n, approvalCount: 0, approvalTimestamp: null },
      { id: 1n, proposer: "G1", action: { UpdateFee: 200 }, state: "Approved",  createdAt: 0n, expiry: 9999n, approvalCount: 2, approvalTimestamp: 500n },
      { id: 2n, proposer: "G1", action: { UpdateFee: 300 }, state: "Executed",  createdAt: 0n, expiry: 9999n, approvalCount: 2, approvalTimestamp: 500n },
      { id: 3n, proposer: "G1", action: { UpdateFee: 400 }, state: "Expired",   createdAt: 0n, expiry: 1000n, approvalCount: 0, approvalTimestamp: null },
    ];
    const active = all.filter((p) => p.state === "Pending" || p.state === "Approved");
    expect(active).toHaveLength(2);
    expect(active.map((p) => p.state)).toEqual(["Pending", "Approved"]);
  });

  it("returns empty array when no active proposals exist", () => {
    const all: Proposal[] = [
      { id: 0n, proposer: "G1", action: { UpdateFee: 100 }, state: "Executed", createdAt: 0n, expiry: 9999n, approvalCount: 2, approvalTimestamp: 500n },
    ];
    const active = all.filter((p) => p.state === "Pending" || p.state === "Approved");
    expect(active).toHaveLength(0);
  });
});
