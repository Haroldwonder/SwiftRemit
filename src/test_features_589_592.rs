//! Tests for #589 (multi-currency), #590 (batch), #591 (reputation), #592 (dispute).
#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, Ledger, LedgerInfo}, token, Address, BytesN, Env};
use crate::{ContractError, SwiftRemitContract, SwiftRemitContractClient};

fn make_token(env: &Env, admin: &Address) -> token::StellarAssetClient<'static> {
    let addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    token::StellarAssetClient::new(env, &addr)
}
fn bal(env: &Env, tok: &token::StellarAssetClient, addr: &Address) -> i128 {
    token::Client::new(env, &tok.address).balance(addr)
}
fn make_contract(env: &Env) -> SwiftRemitContractClient<'static> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

struct F<'a> {
    env: Env,
    c: SwiftRemitContractClient<'a>,
    tok: token::StellarAssetClient<'a>,
    admin: Address,
    sender: Address,
    agent: Address,
}

fn setup() -> F<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let tok = make_token(&env, &admin);
    tok.mint(&sender, &100_000);
    let c = make_contract(&env);
    c.initialize(&admin, &tok.address, &250u32, &0u64, &0u32, &admin);
    c.register_agent(&agent, &None);
    F { env, c, tok, admin, sender, agent }
}

fn remit(f: &F, amount: i128) -> u64 {
    f.c.create_remittance(&f.sender, &f.agent, &amount, &None, &None, &None, &None, &None)
}

// ── #589 Multi-currency ───────────────────────────────────────────────────────

#[test] fn test_589_whitelist_token() {
    let f = setup();
    let t2 = make_token(&f.env, &f.admin);
    f.c.add_whitelisted_token(&t2.address);
    assert!(f.c.is_token_whitelisted(&t2.address));
}

#[test] fn test_589_create_with_second_token() {
    let f = setup();
    let t2 = make_token(&f.env, &f.admin);
    t2.mint(&f.sender, &5_000);
    f.c.add_whitelisted_token(&t2.address);
    let id = f.c.create_remittance(&f.sender, &f.agent, &1_000, &None, &Some(t2.address.clone()), &None, &None, &None);
    assert_eq!(f.c.get_remittance(&id).token, t2.address);
}

#[test] fn test_589_unwhitelisted_token_rejected() {
    let f = setup();
    let bad = make_token(&f.env, &f.admin);
    let r = f.c.try_create_remittance(&f.sender, &f.agent, &1_000, &None, &Some(bad.address.clone()), &None, &None, &None);
    assert_eq!(r, Err(Ok(ContractError::TokenNotWhitelisted)));
}

#[test] fn test_589_per_token_fee() {
    let f = setup();
    let t2 = make_token(&f.env, &f.admin);
    f.c.add_whitelisted_token(&t2.address);
    f.c.update_token_fee(&f.admin, &t2.address, &500u32);
    assert_eq!(f.c.get_token_fee_bps(&t2.address), Some(500u32));
}

// ── #590 Batch remittance ─────────────────────────────────────────────────────

#[test] fn test_590_create_batch_remittance() {
    let f = setup();
    let entries = soroban_sdk::vec![&f.env,
        crate::BatchCreateEntry { agent: f.agent.clone(), amount: 500, expiry: None },
        crate::BatchCreateEntry { agent: f.agent.clone(), amount: 300, expiry: None },
    ];
    let ids = f.c.create_batch_remittance(&f.sender, &entries);
    assert_eq!(ids.len(), 2);
    assert_eq!(f.c.get_remittance(&ids.get(0).unwrap()).status, crate::RemittanceStatus::Pending);
}

#[test] fn test_590_create_batch_empty_rejected() {
    let f = setup();
    let entries: soroban_sdk::Vec<crate::BatchCreateEntry> = soroban_sdk::vec![&f.env];
    assert_eq!(f.c.try_create_batch_remittance(&f.sender, &entries), Err(Ok(ContractError::InvalidBatchSize)));
}

#[test] fn test_590_confirm_batch_payout() {
    let f = setup();
    let entries = soroban_sdk::vec![&f.env,
        crate::BatchCreateEntry { agent: f.agent.clone(), amount: 500, expiry: None },
        crate::BatchCreateEntry { agent: f.agent.clone(), amount: 300, expiry: None },
    ];
    let ids = f.c.create_batch_remittance(&f.sender, &entries);
    let before = bal(&f.env, &f.tok, &f.agent);
    f.c.confirm_batch_payout(&ids);
    assert!(bal(&f.env, &f.tok, &f.agent) > before);
    assert_eq!(f.c.get_remittance(&ids.get(0).unwrap()).status, crate::RemittanceStatus::Completed);
    assert_eq!(f.c.get_remittance(&ids.get(1).unwrap()).status, crate::RemittanceStatus::Completed);
}

// ── #591 Agent reputation ─────────────────────────────────────────────────────

#[test] fn test_591_new_agent_max_reputation() {
    let f = setup();
    assert_eq!(f.c.get_agent_reputation(&f.agent), 100);
}

#[test] fn test_591_reputation_after_payout() {
    let f = setup();
    let id = remit(&f, 1_000);
    f.c.confirm_payout(&id, &None, &None);
    assert!(f.c.get_agent_reputation(&f.agent) > 0);
}

#[test] fn test_591_set_min_reputation() {
    let f = setup();
    f.c.set_min_agent_reputation(&50u32);
    assert_eq!(f.c.get_min_agent_reputation(), 50u32);
}

#[test] fn test_591_min_reputation_allows_good_agent() {
    let f = setup();
    f.c.set_min_agent_reputation(&50u32);
    // New agent has reputation 100, should pass
    let r = f.c.try_create_remittance(&f.sender, &f.agent, &1_000, &None, &None, &None, &None, &None);
    assert!(r.is_ok());
}

// ── #592 Dispute resolution ───────────────────────────────────────────────────

fn evidence(env: &Env) -> BytesN<32> { BytesN::from_array(env, &[0xABu8; 32]) }

#[test] fn test_592_mark_failed() {
    let f = setup();
    let id = remit(&f, 1_000);
    f.c.mark_failed(&id);
    assert_eq!(f.c.get_remittance(&id).status, crate::RemittanceStatus::Failed);
}

#[test] fn test_592_raise_dispute() {
    let f = setup();
    let id = remit(&f, 1_000);
    f.c.mark_failed(&id);
    f.c.raise_dispute(&id, &evidence(&f.env));
    assert_eq!(f.c.get_remittance(&id).status, crate::RemittanceStatus::Disputed);
}

#[test] fn test_592_raise_dispute_on_pending_rejected() {
    let f = setup();
    let id = remit(&f, 1_000);
    assert_eq!(f.c.try_raise_dispute(&id, &evidence(&f.env)), Err(Ok(ContractError::InvalidStatus)));
}

#[test] fn test_592_resolve_sender_wins() {
    let f = setup();
    let id = remit(&f, 1_000);
    let before = bal(&f.env, &f.tok, &f.sender);
    f.c.mark_failed(&id);
    f.c.raise_dispute(&id, &evidence(&f.env));
    f.c.resolve_dispute(&id, &true);
    assert_eq!(f.c.get_remittance(&id).status, crate::RemittanceStatus::Cancelled);
    assert_eq!(bal(&f.env, &f.tok, &f.sender) - before, 1_000);
}

#[test] fn test_592_resolve_agent_wins() {
    let f = setup();
    let id = remit(&f, 1_000);
    let before = bal(&f.env, &f.tok, &f.agent);
    f.c.mark_failed(&id);
    f.c.raise_dispute(&id, &evidence(&f.env));
    f.c.resolve_dispute(&id, &false);
    assert_eq!(f.c.get_remittance(&id).status, crate::RemittanceStatus::Completed);
    assert_eq!(bal(&f.env, &f.tok, &f.agent) - before, 975); // 1000 - 2.5% fee
}

#[test] fn test_592_resolve_non_disputed_rejected() {
    let f = setup();
    let id = remit(&f, 1_000);
    f.c.mark_failed(&id);
    assert_eq!(f.c.try_resolve_dispute(&id, &true), Err(Ok(ContractError::NotDisputed)));
}

#[test] fn test_592_dispute_window_expiry() {
    let f = setup();
    let id = remit(&f, 1_000);
    f.c.mark_failed(&id);
    let info = f.env.ledger().get();
    f.env.ledger().set(LedgerInfo { timestamp: info.timestamp + 72 * 3600 + 1, ..info });
    assert_eq!(f.c.try_raise_dispute(&id, &evidence(&f.env)), Err(Ok(ContractError::DisputeWindowExpired)));
}

#[test] fn test_592_balance_invariant() {
    let f = setup();
    let id = remit(&f, 1_000);
    let total_before = bal(&f.env, &f.tok, &f.sender) + bal(&f.env, &f.tok, &f.agent) + bal(&f.env, &f.tok, &f.c.address);
    f.c.mark_failed(&id);
    f.c.raise_dispute(&id, &evidence(&f.env));
    f.c.resolve_dispute(&id, &true);
    let total_after = bal(&f.env, &f.tok, &f.sender) + bal(&f.env, &f.tok, &f.agent) + bal(&f.env, &f.tok, &f.c.address);
    assert_eq!(total_before, total_after);
}
