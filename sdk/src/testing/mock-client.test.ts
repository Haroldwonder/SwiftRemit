import { describe, it, expect, beforeEach } from "vitest";
import { SwiftRemitMockClient } from "./mock-client.js";
import { SwiftRemitError, ErrorCode } from "../errors.js";

const AGENT = "GAGENT000000000000000000000000000000000000000000000000000";
const SENDER = "GSENDER00000000000000000000000000000000000000000000000000";
const SOURCE = "GSOURCE00000000000000000000000000000000000000000000000000";
const AMOUNT = 100_000_000n; // 10 USDC at 1 USDC = 10_000_000 stroops

describe("SwiftRemitMockClient – seed helpers", () => {
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
  });

  it("seedRemittance injects a remittance queryable by id", async () => {
    const client = new SwiftRemitMockClient();
    const remittance = {
      id: 42n,
      sender: SENDER,
      agent: AGENT,
      amount: AMOUNT,
      fee: 1_000_000n,
      status: "Pending" as const,
      expiry: null,
      token: "",
      createdAt: 0n,
      failedAt: null,
      expiresAt: null,
    };
    client.seedRemittance(remittance);
    const found = await client.getRemittance(SOURCE, 42n);
    expect(found.id).toBe(42n);
    expect(found.status).toBe("Pending");
  });

  it("setFeeBps changes the fee used in createRemittance", async () => {
    const client = new SwiftRemitMockClient();
    client.seedAgent(AGENT).setFeeBps(200); // 2%
    const result = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    const r = await client.getRemittance(SOURCE, result.id!);
    expect(r.fee).toBe((AMOUNT * 200n) / 10_000n);
  });
});

describe("SwiftRemitMockClient – createRemittance", () => {
  let client: SwiftRemitMockClient;

  beforeEach(() => {
    client = new SwiftRemitMockClient();
    client.seedAgent(AGENT);
  });

  it("creates a remittance and returns an id", async () => {
    const result = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    expect(result.id).toBeDefined();
    expect(result.txHash).toMatch(/^MOCK_TX_/);
  });

  it("new remittance has Pending status", async () => {
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    const r = await client.getRemittance(SOURCE, id!);
    expect(r.status).toBe("Pending");
    expect(r.amount).toBe(AMOUNT);
  });

  it("rejects unregistered agents", async () => {
    await expect(
      client.createRemittance({ sender: SENDER, agent: "GUNKNOWN", amount: AMOUNT })
    ).rejects.toThrow(SwiftRemitError);
    await expect(
      client.createRemittance({ sender: SENDER, agent: "GUNKNOWN", amount: AMOUNT })
    ).rejects.toMatchObject({ code: ErrorCode.AgentNotRegistered });
  });

  it("rejects zero amount", async () => {
    await expect(
      client.createRemittance({ sender: SENDER, agent: AGENT, amount: 0n })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidAmount });
  });

  it("increments id for each new remittance", async () => {
    const { id: id1 } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    const { id: id2 } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    expect(id2).toBe(id1! + 1n);
  });
});

describe("SwiftRemitMockClient – state machine transitions", () => {
  let client: SwiftRemitMockClient;

  beforeEach(() => {
    client = new SwiftRemitMockClient({ feeBps: 100 });
    client.seedAgent(AGENT);
  });

  it("confirmPayout moves Pending → Completed", async () => {
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    await client.confirmPayout(AGENT, id!);
    const r = await client.getRemittance(SOURCE, id!);
    expect(r.status).toBe("Completed");
  });

  it("cancelRemittance moves Pending → Cancelled", async () => {
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    await client.cancelRemittance(SENDER, id!);
    const r = await client.getRemittance(SOURCE, id!);
    expect(r.status).toBe("Cancelled");
  });

  it("markFailed moves Pending → Failed", async () => {
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    await client.markFailed(AGENT, id!);
    const r = await client.getRemittance(SOURCE, id!);
    expect(r.status).toBe("Failed");
  });

  it("raiseDispute moves Failed → Disputed", async () => {
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    await client.markFailed(AGENT, id!);
    await client.raiseDispute(SENDER, id!, Buffer.alloc(32));
    const r = await client.getRemittance(SOURCE, id!);
    expect(r.status).toBe("Disputed");
  });

  it("resolveDispute in favour of sender → Cancelled", async () => {
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    await client.markFailed(AGENT, id!);
    await client.raiseDispute(SENDER, id!, Buffer.alloc(32));
    await client.resolveDispute("GADMIN", id!, true);
    expect((await client.getRemittance(SOURCE, id!)).status).toBe("Cancelled");
  });

  it("resolveDispute against sender → Completed", async () => {
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    await client.markFailed(AGENT, id!);
    await client.raiseDispute(SENDER, id!, Buffer.alloc(32));
    await client.resolveDispute("GADMIN", id!, false);
    expect((await client.getRemittance(SOURCE, id!)).status).toBe("Completed");
  });

  it("cancelRemittance on a non-Pending remittance throws InvalidStatus", async () => {
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    await client.confirmPayout(AGENT, id!);
    await expect(client.cancelRemittance(SENDER, id!)).rejects.toMatchObject({
      code: ErrorCode.InvalidStatus,
    });
  });
});

describe("SwiftRemitMockClient – fees and totals", () => {
  it("accumulatedFees increases after confirmPayout", async () => {
    const client = new SwiftRemitMockClient({ feeBps: 100 });
    client.seedAgent(AGENT);
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    expect(await client.getAccumulatedFees(SOURCE)).toBe(0n);
    await client.confirmPayout(AGENT, id!);
    const fee = (AMOUNT * 100n) / 10_000n;
    expect(await client.getAccumulatedFees(SOURCE)).toBe(fee);
  });

  it("withdrawFees resets accumulated fees", async () => {
    const client = new SwiftRemitMockClient({ feeBps: 100 });
    client.seedAgent(AGENT);
    const { id } = await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    await client.confirmPayout(AGENT, id!);
    await client.withdrawFees("GADMIN", "GTREASURY");
    expect(await client.getAccumulatedFees(SOURCE)).toBe(0n);
  });

  it("withdrawFees throws when no fees have accumulated", async () => {
    const client = new SwiftRemitMockClient();
    await expect(client.withdrawFees("GADMIN", "GTREASURY")).rejects.toMatchObject({
      code: ErrorCode.NoFeesToWithdraw,
    });
  });
});

describe("SwiftRemitMockClient – estimateFee", () => {
  it("returns correct breakdown using configured feeBps", async () => {
    const client = new SwiftRemitMockClient({ feeBps: 200, protocolFeeBps: 50 });
    const estimate = await client.estimateFee(
      AMOUNT,
      { currency: "USDC", country: "NG" },
      SOURCE
    );
    const platformFee = (AMOUNT * 200n) / 10_000n;
    const protocolFee = (AMOUNT * 50n) / 10_000n;
    expect(estimate.platformFee).toBe(platformFee);
    expect(estimate.protocolFee).toBe(protocolFee);
    expect(estimate.totalFee).toBe(platformFee + protocolFee);
    expect(estimate.netAmount).toBe(AMOUNT - platformFee - protocolFee);
    expect(estimate.fromCache).toBe(false);
  });
});

describe("SwiftRemitMockClient – getRemittancesBySender", () => {
  it("returns ids for a specific sender with pagination", async () => {
    const client = new SwiftRemitMockClient();
    client.seedAgent(AGENT);
    for (let i = 0; i < 5; i++) {
      await client.createRemittance({ sender: SENDER, agent: AGENT, amount: AMOUNT });
    }
    const page1 = await client.getRemittancesBySender(SOURCE, SENDER, 0n, 3n);
    expect(page1).toHaveLength(3);
    const page2 = await client.getRemittancesBySender(SOURCE, SENDER, 3n, 3n);
    expect(page2).toHaveLength(2);
  });
});
