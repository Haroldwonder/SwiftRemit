//! Tests for issues #1826, #1827, #1828, #1829.
//!
//! #1826 – the TTL sweep skipped the newest remittance (IDs start at 1).
//! #1827 – the TTL sweep walked every record ever created; a paged variant exists.
//! #1828 – the TTL sweep never extended escrow records.
//! #1829 – `refund_escrow` and `process_expired_escrows` disagreed on the boundary.

#![cfg(test)]

use crate::storage::{escrow_ttl, remittance_ttl, TTL_EXTEND_MAX_PAGE};
use crate::{EscrowStatus, SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, Vec,
};

// ── helpers ──────────────────────────────────────────────────────────────────

const EXTEND_BY: u32 = 50_000;
const ESCROW_TTL_SECONDS: u64 = 3_600;

fn setup(
    env: &Env,
) -> (
    SwiftRemitContractClient,
    token::StellarAssetClient,
    Address,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_sac = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token = token::StellarAssetClient::new(env, &token_sac);
    let sender = Address::generate(env);
    let agent = Address::generate(env);

    token.mint(&sender, &1_000_000);

    let contract =
        SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}));
    contract.initialize(&admin, &token_sac, &250, &0, &0, &admin);
    contract.register_agent(&agent, &None);

    (contract, token, admin, sender, agent)
}

/// Creates `n` remittances and returns the ID of the last one.
fn create_remittances(
    contract: &SwiftRemitContractClient,
    sender: &Address,
    agent: &Address,
    n: u64,
) -> u64 {
    let mut last = 0;
    for _ in 0..n {
        last = contract.create_remittance(
            sender, agent, &500, &None, &None, &None, &None, &None, &None,
        );
    }
    last
}

// ── #1826 ────────────────────────────────────────────────────────────────────

/// The newest remittance is the one most likely to still be pending, and it was
/// the one the sweep never reached: IDs run `1..=counter`, the loop ran
/// `0..counter`.
#[test]
fn test_1826_sweep_extends_the_newest_remittance() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent) = setup(&env);
    let last = create_remittances(&contract, &sender, &agent, 3);
    assert_eq!(last, 3, "IDs are assigned as counter + 1");

    contract.extend_storage_ttl(&admin, &EXTEND_BY);

    env.as_contract(&contract.address, || {
        for id in 1..=last {
            let ttl = remittance_ttl(&env, id)
                .unwrap_or_else(|| panic!("remittance {} should exist", id));
            assert!(
                ttl >= EXTEND_BY,
                "remittance {} was left on a TTL of {}",
                id,
                ttl
            );
        }
    });
}

// ── #1827 ────────────────────────────────────────────────────────────────────

/// The paged variant does a bounded amount of work and says where to resume, so
/// an ops script can walk a protocol of any size without ever asking for more
/// than one page of budget.
#[test]
fn test_1827_paged_sweep_reports_where_to_resume() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent) = setup(&env);
    create_remittances(&contract, &sender, &agent, 5);

    let next = contract.extend_storage_ttl_page(&admin, &EXTEND_BY, &1, &2);
    assert_eq!(next, 3, "a page of 2 from ID 1 resumes at 3");

    let next = contract.extend_storage_ttl_page(&admin, &EXTEND_BY, &next, &2);
    assert_eq!(next, 5);

    let next = contract.extend_storage_ttl_page(&admin, &EXTEND_BY, &next, &2);
    assert_eq!(next, 0, "the last page reports the end of the range");

    env.as_contract(&contract.address, || {
        for id in 1..=5u64 {
            let ttl = remittance_ttl(&env, id).expect("remittance should exist");
            assert!(ttl >= EXTEND_BY, "remittance {} ended on TTL {}", id, ttl);
        }
    });
}

/// A page never exceeds `TTL_EXTEND_MAX_PAGE`, whatever is asked for, and a
/// `limit` of 0 still makes progress rather than looping for ever.
#[test]
fn test_1827_page_size_is_capped_and_always_progresses() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent) = setup(&env);
    create_remittances(&contract, &sender, &agent, 3);

    // Asking for more than the cap is clamped, not refused.
    let next = contract.extend_storage_ttl_page(&admin, &EXTEND_BY, &1, &(TTL_EXTEND_MAX_PAGE * 10));
    assert_eq!(next, 0, "3 records fit inside one capped page");

    // A limit of 0 advances by one record instead of standing still.
    let next = contract.extend_storage_ttl_page(&admin, &EXTEND_BY, &1, &0);
    assert_eq!(next, 2);

    // Starting past the end is a no-op, not a panic.
    let next = contract.extend_storage_ttl_page(&admin, &EXTEND_BY, &99, &10);
    assert_eq!(next, 0);
}

/// A page leaves the records outside it alone — that is what makes it a page.
#[test]
fn test_1827_a_page_does_not_touch_the_next_page() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, agent) = setup(&env);
    create_remittances(&contract, &sender, &agent, 4);

    let before =
        env.as_contract(&contract.address, || remittance_ttl(&env, 4).expect("exists"));
    contract.extend_storage_ttl_page(&admin, &EXTEND_BY, &1, &2);
    let after = env.as_contract(&contract.address, || remittance_ttl(&env, 4).expect("exists"));

    assert_eq!(before, after, "remittance 4 is on the second page");
    assert!(after < EXTEND_BY, "it should not have been extended yet");
}

/// The agent registry grows without bound too, so it pages on its own index.
#[test]
fn test_1827_agent_registry_pages_on_its_own_index() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, _sender, _agent) = setup(&env);
    contract.register_agent(&Address::generate(&env), &None);
    contract.register_agent(&Address::generate(&env), &None);

    // setup() registered one agent, so there are three.
    let next = contract.extend_agent_storage_ttl_page(&admin, &EXTEND_BY, &0, &2);
    assert_eq!(next, 2, "a page of 2 from offset 0 resumes at 2");

    let next = contract.extend_agent_storage_ttl_page(&admin, &EXTEND_BY, &next, &2);
    assert_eq!(next, 0, "the last page reports the end of the list");

    let next = contract.extend_agent_storage_ttl_page(&admin, &EXTEND_BY, &99, &2);
    assert_eq!(next, 0, "an offset past the end is a no-op");
}

// ── #1828 ────────────────────────────────────────────────────────────────────

/// An archived `Escrow(id)` makes `release_escrow` and `refund_escrow` fail with
/// the funds already locked in the contract, so a pending escrow has to survive
/// the sweep.
#[test]
fn test_1828_sweep_extends_pending_escrows() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, _agent) = setup(&env);
    let recipient = Address::generate(&env);
    contract.update_escrow_ttl(&ESCROW_TTL_SECONDS);

    let id = contract.create_escrow(&sender, &recipient, &500, &None);

    let before = env.as_contract(&contract.address, || escrow_ttl(&env, id).expect("exists"));
    assert!(before < EXTEND_BY, "a fresh escrow is on the default TTL");

    contract.extend_storage_ttl(&admin, &EXTEND_BY);

    let after = env.as_contract(&contract.address, || escrow_ttl(&env, id).expect("exists"));
    assert!(
        after >= EXTEND_BY,
        "escrow {} was left on a TTL of {} while still holding funds",
        id,
        after
    );
}

/// The paged sweep extends escrows in its own ID window as well.
#[test]
fn test_1828_paged_sweep_extends_pending_escrows() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, admin, sender, _agent) = setup(&env);
    let recipient = Address::generate(&env);
    contract.update_escrow_ttl(&ESCROW_TTL_SECONDS);

    let id = contract.create_escrow(&sender, &recipient, &500, &None);
    contract.extend_storage_ttl_page(&admin, &EXTEND_BY, &1, &10);

    let ttl = env.as_contract(&contract.address, || escrow_ttl(&env, id).expect("exists"));
    assert!(ttl >= EXTEND_BY, "escrow {} ended on TTL {}", id, ttl);
}

// ── #1829 ────────────────────────────────────────────────────────────────────

/// At exactly `now == expiry` the sender could reclaim by hand while the batch
/// processor walked past the escrow. Both paths now read the same helper, so
/// both act at the boundary.
#[test]
fn test_1829_expiry_boundary_is_inclusive_for_both_paths() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, sender, _agent) = setup(&env);
    let recipient = Address::generate(&env);
    contract.update_escrow_ttl(&ESCROW_TTL_SECONDS);

    let batched = contract.create_escrow(&sender, &recipient, &500, &None);
    let manual = contract.create_escrow(&sender, &recipient, &500, &None);

    let expiry = contract
        .get_escrow(&batched)
        .expiry
        .expect("a configured TTL gives the escrow an expiry");

    // Sit exactly on the boundary: not past it, on it.
    env.ledger().with_mut(|l| l.timestamp = expiry);

    let processed = contract.process_expired_escrows(&Vec::from_array(&env, [batched]));
    assert_eq!(
        processed,
        Vec::from_array(&env, [batched]),
        "the batch processor must refund at now == expiry, as the manual path does"
    );
    assert_eq!(contract.get_escrow(&batched).status, EscrowStatus::Refunded);

    contract.refund_escrow(&manual);
    assert_eq!(contract.get_escrow(&manual).status, EscrowStatus::Refunded);
}

/// One second before expiry neither path may act.
#[test]
fn test_1829_neither_path_acts_before_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, sender, _agent) = setup(&env);
    let recipient = Address::generate(&env);
    contract.update_escrow_ttl(&ESCROW_TTL_SECONDS);

    let id = contract.create_escrow(&sender, &recipient, &500, &None);
    let expiry = contract.get_escrow(&id).expiry.expect("has an expiry");

    env.ledger().with_mut(|l| l.timestamp = expiry - 1);

    let processed = contract.process_expired_escrows(&Vec::from_array(&env, [id]));
    assert_eq!(processed.len(), 0, "not expired yet");
    assert!(
        contract.try_refund_escrow(&id).is_err(),
        "the manual path must refuse before expiry too"
    );
    assert_eq!(contract.get_escrow(&id).status, EscrowStatus::Pending);
}

/// An escrow with no expiry is a permanent lock: time never releases it.
#[test]
fn test_1829_an_escrow_without_expiry_never_expires_by_time() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token, _admin, sender, _agent) = setup(&env);
    let recipient = Address::generate(&env);
    contract.update_escrow_ttl(&0);

    let id = contract.create_escrow(&sender, &recipient, &500, &None);
    assert!(contract.get_escrow(&id).expiry.is_none());

    env.ledger().with_mut(|l| l.timestamp += 10_000_000);

    let processed = contract.process_expired_escrows(&Vec::from_array(&env, [id]));
    assert_eq!(processed.len(), 0, "no expiry means no time-based refund");
    assert!(contract.try_refund_escrow(&id).is_err());
    assert_eq!(contract.get_escrow(&id).status, EscrowStatus::Pending);
}
