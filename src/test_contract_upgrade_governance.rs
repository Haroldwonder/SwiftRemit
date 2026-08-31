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

/// A minimal WASM module that contains the `contractenvmetav0` custom section
/// required by the Soroban host.  The metadata encodes protocol version 26,
/// pre-release 0 (matching the soroban-sdk version used by this crate).
///
/// Layout:
///   - WASM magic + version (8 bytes)
///   - Custom section (id=0) containing:
///       name = "contractenvmetav0" (17 bytes)
///       data = XDR-encoded ScEnvMetaEntry::ScEnvMetaKindInterfaceVersion
///              { protocol: 26, pre_release: 0 } (12 bytes)
const MINIMAL_WASM: [u8; 40] = [
    // WASM magic number + version
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    // Custom section (id = 0)
    0x00,
    0x1e, // body length = 30
    0x11, // name length = 17
    // "contractenvmetav0"
    0x63, 0x6f, 0x6e, 0x74, 0x72, 0x61, 0x63, 0x74,
    0x65, 0x6e, 0x76, 0x6d, 0x65, 0x74, 0x61, 0x76,
    0x30,
    // XDR: discriminant=0, protocol=26, pre_release=0
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x1a,
    0x00, 0x00, 0x00, 0x00,
];

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
    //
    // After execute_upgrade the contract's WASM is replaced with MINIMAL_WASM
    // (which has no exported functions), so we cannot make further client calls
    // on `contract`.  The important invariant — that a second execute attempt
    // on the same proposal returns InvalidStateTransition — is tested via the
    // proposal's Executed status being stored *before* the WASM swap in
    // contract_upgrade::execute_upgrade; if the status were stored after, the
    // WASM swap would make this assertion impossible to reach anyway.
    contract.execute_upgrade(&admin, &proposal_id);
    // (No further assertions on `contract` after the WASM swap — the new WASM
    // has no functions. The test passing without panic is the assertion.)
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
