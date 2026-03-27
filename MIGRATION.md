# SwiftRemit Contract Migration Guide

This document describes how to migrate all contract state from one deployed instance
to another using `export_migration_snapshot` and `import_migration_batch`.

---

## Overview

The migration system works in two phases:

1. **Export** — call `export_migration_snapshot` on the *source* contract.  
   This locks the source contract (blocks `create_remittance` and `confirm_payout`)
   and returns a `MigrationSnapshot` containing all state plus a SHA-256
   verification hash.

2. **Import** — call `import_migration_batch` on the *destination* contract one
   batch at a time.  
   Each batch is hash-verified before any data is written. After the final batch
   the destination contract is unlocked and ready for normal use.

---

## Prerequisites

- You must hold the **Admin** role on both the source and destination contracts.
- The destination contract must already be **initialized** (call `initialize` first).
- Keep the source contract locked (do not call `unpause` or clear the migration flag
  manually) until the import is fully verified.

---

## Step-by-Step Instructions

### 1. Initialize the destination contract

Deploy a new contract and call `initialize` with the same parameters as the source:

```bash
soroban contract invoke \
  --id <DEST_CONTRACT_ID> \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --usdc_token <USDC_TOKEN_ADDRESS> \
  --fee_bps 250 \
  --rate_limit_cooldown 3600 \
  --protocol_fee_bps 0 \
  --treasury <TREASURY_ADDRESS>
```

### 2. Export the snapshot from the source contract

```bash
soroban contract invoke \
  --id <SOURCE_CONTRACT_ID> \
  -- export_migration_snapshot \
  --caller <ADMIN_ADDRESS>
```

Save the returned `MigrationSnapshot` JSON. The source contract is now **locked** —
`create_remittance` and `confirm_payout` will return `MigrationInProgress` (error 30).

### 3. Split the snapshot into batches (off-chain)

Use the `MigrationSnapshot.persistent_data.remittances` array. Split it into chunks
of at most `MAX_MIGRATION_BATCH_SIZE` (100) items. For each chunk compute the
`batch_hash` using the same algorithm as `compute_batch_hash` in `src/migration.rs`:

```
SHA-256( batch_number_be32 || for each remittance { id_be64 || sender_xdr || agent_xdr || amount_be128 || fee_be128 || status_u8 || expiry_be64? } )
```

### 4. Import each batch into the destination contract

Call `import_migration_batch` for batch 0, then 1, then 2, … in order:

```bash
soroban contract invoke \
  --id <DEST_CONTRACT_ID> \
  -- import_migration_batch \
  --caller <ADMIN_ADDRESS> \
  --batch '{ "batch_number": 0, "total_batches": N, "remittances": [...], "batch_hash": "..." }'
```

After the **final** batch (`batch_number == total_batches - 1`) the destination
contract automatically clears the `MigrationInProgress` flag and resumes normal
operations.

### 5. Verify the migration

Query a sample of remittances on the destination contract and compare with the source:

```bash
soroban contract invoke --id <DEST_CONTRACT_ID> -- get_remittance --remittance_id 1
soroban contract invoke --id <DEST_CONTRACT_ID> -- get_remittance --remittance_id 2
```

Also confirm the counters match:

```bash
soroban contract invoke --id <DEST_CONTRACT_ID> -- get_platform_fee_bps
```

### 6. Redirect traffic to the destination contract

Update your off-chain services (backend, API, frontend) to point to
`<DEST_CONTRACT_ID>`. The source contract remains locked as an audit record.

---

## Error Reference

| Error | Code | Meaning |
|---|---|---|
| `MigrationInProgress` | 30 | Export already called; or normal op blocked during migration |
| `InvalidMigrationHash` | 29 | Batch hash mismatch — data was tampered or corrupted |
| `InvalidMigrationBatch` | 31 | `batch_number >= total_batches` |
| `Unauthorized` | 23 | Caller does not have Admin role |

---

## Security Notes

- The `verification_hash` in `MigrationSnapshot` covers all instance and persistent
  data plus the timestamp and ledger sequence. Any tampering will cause
  `InvalidMigrationHash` on import.
- Each `MigrationBatch` carries its own `batch_hash` verified independently.
- The source contract stays locked until you explicitly clear the flag (or redeploy),
  preventing new state from being created after the snapshot was taken.
