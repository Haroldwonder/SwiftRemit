//! Integration tests for the on-chain contract upgrade governance path
//! (`contract_upgrade.rs`), exercised via the real `SwiftRemitContract`
//! entry points: `propose_upgrade` -> `approve_upgrade` -> timelock ->
//! `execute_upgrade`.
//!
//! Previously `contract_upgrade.rs` was not reachable from any entry point
//! (no `mod contract_upgrade;` in lib.rs) and had never been compiled, so
//! none of this flow was actually exercised or even guaranteed to build.

#![cfg(test)]
extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, BytesN, Env,
};

use crate::{ContractError, SwiftRemitContract, SwiftRemitContractClient, TIMELOCK_SECONDS};

fn setup<'a>(
    env: &'a Env,
) -> (
    SwiftRemitContractClient<'a>,
    Address,
    token::StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let token_client = token::StellarAssetClient::new(
        env,
        &env.register_stellar_asset_contract_v2(admin.clone())
            .address(),
    );
    let contract =
        SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}));
    contract.initialize(&admin, &token_client.address, &250, &0, &0, &admin);
    (contract, admin, token_client)
}

/// A syntactically valid, minimal empty WASM module (magic number + version,
/// no sections) used only to obtain a real uploaded-code hash for exercising
/// `update_current_contract_wasm` in the test harness.
const MINIMAL_WASM: [u8; 8] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

#[test]
fn test_propose_upgrade_requires_min_admins() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);

    // Only the single legacy admin is registered — MIN_ADMINS_FOR_UPGRADE (3)
    // has not been reached, so upgrade governance must refuse to start.
    let wasm_hash = env.deployer().upload_contract_wasm(&MINIMAL_WASM[..]);
    let result = contract.try_propose_upgrade(&admin, &wasm_hash);
    assert_eq!(result, Err(Ok(ContractError::InsufficientAdmins)));
}

#[test]
fn test_upgrade_proposal_reaches_quorum_and_starts_timelock() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);
    contract.add_admin(&admin, &admin3);

    let wasm_hash = env.deployer().upload_contract_wasm(&MINIMAL_WASM[..]);

    let proposal_id = contract.propose_upgrade(&admin, &wasm_hash);

    // Quorum for 3 admins is (3/2)+1 = 2. The proposer's approval already
    // counts as 1; a single further approval should reach quorum and start
    // the 48h timelock.
    contract.approve_upgrade(&admin2, &proposal_id);

    // Timelock has not elapsed yet — execution must be rejected.
    let result = contract.try_execute_upgrade(&admin, &proposal_id);
    assert_eq!(result, Err(Ok(ContractError::CooldownActive)));

    // A duplicate approval from the same admin is rejected.
    let dup = contract.try_approve_upgrade(&admin2, &proposal_id);
    assert_eq!(dup, Err(Ok(ContractError::AlreadyInitialized)));
}

#[test]
fn test_execute_upgrade_after_timelock_replaces_wasm() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);
    contract.add_admin(&admin, &admin3);

    let wasm_hash = env.deployer().upload_contract_wasm(&MINIMAL_WASM[..]);

    let proposal_id = contract.propose_upgrade(&admin, &wasm_hash);
    contract.approve_upgrade(&admin2, &proposal_id);

    // Advance past the 48h timelock.
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + TIMELOCK_SECONDS + 1);

    // Execution now goes through — this is the step that used to be entirely
    // unreachable (contract_upgrade.rs wasn't compiled) and, even when
    // reached, used to just flip a status flag without ever calling
    // `env.deployer().update_current_contract_wasm(...)`.
    contract.execute_upgrade(&admin, &proposal_id);

    // Re-executing an already-executed proposal must fail.
    let result = contract.try_execute_upgrade(&admin, &proposal_id);
    assert_eq!(result, Err(Ok(ContractError::InvalidStateTransition)));
}

#[test]
fn test_cancel_upgrade_pending_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, admin, _) = setup(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    contract.add_admin(&admin, &admin2);
    contract.add_admin(&admin, &admin3);

    let wasm_hash = env.deployer().upload_contract_wasm(&MINIMAL_WASM[..]);
    let proposal_id = contract.propose_upgrade(&admin, &wasm_hash);

    contract.cancel_upgrade(&admin, &proposal_id);

    // A cancelled (rejected) proposal can no longer be approved.
    let result = contract.try_approve_upgrade(&admin2, &proposal_id);
    assert_eq!(result, Err(Ok(ContractError::InvalidStateTransition)));
}

#[test]
fn test_simulate_upgrade_rejects_null_hash() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, _) = setup(&env);

    let null_hash = BytesN::from_array(&env, &[0u8; 32]);
    let result = contract.try_simulate_upgrade(&null_hash);
    assert_eq!(result, Err(Ok(ContractError::InvalidAmount)));
}

#[test]
fn test_simulate_upgrade_previews_migration_without_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _admin, _) = setup(&env);

    let wasm_hash = env.deployer().upload_contract_wasm(&MINIMAL_WASM[..]);
    let sim = contract.simulate_upgrade(&wasm_hash);

    // A fresh contract has schema_v unset (0), so any candidate hash implies
    // at least one migration step and no storage should have been touched.
    assert_eq!(sim.current_schema_version, 0);
    assert!(sim.requires_migration);
    assert!(sim.estimated_migration_steps >= 1);
}
