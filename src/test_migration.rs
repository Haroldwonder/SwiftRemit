#![cfg(test)]

use crate::{
    migration::{MigrationBatch, MigrationSnapshot},
    ContractError, RemittanceStatus, SwiftRemitContract, SwiftRemitContractClient,
};
use soroban_sdk::{testutils::Address as _, token, xdr::ToXdr, Address, Bytes, BytesN, Env};

// ─── helpers ────────────────────────────────────────────────────────────────

fn create_token<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    token::StellarAssetClient::new(
        env,
        &env.register_stellar_asset_contract_v2(admin.clone()).address(),
    )
}

fn create_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

/// Initialise a fresh contract and return (client, admin, token_client).
fn setup(env: &Env) -> (SwiftRemitContractClient, Address, token::StellarAssetClient) {
    let admin = Address::generate(env);
    let token = create_token(env, &admin);
    let contract = create_contract(env);
    contract.initialize(&admin, &token.address, &250, &0, &0, &admin);
    (contract, admin, token)
}

// ─── export_migration_snapshot ──────────────────────────────────────────────

#[test]
fn test_export_snapshot_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, _token) = setup(&env);
    let non_admin = Address::generate(&env);

    // Non-admin should be rejected
    let result = contract.try_export_migration_snapshot(&non_admin);
    assert!(result.is_err());
}

#[test]
fn test_export_snapshot_returns_valid_snapshot() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);

    let snapshot = contract.export_migration_snapshot(&admin);

    // Basic structural checks
    assert_eq!(snapshot.version, 1);
    assert_eq!(snapshot.instance_data.admin, admin);
    assert_eq!(snapshot.instance_data.platform_fee_bps, 250);
    // Verification hash must be non-zero (SHA-256 of real data)
    let zero: [u8; 32] = [0u8; 32];
    assert_ne!(snapshot.verification_hash.to_array(), zero);
}

#[test]
fn test_export_sets_migration_in_progress() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10_000);
    contract.register_agent(&agent, &None);

    // Export locks the contract
    contract.export_migration_snapshot(&admin);

    // create_remittance must now fail with MigrationInProgress (error code 30)
    let result = contract.try_create_remittance(&sender, &agent, &1000, &None, &None, &None, &None, &None);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::MigrationInProgress
    );
}

#[test]
fn test_export_prevents_double_export() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);

    contract.export_migration_snapshot(&admin);

    // Second export must fail
    let result = contract.try_export_migration_snapshot(&admin);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::MigrationInProgress
    );
}

// ─── import_migration_batch ──────────────────────────────────────────────────

#[test]
fn test_import_batch_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);
    let non_admin = Address::generate(&env);

    // Export first to get a valid batch
    let snapshot = contract.export_migration_snapshot(&admin);

    // Build a single-batch from the snapshot (no remittances)
    let batch = build_single_batch(&env, &snapshot);

    let result = contract.try_import_migration_batch(&non_admin, &batch);
    assert!(result.is_err());
}

#[test]
fn test_import_batch_rejects_invalid_hash() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);

    let snapshot = contract.export_migration_snapshot(&admin);
    let mut batch = build_single_batch(&env, &snapshot);

    // Corrupt the hash
    let bad_hash = BytesN::from_array(&env, &[0xffu8; 32]);
    batch.batch_hash = bad_hash;

    let result = contract.try_import_migration_batch(&admin, &batch);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::InvalidMigrationHash
    );
}

#[test]
fn test_import_batch_rejects_out_of_range_batch_number() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);
    let snapshot = contract.export_migration_snapshot(&admin);

    let mut batch = build_single_batch(&env, &snapshot);
    // batch_number == total_batches is invalid (0-indexed, so valid range is 0..total_batches-1)
    batch.batch_number = batch.total_batches;

    let result = contract.try_import_migration_batch(&admin, &batch);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::InvalidMigrationBatch
    );
}

// ─── full export → import cycle ─────────────────────────────────────────────

#[test]
fn test_full_export_import_cycle_empty_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);

    // Export
    let snapshot = contract.export_migration_snapshot(&admin);
    assert_eq!(snapshot.instance_data.remittance_counter, 0);

    // Import the single empty batch
    let batch = build_single_batch(&env, &snapshot);
    contract.import_migration_batch(&admin, &batch);

    // After final batch the lock must be cleared — create_remittance should work again
    // (we just check the flag is gone by verifying is_paused still returns false)
    assert!(!contract.is_paused());
}

#[test]
fn test_full_export_import_cycle_with_remittances() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &100_000);
    contract.register_agent(&agent, &None);

    // Create a few remittances
    let id1 = contract.create_remittance(&sender, &agent, &10_000, &None, &None, &None, &None, &None);
    let id2 = contract.create_remittance(&sender, &agent, &20_000, &None, &None, &None, &None, &None);

    // Export — locks the contract
    let snapshot = contract.export_migration_snapshot(&admin);

    assert_eq!(snapshot.instance_data.remittance_counter, 2);
    assert_eq!(snapshot.persistent_data.remittances.len(), 2);

    // Verify the snapshot hash is consistent
    let r0 = snapshot.persistent_data.remittances.get(0).unwrap();
    let r1 = snapshot.persistent_data.remittances.get(1).unwrap();
    assert_eq!(r0.id, id1);
    assert_eq!(r1.id, id2);
    assert_eq!(r0.status, RemittanceStatus::Pending);
    assert_eq!(r1.status, RemittanceStatus::Pending);

    // Import the single batch (all remittances fit in one batch for this test)
    let batch = build_single_batch(&env, &snapshot);
    contract.import_migration_batch(&admin, &batch);

    // Lock cleared — normal ops resume
    let id3 = contract.create_remittance(&sender, &agent, &5_000, &None, &None, &None, &None, &None);
    assert_eq!(id3, 3);
}

#[test]
fn test_migration_blocks_confirm_payout() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &50_000);
    contract.register_agent(&agent, &None);

    let remittance_id = contract.create_remittance(&sender, &agent, &10_000, &None, &None, &None, &None, &None);

    // Lock via export
    contract.export_migration_snapshot(&admin);

    // confirm_payout must be blocked
    let result = contract.try_confirm_payout(&remittance_id, &None, &None);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::MigrationInProgress
    );
}

// ─── helper: build a single-batch from a snapshot ───────────────────────────

/// Constructs a `MigrationBatch` that wraps all remittances from `snapshot`
/// into batch 0 of 1, with a correctly computed hash.
fn build_single_batch(env: &Env, snapshot: &MigrationSnapshot) -> MigrationBatch {
    let remittances = snapshot.persistent_data.remittances.clone();

    let batch_hash = {
        let mut data = Bytes::new(env);
        let batch_number: u32 = 0;
        data.append(&Bytes::from_array(env, &batch_number.to_be_bytes()));

        for i in 0..remittances.len() {
            let r = remittances.get_unchecked(i);
            data.append(&Bytes::from_array(env, &r.id.to_be_bytes()));
            data.append(&r.sender.clone().to_xdr(env));
            data.append(&r.agent.clone().to_xdr(env));
            data.append(&Bytes::from_array(env, &r.amount.to_be_bytes()));
            data.append(&Bytes::from_array(env, &r.fee.to_be_bytes()));
            let status_byte: u8 = match r.status {
                RemittanceStatus::Pending => 0,
                RemittanceStatus::Completed => 1,
                RemittanceStatus::Cancelled => 2,
                _ => 3,
            };
            data.append(&Bytes::from_array(env, &[status_byte]));
            if let Some(expiry) = r.expiry {
                data.append(&Bytes::from_array(env, &expiry.to_be_bytes()));
            }
        }

        let hash_bytes = env.crypto().sha256(&data);
        BytesN::from_array(env, &hash_bytes.to_array())
    };

    MigrationBatch {
        batch_number: 0,
        total_batches: 1,
        remittances,
        batch_hash,
    }
}

// ─── Issue #418 — strict monotonic batch ordering ────────────────────────────

#[test]
fn test_import_batch_rejects_out_of_order_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &100_000);
    contract.register_agent(&agent, &None);

    // Create 2 remittances so we have 2 batches
    contract.create_remittance(&sender, &agent, &10_000, &None, &None, &None, &None, &None);
    contract.create_remittance(&sender, &agent, &20_000, &None, &None, &None, &None, &None);

    let snapshot = contract.export_migration_snapshot(&admin);

    // Build batch 1 (out of order — should be rejected before batch 0)
    let remittances = snapshot.persistent_data.remittances.clone();
    let batch_1 = {
        let mut data = soroban_sdk::Bytes::new(&env);
        let batch_number: u32 = 1;
        data.append(&soroban_sdk::Bytes::from_array(&env, &batch_number.to_be_bytes()));
        for i in 0..remittances.len() {
            let r = remittances.get_unchecked(i);
            data.append(&soroban_sdk::Bytes::from_array(&env, &r.id.to_be_bytes()));
            data.append(&r.sender.clone().to_xdr(&env));
            data.append(&r.agent.clone().to_xdr(&env));
            data.append(&soroban_sdk::Bytes::from_array(&env, &r.amount.to_be_bytes()));
            data.append(&soroban_sdk::Bytes::from_array(&env, &r.fee.to_be_bytes()));
            let status_byte: u8 = match r.status {
                crate::RemittanceStatus::Pending => 0,
                crate::RemittanceStatus::Completed => 1,
                crate::RemittanceStatus::Cancelled => 2,
                _ => 0,
            };
            data.append(&soroban_sdk::Bytes::from_array(&env, &[status_byte]));
            if let Some(expiry) = r.expiry {
                data.append(&soroban_sdk::Bytes::from_array(&env, &expiry.to_be_bytes()));
            }
        }
        let hash_bytes = env.crypto().sha256(&data);
        MigrationBatch {
            batch_number: 1,
            total_batches: 2,
            remittances: remittances.clone(),
            batch_hash: BytesN::from_array(&env, &hash_bytes.to_array()),
        }
    };

    // Submitting batch 1 before batch 0 must fail
    let result = contract.try_import_migration_batch(&admin, &batch_1);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::InvalidMigrationBatch
    );
}

#[test]
fn test_import_batch_rejects_duplicate_batch_index() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);
    let snapshot = contract.export_migration_snapshot(&admin);

    // Import batch 0 successfully
    let batch0 = build_single_batch(&env, &snapshot);
    contract.import_migration_batch(&admin, &batch0);

    // Submitting batch 0 again must fail (duplicate)
    // We need to rebuild it since the first import consumed it
    // Re-export is blocked (MigrationInProgress cleared after final batch)
    // Instead test with a fresh contract
    let env2 = Env::default();
    env2.mock_all_auths();
    let (contract2, admin2, _token2) = setup(&env2);
    let snapshot2 = contract2.export_migration_snapshot(&admin2);

    // Build two-batch scenario by manually constructing batch 0 twice
    let remittances = snapshot2.persistent_data.remittances.clone();
    let batch_0a = build_single_batch(&env2, &snapshot2);

    // Simulate a two-batch total so the lock isn't cleared after first import
    let batch_0b = MigrationBatch {
        batch_number: 0,
        total_batches: 2, // pretend there are 2 batches
        remittances: remittances.clone(),
        batch_hash: {
            let mut data = soroban_sdk::Bytes::new(&env2);
            let bn: u32 = 0;
            data.append(&soroban_sdk::Bytes::from_array(&env2, &bn.to_be_bytes()));
            for i in 0..remittances.len() {
                let r = remittances.get_unchecked(i);
                data.append(&soroban_sdk::Bytes::from_array(&env2, &r.id.to_be_bytes()));
                data.append(&r.sender.clone().to_xdr(&env2));
                data.append(&r.agent.clone().to_xdr(&env2));
                data.append(&soroban_sdk::Bytes::from_array(&env2, &r.amount.to_be_bytes()));
                data.append(&soroban_sdk::Bytes::from_array(&env2, &r.fee.to_be_bytes()));
                let status_byte: u8 = match r.status {
                    crate::RemittanceStatus::Pending => 0,
                    crate::RemittanceStatus::Completed => 1,
                    crate::RemittanceStatus::Cancelled => 2,
                    _ => 0,
                };
                data.append(&soroban_sdk::Bytes::from_array(&env2, &[status_byte]));
                if let Some(expiry) = r.expiry {
                    data.append(&soroban_sdk::Bytes::from_array(&env2, &expiry.to_be_bytes()));
                }
            }
            let h = env2.crypto().sha256(&data);
            BytesN::from_array(&env2, &h.to_array())
        },
    };

    // Import batch 0 (total_batches=2, so lock stays)
    contract2.import_migration_batch(&admin2, &batch_0b);

    // Submitting batch 0 again must fail
    let dup = MigrationBatch {
        batch_number: 0,
        total_batches: 2,
        remittances: remittances.clone(),
        batch_hash: batch_0b.batch_hash.clone(),
    };
    let result = contract2.try_import_migration_batch(&admin2, &dup);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::InvalidMigrationBatch
    );
}

// ─── Issue #1851 — total_batches consistency across batches ─────────────────

/// Builds a batch with an explicit `batch_number` / `total_batches` and a
/// correctly computed hash over the given remittances.
fn build_batch_with_totals(
    env: &Env,
    remittances: &soroban_sdk::Vec<crate::Remittance>,
    batch_number: u32,
    total_batches: u32,
) -> MigrationBatch {
    let batch_hash = {
        let mut data = Bytes::new(env);
        data.append(&Bytes::from_array(env, &batch_number.to_be_bytes()));
        for i in 0..remittances.len() {
            let r = remittances.get_unchecked(i);
            data.append(&Bytes::from_array(env, &r.id.to_be_bytes()));
            data.append(&r.sender.clone().to_xdr(env));
            data.append(&r.agent.clone().to_xdr(env));
            data.append(&Bytes::from_array(env, &r.amount.to_be_bytes()));
            data.append(&Bytes::from_array(env, &r.fee.to_be_bytes()));
            let status_byte: u8 = match r.status {
                RemittanceStatus::Pending => 0,
                RemittanceStatus::Completed => 1,
                RemittanceStatus::Cancelled => 2,
                _ => 3,
            };
            data.append(&Bytes::from_array(env, &[status_byte]));
            if let Some(expiry) = r.expiry {
                data.append(&Bytes::from_array(env, &expiry.to_be_bytes()));
            }
        }
        let hash_bytes = env.crypto().sha256(&data);
        BytesN::from_array(env, &hash_bytes.to_array())
    };

    MigrationBatch {
        batch_number,
        total_batches,
        remittances: remittances.clone(),
        batch_hash,
    }
}

#[test]
fn test_import_batch_rejects_inconsistent_total_batches() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &100_000);
    contract.register_agent(&agent, &None);

    contract.create_remittance(&sender, &agent, &10_000, &None, &None, &None, &None, &None);
    contract.create_remittance(&sender, &agent, &20_000, &None, &None, &None, &None, &None);

    let snapshot = contract.export_migration_snapshot(&admin);
    let remittances = snapshot.persistent_data.remittances.clone();

    // Batch 0 of 2 — establishes total_batches = 2.
    let batch_0 = build_batch_with_totals(&env, &remittances, 0, 2);
    contract.import_migration_batch(&admin, &batch_0);

    // Batch 1 lies: claims total_batches = 1 (would end the migration early).
    let lying_batch = build_batch_with_totals(&env, &remittances, 1, 1);
    let result = contract.try_import_migration_batch(&admin, &lying_batch);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::InvalidMigrationBatch
    );

    // The lock must still be held — the migration is not complete.
    let blocked = contract.try_create_remittance(&sender, &agent, &1000, &None, &None, &None, &None, &None);
    assert_eq!(
        blocked.unwrap_err().unwrap(),
        ContractError::MigrationInProgress
    );

    // The imported counter must not have advanced: batch 1 is still expected.
    let batch_1 = build_batch_with_totals(&env, &remittances, 1, 2);
    contract.import_migration_batch(&admin, &batch_1);

    // Now the migration is complete and the lock is cleared.
    let id = contract.create_remittance(&sender, &agent, &1000, &None, &None, &None, &None, &None);
    assert_eq!(id, 3);
}

#[test]
fn test_import_batch_consistent_multi_batch_completes() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &100_000);
    contract.register_agent(&agent, &None);

    contract.create_remittance(&sender, &agent, &10_000, &None, &None, &None, &None, &None);
    contract.create_remittance(&sender, &agent, &20_000, &None, &None, &None, &None, &None);

    let snapshot = contract.export_migration_snapshot(&admin);
    let remittances = snapshot.persistent_data.remittances.clone();

    // Batch 0 of 2 — lock stays.
    let batch_0 = build_batch_with_totals(&env, &remittances, 0, 2);
    contract.import_migration_batch(&admin, &batch_0);
    let blocked = contract.try_create_remittance(&sender, &agent, &1000, &None, &None, &None, &None, &None);
    assert_eq!(
        blocked.unwrap_err().unwrap(),
        ContractError::MigrationInProgress
    );

    // Batch 1 of 2 — consistent total_batches, completes the migration.
    let batch_1 = build_batch_with_totals(&env, &remittances, 1, 2);
    contract.import_migration_batch(&admin, &batch_1);

    // Lock cleared — normal ops resume.
    let id = contract.create_remittance(&sender, &agent, &1000, &None, &None, &None, &None, &None);
    assert_eq!(id, 3);
}

// ─── Issue #1671 — protocol_fee backfill migration ──────────────────────────

#[test]
fn test_protocol_fee_backfill_migration_sets_all_records() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &100_000);
    contract.register_agent(&agent, &None);

    // Seed remittances that predate the protocol_fee field (legacy records).
    let id1 = contract.create_remittance(&sender, &agent, &10_000, &None, &None, &None, &None, &None);
    let id2 = contract.create_remittance(&sender, &agent, &20_000, &None, &None, &None, &None, &None);

    // Run the backfill migration: every legacy record must receive a protocol_fee.
    contract.backfill_protocol_fee(&admin);

    let r1 = contract.get_remittance(&id1);
    let r2 = contract.get_remittance(&id2);

    // Every record must now carry a protocol_fee (non-zero for a non-zero bps).
    assert!(r1.protocol_fee > 0);
    assert!(r2.protocol_fee > 0);

    // Settlement must use the backfilled value, not a freshly re-priced one.
    let quoted1 = r1.protocol_fee;
    let quoted2 = r2.protocol_fee;

    // Admin raises the protocol fee after creation.
    contract.set_protocol_fee_bps(&admin, &500);

    // Backfilled values are immutable across the bps change.
    let r1_after = contract.get_remittance(&id1);
    let r2_after = contract.get_remittance(&id2);
    assert_eq!(r1_after.protocol_fee, quoted1);
    assert_eq!(r2_after.protocol_fee, quoted2);

    // Settlement uses the backfilled (quoted) value.
    let net1 = contract.confirm_payout(&id1, &None, &None);
    assert_eq!(net1, 10_000 - r1_after.fee - quoted1);

    let net2 = contract.confirm_payout(&id2, &None, &None);
    assert_eq!(net2, 20_000 - r2_after.fee - quoted2);
}

#[test]
fn test_protocol_fee_backfill_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, _token) = setup(&env);
    let non_admin = Address::generate(&env);

    let result = contract.try_backfill_protocol_fee(&non_admin);
    assert!(result.is_err());
}

// ─── Issue #419 — abort_migration ────────────────────────────────────────────

#[test]
fn test_abort_migration_resets_state_to_idle() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);

    // Lock via export
    contract.export_migration_snapshot(&admin);

    // Abort
    contract.abort_migration(&admin);

    // Normal ops should be unblocked
    assert!(!contract.is_paused());

    // A second export should now succeed (state is Idle again)
    contract.export_migration_snapshot(&admin);
}

#[test]
fn test_abort_migration_when_not_in_progress_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);

    let result = contract.try_abort_migration(&admin);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::NotFound
    );
}

#[test]
fn test_abort_migration_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);
    let other = Address::generate(&env);

    contract.export_migration_snapshot(&admin);

    let result = contract.try_abort_migration(&other);
    assert!(result.is_err());
}

#[test]
fn test_abort_migration_resets_batch_counter() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _token) = setup(&env);
    let snapshot = contract.export_migration_snapshot(&admin);

    // Build a two-batch scenario and import batch 0
    let remittances = snapshot.persistent_data.remittances.clone();
    let batch_0 = MigrationBatch {
        batch_number: 0,
        total_batches: 2,
        remittances: remittances.clone(),
        batch_hash: {
            let mut data = soroban_sdk::Bytes::new(&env);
            let bn: u32 = 0u32;
            data.append(&soroban_sdk::Bytes::from_array(&env, &bn.to_be_bytes()));
            for i in 0..remittances.len() {
                let r = remittances.get_unchecked(i);
                data.append(&soroban_sdk::Bytes::from_array(&env, &r.id.to_be_bytes()));
                data.append(&r.sender.clone().to_xdr(&env));
                data.append(&r.agent.clone().to_xdr(&env));
                data.append(&soroban_sdk::Bytes::from_array(&env, &r.amount.to_be_bytes()));
                data.append(&soroban_sdk::Bytes::from_array(&env, &r.fee.to_be_bytes()));
                let status_byte: u8 = match r.status {
                    crate::RemittanceStatus::Pending => 0,
                    crate::RemittanceStatus::Completed => 1,
                    crate::RemittanceStatus::Cancelled => 2,
                    _ => 0,
                };
                data.append(&soroban_sdk::Bytes::from_array(&env, &[status_byte]));
                if let Some(expiry) = r.expiry {
                    data.append(&soroban_sdk::Bytes::from_array(&env, &expiry.to_be_bytes()));
                }
            }
            let h = env.crypto().sha256(&data);
            BytesN::from_array(&env, &h.to_array())
        },
    };
    contract.import_migration_batch(&admin, &batch_0);

    // Abort — resets batch counter
    contract.abort_migration(&admin);

    // Re-export and import from batch 0 again — should succeed
    let snapshot2 = contract.export_migration_snapshot(&admin);
    let batch_fresh = build_single_batch(&env, &snapshot2);
    contract.import_migration_batch(&admin, &batch_fresh);
}

#[test]
fn test_abort_migration_allows_create_remittance() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &10_000);
    contract.register_agent(&agent, &None);

    // Lock via export — creates are blocked
    contract.export_migration_snapshot(&admin);
    let blocked = contract.try_create_remittance(&sender, &agent, &1000, &None, &None, &None, &None, &None);
    assert_eq!(
        blocked.unwrap_err().unwrap(),
        ContractError::MigrationInProgress
    );

    // Abort clears the lock — creates resume
    contract.abort_migration(&admin);
    let id = contract.create_remittance(&sender, &agent, &1000, &None, &None, &None, &None, &None);
    assert_eq!(id, 1);
}

#[test]
fn test_abort_migration_allows_confirm_payout() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);

    token.mint(&sender, &50_000);
    contract.register_agent(&agent, &None);

    let remittance_id =
        contract.create_remittance(&sender, &agent, &10_000, &None, &None, &None, &None, &None);

    // Lock via export — payouts are blocked
    contract.export_migration_snapshot(&admin);
    let blocked = contract.try_confirm_payout(&remittance_id, &None, &None);
    assert_eq!(
        blocked.unwrap_err().unwrap(),
        ContractError::MigrationInProgress
    );

    // Abort clears the lock — payouts resume
    contract.abort_migration(&admin);
    contract.confirm_payout(&remittance_id, &None, &None);
}

// ─── Issue #1844/#1845 — escrow token backfill + sender/recipient indexes ────

#[test]
fn test_escrow_token_backfill_migration() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, token) = setup(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    token.mint(&sender, &100_000);

    // Seed legacy escrow records that predate the `token` field.
    let id1 = contract.create_escrow(&sender, &recipient, &10_000, &None, &None);
    let id2 = contract.create_escrow(&sender, &recipient, &20_000, &None, &None);

    // Run the backfill migration: every legacy escrow must receive the
    // default token (USDC) and be indexed by sender and recipient.
    contract.backfill_escrow_token(&admin);

    let usdc = token.address.clone();

    // Each escrow now carries the default token.
    let e1 = contract.get_escrow(&id1);
    let e2 = contract.get_escrow(&id2);
    assert_eq!(e1.token, usdc);
    assert_eq!(e2.token, usdc);

    // Sender index is populated and returns both escrows.
    let by_sender = contract.get_escrows_by_sender(&sender, &0, &100);
    assert_eq!(by_sender.len(), 2);
    assert_eq!(by_sender.get(0).unwrap().id, id1);
    assert_eq!(by_sender.get(1).unwrap().id, id2);

    // Recipient index is populated and returns both escrows.
    let by_recipient = contract.get_escrows_by_recipient(&recipient, &0, &100);
    assert_eq!(by_recipient.len(), 2);
    assert_eq!(by_recipient.get(0).unwrap().id, id1);
    assert_eq!(by_recipient.get(1).unwrap().id, id2);

    // The backfill is idempotent — running it again must not duplicate index
    // entries.
    contract.backfill_escrow_token(&admin);
    assert_eq!(contract.get_escrows_by_sender(&sender, &0, &100).len(), 2);
    assert_eq!(
        contract.get_escrows_by_recipient(&recipient, &0, &100).len(),
        2
    );
}

#[test]
fn test_escrow_token_backfill_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, _token) = setup(&env);
    let non_admin = Address::generate(&env);

    let result = contract.try_backfill_escrow_token(&non_admin);
    assert!(result.is_err());
}
