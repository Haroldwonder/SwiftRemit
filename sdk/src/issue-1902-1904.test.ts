import { describe, expect, it, vi } from "vitest";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import { SwiftRemitClient } from "./client.js";

const admin = Keypair.random().publicKey();
const user = Keypair.random().publicKey();
const agent = Keypair.random().publicKey();
const client = () => Object.create(SwiftRemitClient.prototype) as SwiftRemitClient;

async function collect(iterable: AsyncIterable<bigint>): Promise<bigint[]> {
  const result: bigint[] = [];
  for await (const id of iterable) result.push(id);
  return result;
}

describe("#1904 async pagination", () => {
  it("iterates sender IDs across pages until an empty page", async () => {
    const sdk = client();
    const get = vi.spyOn(sdk, "getRemittancesBySender")
      .mockResolvedValueOnce([1n, 2n]).mockResolvedValueOnce([3n]).mockResolvedValueOnce([]);
    expect(await collect(sdk.iterateRemittancesBySender(user, { pageSize: 2 }))).toEqual([1n, 2n, 3n]);
    expect(get.mock.calls).toEqual([
      [user, user, 0n, 2n], [user, user, 2n, 2n], [user, user, 3n, 2n],
    ]);
  });

  it("iterates agent IDs using an optional simulation account", async () => {
    const sdk = client();
    const get = vi.spyOn(sdk, "getRemittancesByAgent")
      .mockResolvedValueOnce([9n]).mockResolvedValueOnce([]);
    expect(await collect(sdk.iterateRemittancesByAgent(agent, { pageSize: 1, sourceAddress: admin }))).toEqual([9n]);
    expect(get.mock.calls).toEqual([[admin, agent, 0n, 1n], [admin, agent, 1n, 1n]]);
  });

  it("rejects invalid page sizes", async () => {
    const sdk = client();
    await expect(collect(sdk.iterateRemittancesBySender(user, { pageSize: 0 }))).rejects.toThrow(RangeError);
    await expect(collect(sdk.iterateRemittancesByAgent(agent, { pageSize: 101 }))).rejects.toThrow(RangeError);
  });
});

describe("#1903 canonical blacklist wrapper", () => {
  it("calls the non-deprecated method for both blacklist states", async () => {
    const sdk = client();
    const prepare = vi.spyOn(sdk, "prepareTransaction").mockResolvedValue({} as never);
    await sdk.setBlacklistStatus(admin, user, true);
    await sdk.setBlacklistStatus(admin, user, false);
    expect(prepare.mock.calls.map((call) => call[1])).toEqual([
      "set_blacklist_status", "set_blacklist_status",
    ]);
    expect(prepare.mock.calls[0][2][1].b()).toBe(true);
    expect(prepare.mock.calls[1][2][1].b()).toBe(false);
  });
});

describe("#1902 KYC wrapper", () => {
  it("prepares an admin update with approved flag and expiry", async () => {
    const sdk = client();
    const prepare = vi.spyOn(sdk, "prepareTransaction").mockResolvedValue({} as never);
    await sdk.setKycApproved(admin, user, true, 2_000_000_000n);
    expect(prepare.mock.calls[0][1]).toBe("set_kyc_approved");
    expect(prepare.mock.calls[0][2]).toHaveLength(3);
    expect(prepare.mock.calls[0][2][1].b()).toBe(true);
  });

  it("supports one- and two-address KYC queries", async () => {
    const sdk = client();
    const simulate = vi.spyOn(sdk as unknown as {
      simulateCall: (account: string, method: string, args: xdr.ScVal[]) => Promise<xdr.ScVal>;
    }, "simulateCall").mockResolvedValue(xdr.ScVal.scvBool(true));
    expect(await sdk.isKycApproved(user)).toBe(true);
    expect(await sdk.isKycApproved(admin, user)).toBe(true);
    expect(simulate.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [user, "is_kyc_approved"], [admin, "is_kyc_approved"],
    ]);
  });
});
