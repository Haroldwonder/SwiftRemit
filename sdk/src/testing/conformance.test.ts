/**
 * SR-088 Conformance test suite.
 *
 * These tests run against SwiftRemitMockClient and document the exact
 * behaviour that any real-client integration must also satisfy.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SwiftRemitMockClient } from "./mock-client.js";
import { SwiftRemitError, ErrorCode } from "../errors.js";

const AGENT  = "GAGENT000000000000000000000000000000000000000000000000000";
const SENDER = "GSENDER00000000000000000000000000000000000000000000000000";
const SOURCE = "GSOURCE00000000000000000000000000000000000000000000000000";
const AMOUNT = 100_000_000n; // 10 USDC

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeClient(feeBps = 100): SwiftRemitMockClient {
  return new SwiftRemitMockClient({ feeBps }).seedAgent(AGENT);
}

async function pendingId(client: SwiftRemitMockClient): Promise<bigint> {
  const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
  return id!;
}

// ─── 1. Full state-machine transitions ────────────────────────────────────────

describe("state machine – happy paths", () => {
  let client: SwiftRemitMockClient;
  beforeEach(() => { client = makeClient(); });

  it("Pending → Processing → Completed via confirmPayout", async () => {
    const id = await pendingId(client);
    await client.confirmPayout(AGENT, id);
    expect((await client.getRemittance(SOURCE, id)).status).toBe("Completed");
  });

  it("Pending → Cancelled via cancelRemittance", async () => {
    const id = await pendingId(client);
    await client.cancelRemittance(SENDER, id);
    expect((await client.getRemittance(SOURCE, id)).status).toBe("Cancelled");
  });

  it("Pending → Failed via markFailed", async () => {
    const id = await pendingId(client);
    await client.markFailed(AGENT, id);
    expect((await client.getRemittance(SOURCE, id)).status).toBe("Failed");
  });

  it("Failed → Disputed via raiseDispute", async () => {
    const id = await pendingId(client);
    await client.markFailed(AGENT, id);
    await client.raiseDispute(SENDER, id, Buffer.alloc(32));
    expect((await client.getRemittance(SOURCE, id)).status).toBe("Disputed");
  });

  it("Disputed → Cancelled when resolved in favour of sender", async () => {
    const id = await pendingId(client);
    await client.markFailed(AGENT, id);
    await client.raiseDispute(SENDER, id, Buffer.alloc(32));
    await client.resolveDispute("GADMIN", id, true);
    expect((await client.getRemittance(SOURCE, id)).status).toBe("Cancelled");
  });

  it("Disputed → Completed when resolved against sender", async () => {
    const id = await pendingId(client);
    await client.markFailed(AGENT, id);
    await client.raiseDispute(SENDER, id, Buffer.alloc(32));
    await client.resolveDispute("GADMIN", id, false);
    expect((await client.getRemittance(SOURCE, id)).status).toBe("Completed");
  });
});

describe("state machine – illegal transitions", () => {
  let client: SwiftRemitMockClient;
  beforeEach(() => { client = makeClient(); });

  it("cannot cancel a Completed remittance", async () => {
    const id = await pendingId(client);
    await client.confirmPayout(AGENT, id);
    await expect(client.cancelRemittance(SENDER, id))
      .rejects.toMatchObject({ code: ErrorCode.InvalidStateTransition });
  });

  it("cannot markFailed a Completed remittance", async () => {
    const id = await pendingId(client);
    await client.confirmPayout(AGENT, id);
    await expect(client.markFailed(AGENT, id))
      .rejects.toMatchObject({ code: ErrorCode.InvalidStateTransition });
  });

  it("cannot raiseDispute on a Pending remittance", async () => {
    const id = await pendingId(client);
    await expect(client.raiseDispute(SENDER, id, Buffer.alloc(32)))
      .rejects.toMatchObject({ code: ErrorCode.InvalidStateTransition });
  });

  it("cannot confirmPayout on a Cancelled remittance", async () => {
    const id = await pendingId(client);
    await client.cancelRemittance(SENDER, id);
    await expect(client.confirmPayout(AGENT, id))
      .rejects.toMatchObject({ code: ErrorCode.InvalidStateTransition });
  });

  it("cannot raiseDispute on a Completed remittance", async () => {
    const id = await pendingId(client);
    await client.confirmPayout(AGENT, id);
    await expect(client.raiseDispute(SENDER, id, Buffer.alloc(32)))
      .rejects.toMatchObject({ code: ErrorCode.InvalidStateTransition });
  });
});

// ─── 2. Fault injection ───────────────────────────────────────────────────────

describe("fault injection – failNext / delayNext / throwError", () => {
  it("failNext causes the next call to throw the injected error", async () => {
    const client = makeClient();
    client.failNext(new SwiftRemitError(ErrorCode.ContractPaused, "mock"));
    await expect(client.getRemittanceCount(SOURCE))
      .rejects.toMatchObject({ code: ErrorCode.ContractPaused });
  });

  it("failNext clears after one use", async () => {
    const client = makeClient();
    client.failNext(new SwiftRemitError(ErrorCode.ContractPaused, "mock"));
    await expect(client.getRemittanceCount(SOURCE)).rejects.toThrow();
    // Second call succeeds normally
    await expect(client.getRemittanceCount(SOURCE)).resolves.toBe(0n);
  });

  it("throwError is a convenience wrapper over failNext", async () => {
    const client = makeClient();
    client.throwError(ErrorCode.RateLimitExceeded);
    await expect(client.health(SOURCE))
      .rejects.toMatchObject({ code: ErrorCode.RateLimitExceeded });
  });

  it("delayNext introduces a measurable delay then succeeds", async () => {
    const client = makeClient();
    client.delayNext(50);
    const start = Date.now();
    await client.getRemittanceCount(SOURCE);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // allow small timer jitter
  });

  it("delayNext clears after one use", async () => {
    const client = makeClient();
    client.delayNext(50);
    await client.getRemittanceCount(SOURCE); // consumes the delay
    const start = Date.now();
    await client.getRemittanceCount(SOURCE);
    expect(Date.now() - start).toBeLessThan(30);
  });
});

// ─── 3. Seeding helpers ───────────────────────────────────────────────────────

describe("seed helpers", () => {
  it("seedAgent makes isAgentRegistered return true", async () => {
    const client = new SwiftRemitMockClient();
    expect(await client.isAgentRegistered(SOURCE, AGENT)).toBe(false);
    client.seedAgent(AGENT);
    expect(await client.isAgentRegistered(SOURCE, AGENT)).toBe(true);
  });

  it("seedToken makes isTokenWhitelisted return true", async () => {
    const client = new SwiftRemitMockClient();
    client.seedToken("USDC_CONTRACT");
    expect(await client.isTokenWhitelisted(SOURCE, "USDC_CONTRACT")).toBe(true);
    expect(await client.getWhitelistedTokens(SOURCE)).toContain("USDC_CONTRACT");
  });

  it("seedRemittance injects a queryable remittance", async () => {
    const client = new SwiftRemitMockClient();
    client.seedRemittance({
      id: 42n, sender: SENDER, agent: AGENT, amount: AMOUNT,
      fee: 1_000_000n, status: "Pending", expiry: null,
      token: "", createdAt: 0n, failedAt: null, expiresAt: null,
    });
    const r = await client.getRemittance(SOURCE, 42n);
    expect(r.id).toBe(42n);
    expect(r.status).toBe("Pending");
  });

  it("seedFees pre-loads accumulated fees", async () => {
    const client = new SwiftRemitMockClient();
    client.seedFees(500_000n);
    expect(await client.getAccumulatedFees(SOURCE)).toBe(500_000n);
  });

  it("seedDailyLimit pre-loads a corridor limit", async () => {
    const client = makeClient();
    client.seedDailyLimit("USDC", "NG", 1_000_000_000n);
    const status = await client.getDailyLimitStatus(SOURCE, SENDER, "USDC", "NG");
    expect(status.limit).toBe(1_000_000_000n);
  });

  it("seedBlacklist / isUserBlacklisted", async () => {
    const client = new SwiftRemitMockClient();
    expect(await client.isUserBlacklisted(SOURCE, SENDER)).toBe(false);
    client.seedBlacklist(SENDER);
    expect(await client.isUserBlacklisted(SOURCE, SENDER)).toBe(true);
  });

  it("seedKyc / isKycApproved", async () => {
    const client = new SwiftRemitMockClient();
    client.seedKyc(SENDER, true, 0n); // 0 = no expiry
    expect(await client.isKycApproved(SOURCE, SENDER)).toBe(true);
  });
});

// ─── 4. Escrow lifecycle ──────────────────────────────────────────────────────

describe("escrow lifecycle", () => {
  it("createEscrow returns an id and stores Pending status", async () => {
    const client = new SwiftRemitMockClient();
    const { id } = await client.createEscrow(SENDER, "GRECIPIENT", AMOUNT);
    const e = await client.getEscrow(SOURCE, id!);
    expect(e.status).toBe("Pending");
    expect(e.amount).toBe(AMOUNT);
  });

  it("releaseEscrow moves to Released", async () => {
    const client = new SwiftRemitMockClient();
    const { id } = await client.createEscrow(SENDER, "GRECIPIENT", AMOUNT);
    await client.releaseEscrow("GADMIN", id!);
    expect((await client.getEscrow(SOURCE, id!)).status).toBe("Released");
  });

  it("refundEscrow moves to Refunded", async () => {
    const client = new SwiftRemitMockClient();
    const { id } = await client.createEscrow(SENDER, "GRECIPIENT", AMOUNT);
    await client.refundEscrow(SENDER, id!);
    expect((await client.getEscrow(SOURCE, id!)).status).toBe("Refunded");
  });

  it("releaseEscrow on Released escrow throws InvalidEscrowStatus", async () => {
    const client = new SwiftRemitMockClient();
    const { id } = await client.createEscrow(SENDER, "GRECIPIENT", AMOUNT);
    await client.releaseEscrow("GADMIN", id!);
    await expect(client.releaseEscrow("GADMIN", id!))
      .rejects.toMatchObject({ code: ErrorCode.InvalidEscrowStatus });
  });

  it("processExpiredEscrows refunds all pending escrows in batch", async () => {
    const client = new SwiftRemitMockClient();
    const { id: a } = await client.createEscrow(SENDER, "G1", AMOUNT);
    const { id: b } = await client.createEscrow(SENDER, "G2", AMOUNT);
    await client.processExpiredEscrows("GCALLER", [a!, b!]);
    expect((await client.getEscrow(SOURCE, a!)).status).toBe("Refunded");
    expect((await client.getEscrow(SOURCE, b!)).status).toBe("Refunded");
  });
});

// ─── 5. Governance ────────────────────────────────────────────────────────────

describe("governance proposals", () => {
  it("propose creates a Pending proposal", async () => {
    const client = new SwiftRemitMockClient();
    client.seedAdmin(SOURCE);
    const { id } = await client.propose(SOURCE, { UpdateFee: 200 });
    const p = await client.getProposal(SOURCE, id!);
    expect(p.state).toBe("Pending");
    expect(p.approvalCount).toBe(0);
  });

  it("voteOnProposal increments approvalCount", async () => {
    const client = new SwiftRemitMockClient();
    const { id } = await client.propose(SOURCE, { UpdateFee: 200 });
    await client.voteOnProposal("GADMIN1", id!);
    const p = await client.getProposal(SOURCE, id!);
    expect(p.approvalCount).toBe(1);
  });

  it("proposal moves to Approved once quorum is reached", async () => {
    const client = new SwiftRemitMockClient({ feeBps: 100 });
    const { id } = await client.propose(SOURCE, { UpdateFee: 300 });
    await client.voteOnProposal("GADMIN1", id!);
    await client.voteOnProposal("GADMIN2", id!);  // quorum = 2
    const p = await client.getProposal(SOURCE, id!);
    expect(p.state).toBe("Approved");
  });

  it("duplicate vote throws AlreadyVoted", async () => {
    const client = new SwiftRemitMockClient();
    const { id } = await client.propose(SOURCE, { UpdateFee: 200 });
    await client.voteOnProposal("GADMIN1", id!);
    await expect(client.voteOnProposal("GADMIN1", id!))
      .rejects.toMatchObject({ code: ErrorCode.AlreadyVoted });
  });

  it("getVoteStatus reflects whether an address has voted", async () => {
    const client = new SwiftRemitMockClient();
    const { id } = await client.propose(SOURCE, { UpdateFee: 200 });
    expect(await client.getVoteStatus(SOURCE, id!, "GADMIN1")).toBe(false);
    await client.voteOnProposal("GADMIN1", id!);
    expect(await client.getVoteStatus(SOURCE, id!, "GADMIN1")).toBe(true);
  });

  it("getActiveProposals returns only Pending/Approved", async () => {
    const client = new SwiftRemitMockClient();
    await client.propose(SOURCE, { UpdateFee: 100 });
    await client.propose(SOURCE, { UpdateFee: 200 });
    const active = await client.getActiveProposals(SOURCE);
    expect(active.length).toBe(2);
    expect(active.every(p => p.state === "Pending" || p.state === "Approved")).toBe(true);
  });
});

// ─── 6. KYC and blacklist enforcement in createRemittance ─────────────────────

describe("KYC and blacklist checks", () => {
  it("blacklisted sender cannot create a remittance", async () => {
    const client = makeClient();
    client.seedBlacklist(SENDER);
    await expect(client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT }))
      .rejects.toMatchObject({ code: ErrorCode.UserBlacklisted });
  });

  it("unapproved KYC blocks createRemittance", async () => {
    const client = makeClient();
    client.seedKyc(SENDER, false, 0n);
    await expect(client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT }))
      .rejects.toMatchObject({ code: ErrorCode.KycNotApproved });
  });

  it("expired KYC blocks createRemittance", async () => {
    const client = makeClient();
    client.seedKyc(SENDER, true, 1n); // expiry in the past
    await expect(client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT }))
      .rejects.toMatchObject({ code: ErrorCode.KycExpired });
  });

  it("approved KYC with no expiry allows createRemittance", async () => {
    const client = makeClient();
    client.seedKyc(SENDER, true, 0n); // 0 = no expiry
    await expect(client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT }))
      .resolves.toBeDefined();
  });
});

// ─── 7. In-flight volume tracking ─────────────────────────────────────────────

describe("in-flight volume", () => {
  it("is zero before any payouts", async () => {
    const client = makeClient();
    expect(await client.getInFlightVolume(SOURCE)).toBe(0n);
  });

  it("confirmPayout does not leave residual in-flight volume", async () => {
    const client = makeClient();
    const id = await pendingId(client);
    await client.confirmPayout(AGENT, id);
    expect(await client.getInFlightVolume(SOURCE)).toBe(0n);
  });

  it("markFailed on a Pending remittance leaves zero in-flight volume", async () => {
    const client = makeClient();
    const id = await pendingId(client);
    await client.markFailed(AGENT, id);
    expect(await client.getInFlightVolume(SOURCE)).toBe(0n);
  });
});

// ─── 8. Circuit breaker ───────────────────────────────────────────────────────

describe("circuit breaker", () => {
  it("pause / unpause toggles isPaused", async () => {
    const client = makeClient();
    await client.pause("GADMIN");
    expect((await client.health(SOURCE)).paused).toBe(true);
    await client.unpause("GADMIN");
    expect((await client.health(SOURCE)).paused).toBe(false);
  });

  it("double-pause throws AlreadyPaused", async () => {
    const client = makeClient();
    await client.pause("GADMIN");
    await expect(client.pause("GADMIN"))
      .rejects.toMatchObject({ code: ErrorCode.AlreadyPaused });
  });

  it("unpause when not paused throws NotPaused", async () => {
    const client = makeClient();
    await expect(client.unpause("GADMIN"))
      .rejects.toMatchObject({ code: ErrorCode.NotPaused });
  });

  it("createRemittance while paused throws ContractPaused", async () => {
    const client = makeClient();
    await client.pause("GADMIN");
    await expect(client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT }))
      .rejects.toMatchObject({ code: ErrorCode.ContractPaused });
  });
});
