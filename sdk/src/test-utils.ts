import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

export function makeProposalScVal(overrides: Record<string, unknown> = {}): xdr.ScVal {
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
