/**
 * Unit tests for SwiftRemitClient.estimateFee — mocks the underlying
 * Stellar simulation so no live network is required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SwiftRemitClient } from "./client.js";
import { Networks } from "@stellar/stellar-sdk";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const AMOUNT = 100_000_000n; // 10 USDC
const CORRIDOR = { currency: "USDC", country: "NG" };

function makeClient(rpcUrl = "http://localhost:8000") {
  return new SwiftRemitClient({
    contractId: CONTRACT_ID,
    networkPassphrase: Networks.TESTNET,
    rpcUrl,
  });
}

function mockSimulation(client: SwiftRemitClient, platformFee: bigint, protocolFee: bigint, netAmount: bigint) {
  const { xdr, scValToNative: _ignore, nativeToScVal } = vi.importActual<typeof import("@stellar/stellar-sdk")>("@stellar/stellar-sdk") as never;
  void _ignore;

  // Stub out the private simulateCall to return a fake FeeBreakdown XDR value
  const stub = vi.spyOn(client as never, "simulateCall").mockResolvedValue(
    // Build a fake ScVal map: { platform_fee, protocol_fee, net_amount }
    (() => {
      // We mock the return at the parseFeeBreakdown level by returning an
      // object that parseFeeBreakdown can decode via scValToNative.
      // Easiest: return a ScVal that scValToNative maps to a plain object.
      const stellarSdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
      return stellarSdk.xdr.ScVal.scvMap([
        new stellarSdk.xdr.ScMapEntry({
          key: stellarSdk.xdr.ScVal.scvSymbol("platform_fee"),
          val: stellarSdk.nativeToScVal(platformFee, { type: "i128" }),
        }),
        new stellarSdk.xdr.ScMapEntry({
          key: stellarSdk.xdr.ScVal.scvSymbol("protocol_fee"),
          val: stellarSdk.nativeToScVal(protocolFee, { type: "i128" }),
        }),
        new stellarSdk.xdr.ScMapEntry({
          key: stellarSdk.xdr.ScVal.scvSymbol("net_amount"),
          val: stellarSdk.nativeToScVal(netAmount, { type: "i128" }),
        }),
      ]);
    })()
  );
  return stub;
}

describe("estimateFee", () => {
  let client: SwiftRemitClient;

  beforeEach(() => {
    client = makeClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("calls the contract simulation and returns typed FeeEstimate", async () => {
    const platformFee = 1_000_000n;
    const protocolFee = 100_000n;
    const netAmount = AMOUNT - platformFee - protocolFee;

    const stub = mockSimulation(client, platformFee, protocolFee, netAmount);

    const estimate = await client.estimateFee(AMOUNT, CORRIDOR, SOURCE);

    expect(stub).toHaveBeenCalledOnce();
    expect(stub).toHaveBeenCalledWith(SOURCE, "get_fee_breakdown", expect.any(Array), undefined);

    expect(estimate.amount).toBe(AMOUNT);
    expect(estimate.platformFee).toBe(platformFee);
    expect(estimate.protocolFee).toBe(protocolFee);
    expect(estimate.netAmount).toBe(netAmount);
    expect(estimate.totalFee).toBe(platformFee + protocolFee);
    expect(estimate.fromCache).toBe(false);
    expect(estimate.estimatedAt).toBeInstanceOf(Date);
  });

  it("serves subsequent calls from cache within 30 s TTL", async () => {
    const platformFee = 500_000n;
    const protocolFee = 50_000n;
    const netAmount = AMOUNT - platformFee - protocolFee;
    const stub = mockSimulation(client, platformFee, protocolFee, netAmount);

    await client.estimateFee(AMOUNT, CORRIDOR, SOURCE);
    const cached = await client.estimateFee(AMOUNT, CORRIDOR, SOURCE);

    // simulateCall called only once
    expect(stub).toHaveBeenCalledOnce();
    expect(cached.fromCache).toBe(true);
  });

  it("re-fetches after the 30 s cache TTL expires", async () => {
    const platformFee = 500_000n;
    const protocolFee = 50_000n;
    const netAmount = AMOUNT - platformFee - protocolFee;
    const stub = mockSimulation(client, platformFee, protocolFee, netAmount);

    await client.estimateFee(AMOUNT, CORRIDOR, SOURCE);

    // Advance past the 30 s TTL
    vi.advanceTimersByTime(31_000);

    const fresh = await client.estimateFee(AMOUNT, CORRIDOR, SOURCE);

    expect(stub).toHaveBeenCalledTimes(2);
    expect(fresh.fromCache).toBe(false);
  });

  it("caches independently per (amount, corridor, sender) key", async () => {
    const platformFee = 500_000n;
    const netAmount = AMOUNT - platformFee;
    const stub = mockSimulation(client, platformFee, 0n, netAmount);

    await client.estimateFee(AMOUNT, CORRIDOR, SOURCE);
    await client.estimateFee(AMOUNT, { currency: "USD", country: "GH" }, SOURCE);
    await client.estimateFee(AMOUNT * 2n, CORRIDOR, SOURCE);

    // Three different cache keys → three simulation calls
    expect(stub).toHaveBeenCalledTimes(3);
  });

  it("forwards an explicit retryPolicy to simulateCall", async () => {
    const stub = mockSimulation(client, 0n, 0n, AMOUNT);
    const policy = { retries: 2, delayMs: 200 };

    await client.estimateFee(AMOUNT, CORRIDOR, SOURCE, policy);

    expect(stub).toHaveBeenCalledWith(SOURCE, "get_fee_breakdown", expect.any(Array), policy);
  });
});
