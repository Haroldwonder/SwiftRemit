//! Integration tests for contract upgrade migration (#846).
//!
//! Verifies that `migration::migrate()` preserves 100% of contract state —
//! remittance records, agent registrations, payout commitment hashes, and fee
//! configuration — across a simulated schema upgrade.
//!
//! A real on-chain WASM upgrade would call `env.deployer().update_current_contract_wasm()`
//! followed by `migrate()`.  Because Soroban's test harness does not support
//! live WASM swaps, these unit tests cover the migration module directly.
//!
//! The testnet integration path (actual WASM upgrade on a running network) is
//! documented in MIGRATION.md.

#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, token, Address, Env};

use crate::{migration, SwiftRemitContract, SwiftRemitContractClient};

// ─── Test helpers ─────────────────────────────────────────────────────────────

fn create_token(env: &Env, admin: &Address) -> token::StellarAssetClient {
    let id = env.register_stellar_asset_contract_v2(admin.clone());
    token::StellarAssetClient::new(env, &id.address())
}

fn setup() -> (Env, SwiftRemitContractClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let agent = Address::generate(&env);
    let sender = Address::generate(&env);

    let client =
        SwiftRemitContractClient::new(&env, &env.register_contract(None, SwiftRemitContract {}));

    client.initialize(&admin, &token.address, &250, &0, &0, &admin);
    client.register_agent(&agent, &None);
    token.mint(&sender, &100_000);

    (env, client, admin, agent, sender)
}

// ─── State preservation tests ─────────────────────────────────────────────────

/// `migrate()` is idempotent: calling it twice at the same schema version is safe.
#[test]
fn test_migrate_is_idempotent() {
    let (env, _client, _, _, _) = setup();
    let result1 = migration::migrate(&env);
    assert!(result1.is_ok(), "first migrate failed: {:?}", result1);
    let result2 = migration::migrate(&env);
    assert!(result2.is_ok(), "second migrate failed (not idempotent): {:?}", result2);
}

/// Remittance records are fully intact after migration.
#[test]
fn test_migrate_preserves_remittance_state() {
    let (env, client, _, agent, sender) = setup();

    env.mock_all_auths();
    let id1 = client.create_remittance(&sender, &agent, &5_000, &None, &None, &None, &None, &None);
    let id2 = client.create_remittance(&sender, &agent, &3_000, &None, &None, &None, &None, &None);

    // Snapshot state before migration.
    let before1 = client.get_remittance(&id1).expect("remittance 1 not found");
    let before2 = client.get_remittance(&id2).expect("remittance 2 not found");

    // Run migration (simulates post-WASM-upgrade migration step).
    migration::migrate(&env).expect("migrate failed");

    // Verify every field is identical after migration.
    let after1 = client.get_remittance(&id1).expect("remittance 1 missing after migrate");
    let after2 = client.get_remittance(&id2).expect("remittance 2 missing after migrate");

    assert_eq!(after1.id, before1.id);
    assert_eq!(after1.amount, before1.amount);
    assert_eq!(after1.fee, before1.fee);
    assert_eq!(after1.status, before1.status);
    assert_eq!(after1.sender, before1.sender);
    assert_eq!(after1.agent, before1.agent);

    assert_eq!(after2.id, before2.id);
    assert_eq!(after2.amount, before2.amount);
    assert_eq!(after2.fee, before2.fee);
    assert_eq!(after2.status, before2.status);
}

/// Agent registrations survive migration.
#[test]
fn test_migrate_preserves_agent_registrations() {
    let (env, client, admin, agent, _) = setup();
    let agent2 = Address::generate(&env);
    client.register_agent(&agent2, &None);

    assert!(client.is_agent_registered(&agent));
    assert!(client.is_agent_registered(&agent2));

    migration::migrate(&env).expect("migrate failed");

    assert!(
        client.is_agent_registered(&agent),
        "agent1 lost after migration"
    );
    assert!(
        client.is_agent_registered(&agent2),
        "agent2 lost after migration"
    );
    assert!(client.is_admin(&admin), "admin lost after migration");
}

/// Settlement commitment hash is unchanged after migration — the core
/// hash-verification step required for safe upgrades.
///
/// `compute_settlement_hash` derives the hash deterministically from the
/// remittance record, so any field corruption after migration would cause a
/// mismatch.
#[test]
fn test_migrate_preserves_commitment_hashes() {
    let (env, client, _, agent, sender) = setup();

    env.mock_all_auths();
    let id =
        client.create_remittance(&sender, &agent, &10_000, &None, &None, &None, &None, &None);

    // Compute deterministic commitment hash before migration.
    let hash_before = client
        .compute_settlement_hash(&id)
        .expect("hash computation failed before migrate");

    migration::migrate(&env).expect("migrate failed");

    // Re-compute after migration — must be byte-for-byte identical.
    let hash_after = client
        .compute_settlement_hash(&id)
        .expect("hash computation failed after migrate");

    assert_eq!(
        hash_before, hash_after,
        "settlement commitment hash changed after migration — state corruption detected"
    );
}

/// Accumulated fee balance is preserved across migration.
#[test]
fn test_migrate_preserves_accumulated_fees() {
    let (env, client, _, agent, sender) = setup();

    env.mock_all_auths();
    client.create_remittance(&sender, &agent, &8_000, &None, &None, &None, &None, &None);

    let fees_before = client.get_accumulated_fees().expect("fee query failed");
    assert!(fees_before > 0, "expected non-zero accumulated fees");

    migration::migrate(&env).expect("migrate failed");

    let fees_after = client.get_accumulated_fees().expect("fee query after migrate failed");
    assert_eq!(
        fees_after, fees_before,
        "accumulated fee balance changed after migration"
    );
}

/// Total remittance count is unchanged after migration.
#[test]
fn test_migrate_preserves_remittance_count() {
    let (env, client, _, agent, sender) = setup();

    env.mock_all_auths();
    client.create_remittance(&sender, &agent, &1_000, &None, &None, &None, &None, &None);
    client.create_remittance(&sender, &agent, &2_000, &None, &None, &None, &None, &None);
    client.create_remittance(&sender, &agent, &3_000, &None, &None, &None, &None, &None);

    let count_before = client.get_remittance_count();

    migration::migrate(&env).expect("migrate failed");

    assert_eq!(
        client.get_remittance_count(),
        count_before,
        "remittance count changed after migration"
    );
}
