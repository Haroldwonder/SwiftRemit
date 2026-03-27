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
    contract.register_agent(&agent);

    // Export locks the contract
    contract.export_migration_snapshot(&admin);

    // create_remittance must now fail with MigrationInProgress (error code 30)
    let result = contract.try_create_remittance(&sender, &agent, &1000, &None, &None, &None);
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
    contract.register_agent(&agent);

    // Create a few remittances
    let id1 = contract.create_remittance(&sender, &agent, &10_000, &None, &None, &None);
    let id2 = contract.create_remittance(&sender, &agent, &20_000, &None, &None, &None);

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
    let id3 = contract.create_remittance(&sender, &agent, &5_000, &None, &None, &None);
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
    contract.register_agent(&agent);

    let remittance_id = contract.create_remittance(&sender, &agent, &10_000, &None, &None, &None);

    // Lock via export
    contract.export_migration_snapshot(&admin);

    // confirm_payout must be blocked
    let result = contract.try_confirm_payout(&remittance_id, &None);
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
