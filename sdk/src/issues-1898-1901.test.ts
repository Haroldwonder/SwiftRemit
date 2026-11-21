import { describe, expect, it, vi } from "vitest";
import { Keypair, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { SwiftRemitClient } from "./client.js";
import { ErrorCode, parseContractError } from "./errors.js";
import { addressToScVal } from "./convert.js";

// The client already has escrow and oracle wrappers. Stub its transport so
// the wrappers are exercised without a network, wallet or installed extras.
function mockClient() {
  const client = Object.create(SwiftRemitClient.prototype) as SwiftRemitClient;
  const prepare = vi.fn().mockResolvedValue({});
  const simulate = vi.fn();
  (client as any).prepareTransaction = prepare;
  (client as any).simulateCall = simulate;
  return { client, prepare, simulate };
}
const sender = Keypair.random().publicKey();
const recipient = Keypair.random().publicKey();
const admin = Keypair.random().publicKey();

describe("#1898 generated contract error mapping", () => {
  it("decodes EscrowNotYetExpired (85) with a useful message and remediation", () => {
    expect(ErrorCode.EscrowNotYetExpired).toBe(85);
    const error = parseContractError("HostError: Error(Contract, #85)");
    expect(error?.code).toBe(85);
    expect(error?.message).toBe("Escrow has not expired yet");
    expect(error?.remediation).toMatch(/expir|wait/i);
  });
  it("uses current Rust discriminants for other restored errors", () => {
    expect(ErrorCode.BelowMinReputation).toBe(70);
    expect(ErrorCode.NotFound).toBe(80);
    expect(ErrorCode.TokenNotSep41).toBe(86);
  });
});

describe("#1900 escrow SDK wrappers", () => {
  it("builds a create_escrow transaction using an integer token amount", async () => {
    const { client, prepare } = mockClient();
    await client.createEscrow(sender, recipient, 123n);
    const [caller, method, args] = prepare.mock.calls[0] as [string, string, xdr.ScVal[]];
    expect(caller).toBe(sender);
    expect(method).toBe("create_escrow");
    expect(args).toHaveLength(4);
    expect(args[0].toXDR("base64")).toBe(addressToScVal(sender).toXDR("base64"));
    expect(args[1].toXDR("base64")).toBe(addressToScVal(recipient).toXDR("base64"));
    expect(BigInt(scValToNative(args[2]) as bigint)).toBe(123n);
    expect(args[3].switch().name).toBe("scvVoid");
  });

  it("builds release, refund and batch expiry operations", async () => {
    const { client, prepare } = mockClient();
    await client.releaseEscrow(admin, 7n);
    expect(prepare.mock.calls[0][1]).toBe("release_escrow");
    await client.refundEscrow(sender, 7n);
    expect(prepare.mock.calls[1][1]).toBe("refund_escrow");
    await client.processExpiredEscrows(admin, [7n, 8n]);
    expect(prepare.mock.calls[2][1]).toBe("process_expired_escrows");
    const args = prepare.mock.calls[2][2] as xdr.ScVal[];
    expect(args[0].vec()).toHaveLength(2);
  });

  it("returns a typed escrow and TTL from simulation results", async () => {
    const { client, simulate } = mockClient();
    simulate.mockResolvedValueOnce(nativeToScVal({
      transfer_id: 7n,
      sender,
      recipient,
      amount: 123n,
      expiry: null,
      status: { Pending: null },
    }));
    const escrow = await client.getEscrow(sender, 7n);
    expect(escrow.status).toBe("Pending");
    expect(escrow.transferId).toBe(7n);
    expect(escrow.amount).toBe(123n);
    simulate.mockResolvedValueOnce(nativeToScVal(50n));
    expect(await client.getEscrowTtl(sender)).toBe(50n);
  });
});

describe("#1901 oracle SDK wrappers", () => {
  it("builds set_oracle with an optional ledger staleness window", async () => {
    const { client, prepare } = mockClient();
    await client.setOracle(admin, recipient, 42);
    expect(prepare.mock.calls[0][0]).toBe(admin);
    expect(prepare.mock.calls[0][1]).toBe("set_oracle");
    expect((prepare.mock.calls[0][2] as xdr.ScVal[])).toHaveLength(3);
    await client.setOracle(admin, recipient);
    const args = prepare.mock.calls[1][2] as xdr.ScVal[];
    expect(args[2].switch().name).toBe("scvVoid");
  });

  it("reads an oracle address and rate using the supplied query account", async () => {
    const { client, simulate } = mockClient();
    simulate.mockResolvedValueOnce(addressToScVal(recipient));
    expect(await client.getOracle(sender)).toBe(recipient);
    expect(simulate).toHaveBeenCalledWith(sender, "get_oracle", []);
    simulate.mockResolvedValueOnce(nativeToScVal(1250));
    expect(await client.getOracleRate(sender)).toBe(1250);
    expect(simulate).toHaveBeenCalledWith(sender, "get_oracle_rate", []);
  });
});
