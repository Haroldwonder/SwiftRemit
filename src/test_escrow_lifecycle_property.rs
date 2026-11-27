//! Property-based tests for the full escrow lifecycle (#1863).
//!
//! Drives random sequences of `create_escrow`, `release_escrow`,
//! `refund_escrow`, `process_expired_escrows` and ledger time jumps, then
//! asserts the three stated invariants:
//!
//! 1. The contract's token balance is always >= the sum of pending escrow
//!    amounts.
//! 2. An escrow is paid out at most once (released + refunded <= 1).
//! 3. Terminal states never change (`Released` / `Refunded` are final).
//!
//! Run by the property-tests CI job via `cargo test test_escrow_lifecycle_property`.

#![cfg(test)]

extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Vec,
};

use crate::{EscrowStatus, SwiftRemitContract, SwiftRemitContractClient};

const TTL: u64 = 1_000;
const START_TS: u64 = 1_000_000;

fn setup<'a>(env: &'a Env) -> (SwiftRemitContractClient<'a>, token::StellarAssetClient<'a>, Address, Address, Address) {
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = START_TS);

    let admin = Address::generate(env);
    let sender = Address::generate(env);
    let recipient = Address::generate(env);

    let asset = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token::StellarAssetClient::new(env, &asset.address());
    token.mint(&sender, &1_000_000);

    let contract = SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}));
    contract.initialize(&admin, &asset.address(), &250, &0, &0, &admin);
    contract.update_escrow_ttl(&TTL);

    (contract, token, admin, sender, recipient)
}

/// One random lifecycle step.
#[derive(Clone, Debug)]
enum Step {
    Create(i128),
    Release(u32),
    Refund(u32),
    ProcessExpired(u32),
    Jump(u64),
}

fn step_strategy() -> impl Strategy<Value = Step> {
    prop_oneof![
        3 => (1i128..=1_000i128).prop_map(Step::Create),
        3 => (0u32..8).prop_map(Step::Release),
        2 => (0u32..8).prop_map(Step::Refund),
        2 => (0u32..8).prop_map(Step::ProcessExpired),
        3 => (0u64..=2_000u64).prop_map(Step::Jump),
    ]
}

fn check_invariants(
    contract: &SwiftRemitContractClient,
    token: &token::StellarAssetClient,
    created: &std::vec::Vec<u64>,
) {
    let balance = token::Client::new(&token.env, &token.address).balance(&contract.address);
    let mut pending_sum: i128 = 0;

    for id in created {
        let escrow = contract.get_escrow(id);
        match escrow.status {
            EscrowStatus::Pending => pending_sum += escrow.amount,
            EscrowStatus::Released | EscrowStatus::Refunded => {}
        }
    }

    // Invariant 1: solvency of the escrow pool.
    assert!(
        balance >= pending_sum,
        "contract balance {} < pending escrow sum {}",
        balance,
        pending_sum
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn test_escrow_lifecycle_property(steps in prop::collection::vec(step_strategy(), 1..40)) {
        let env = Env::default();
        let (contract, token, _admin, sender, recipient) = setup(&env);

        let mut created: std::vec::Vec<u64> = std::vec::Vec::new();
        // Terminal status snapshot: once an escrow reaches a terminal state it
        // must never change again.
        let mut terminal: std::vec::Vec<(u64, EscrowStatus)> = std::vec::Vec::new();

        for step in steps {
            match step {
                Step::Create(amount) => {
                    let id = contract.create_escrow(&sender, &recipient, &amount);
                    created.push(id);
                }
                Step::Release(idx) => {
                    if !created.is_empty() {
                        let id = created[(idx as usize) % created.len()];
                        let _ = contract.try_release_escrow(&id);
                    }
                }
                Step::Refund(idx) => {
                    if !created.is_empty() {
                        let id = created[(idx as usize) % created.len()];
                        let _ = contract.try_refund_escrow(&id);
                    }
                }
                Step::ProcessExpired(idx) => {
                    if !created.is_empty() {
                        let mut ids = Vec::new(&env);
                        ids.push_back(created[(idx as usize) % created.len()]);
                        let _ = contract.try_process_expired_escrows(&ids);
                    }
                }
                Step::Jump(delta) => {
                    env.ledger().with_mut(|li| li.timestamp += delta);
                }
            }

            // Invariant 3: terminal states never change.
            for (id, status) in terminal.iter() {
                prop_assert_eq!(contract.get_escrow(id).status, status.clone());
            }

            // Record newly reached terminal states.
            for id in created.iter() {
                let status = contract.get_escrow(id).status;
                if status != EscrowStatus::Pending
                    && !terminal.iter().any(|(tid, _)| tid == id)
                {
                    terminal.push((*id, status));
                }
            }

            check_invariants(&contract, &token, &created);
        }

        // Invariant 2: an escrow is paid out at most once. A terminal escrow
        // must reject any further release/refund/expiry processing.
        for id in created.iter() {
            let status = contract.get_escrow(id).status;
            if status != EscrowStatus::Pending {
                prop_assert!(contract.try_release_escrow(id).is_err());
                prop_assert!(contract.try_refund_escrow(id).is_err());
                let mut ids = Vec::new(&env);
                ids.push_back(*id);
                let processed = contract.try_process_expired_escrows(&ids);
                prop_assert!(processed.is_ok());
                prop_assert_eq!(processed.unwrap().len(), 0);
                prop_assert_eq!(contract.get_escrow(id).status, status);
            }
        }

        check_invariants(&contract, &token, &created);
    }
}
