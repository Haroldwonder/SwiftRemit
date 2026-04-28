# Proof Validation

SwiftRemit validates payout confirmation using a deterministic commitment proof.

## Overview

When a remittance is created, the contract stores a `PayoutCommitment` (`BytesN<32>`) for that remittance ID. On `confirm_payout(remittance_id, proof)`, the submitted `proof` is accepted only if it exactly matches the stored commitment.

If proof is required for the remittance (`settlement_config.require_proof = true`):

- `proof = None` -> `MissingProof`
- `proof != stored_commitment` -> `InvalidProof`
- `proof == stored_commitment` -> payout can proceed

## Commitment Scheme

The commitment uses the same canonical hash as settlement IDs (`SHA-256`):

1. `remittance_id` (`u64`, big-endian)
2. `sender` (`Address`, XDR bytes)
3. `agent` (`Address`, XDR bytes)
4. `amount` (`i128`, big-endian)
5. `fee` (`i128`, big-endian)
6. `expiry` (`u64`, big-endian, `0` if `None`)

Hash function: `sha256(serialized_bytes)`.

## Off-Chain Proof Generation

Agents can generate the expected proof off-chain using remittance data:

```text
proof = sha256(
  remittance_id_be
  || sender_xdr
  || agent_xdr
  || amount_be
  || fee_be
  || expiry_be_or_zero
)
```

Submit that 32-byte hash as `proof` to `confirm_payout`.

## Security Notes

- Proofs are remittance-specific because `remittance_id` is part of the hash.
- Duplicate payout is still blocked by settlement deduplication checks.
- Remittances without `require_proof` remain backward compatible and do not require a proof.
