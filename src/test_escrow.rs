#![cfg(test)]
extern crate std;
use crate::{SwiftRemitContract, SwiftRemitContractClient, EscrowStatus};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events, Ledger as _},
    token, Address, BytesN, Env, IntoVal, Symbol, Vec,
};

fn has_event(env: &Env, t0: &str, t1: &str) -> bool {
    use soroban_sdk::xdr::{ContractEventBody, ScVal, ScSymbol, StringM};
    let sym0 = ScVal::Symbol(ScSymbol(StringM::try_from(t0).unwrap()));
    let sym1 = ScVal::Symbol(ScSymbol(StringM::try_from(t1).unwrap()));
    env.events().all().events().iter().any(|e| {
        if let ContractEventBody::V0(body) = &e.body {
            body.topics.len() >= 2 && body.topics[0] == sym0 && body.topics[1] == sym1
        } else {
            false
        }
    })
}

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    token::StellarAssetClient::new(env, &env.register_stellar_asset_contract_v2(admin.clone()).address())
}

fn create_swiftremit_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

fn token_balance(token: &token::StellarAssetClient, address: &Address) -> i128 {
    token::Client::new(&token.env, &token.address).balance(address)
}

#[test]
fn test_create_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);

    assert_eq!(transfer_id, 1);
    assert_eq!(token_balance(&token, &sender), 500);
    assert_eq!(token_balance(&token, &contract.address), 500);

    let escrow = contract.get_escrow(&transfer_id);
    assert_eq!(escrow.sender, sender);
    assert_eq!(escrow.recipient, recipient);
    assert_eq!(escrow.amount, 500);
    assert_eq!(escrow.status, EscrowStatus::Pending);
}

#[test]
fn test_create_escrow_sets_expiry_from_ttl() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);
    contract.update_escrow_ttl(&86400);

    let before = env.ledger().timestamp();
    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    let escrow = contract.get_escrow(&transfer_id);

    assert_eq!(escrow.expiry, Some(before + 86400));
}

#[test]
fn test_process_expired_escrows_refunds_ttl_expired() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);
    contract.update_escrow_ttl(&1);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    env.ledger().with_mut(|li| li.timestamp += 2);

    let mut ids = Vec::new(&env);
    ids.push_back(transfer_id);
    let processed = contract.process_expired_escrows(&ids);

    assert_eq!(processed.len(), 1);
    assert_eq!(processed.get_unchecked(0), transfer_id);
    assert_eq!(contract.get_escrow(&transfer_id).status, EscrowStatus::Refunded);
    assert_eq!(token_balance(&token, &sender), 1000);
}

#[test]
fn test_release_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    contract.release_escrow(&transfer_id);

    let escrow = contract.get_escrow(&transfer_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(token_balance(&token, &recipient), 500);
    assert_eq!(token_balance(&token, &contract.address), 0);
}

#[test]
fn test_refund_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    contract.refund_escrow(&transfer_id);

    let escrow = contract.get_escrow(&transfer_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);
    assert_eq!(token_balance(&token, &sender), 1000);
    assert_eq!(token_balance(&token, &contract.address), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_double_release_prevented() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    contract.release_escrow(&transfer_id);
    contract.release_escrow(&transfer_id); // Should panic
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_double_refund_prevented() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    contract.refund_escrow(&transfer_id);
    contract.refund_escrow(&transfer_id); // Should panic
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_create_escrow_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    contract.create_escrow(&sender, &recipient, &0);
}

#[test]
fn test_escrow_events_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);

    assert!(has_event(&env, "escrow", "created"), "escrow created event not emitted");

    contract.release_escrow(&transfer_id);

    assert!(has_event(&env, "escrow", "released"), "escrow released event not emitted");
}

#[test]
fn test_raise_dispute_increments_agent_dispute_count() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    let escrow = contract.get_escrow(&transfer_id);

    contract.mark_failed(&transfer_id);
    let evidence = BytesN::from_array(&env, &[0u8; 32]);
    contract.raise_dispute(&transfer_id, &evidence);

    let stats = contract.get_agent_stats(&escrow.recipient);
    assert_eq!(stats.dispute_count, 1);
}

#[test]
fn test_get_agent_reputation_calculates_score() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&admin, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let stats = crate::AgentStats {
        total_settlements: 10,
        failed_settlements: 2,
        total_settlement_time: 7200 * 10,
        dispute_count: 1,
        success_rate_bps: 8000,
        last_active_timestamp: 0,
    };
    crate::storage::set_agent_stats(&env, &agent, &stats);

    let reputation = contract.get_agent_reputation(&agent);
    assert_eq!(reputation, 79);
}

// ── Issue #1673: recovery of remittances stuck in Processing ─────────────────

#[test]
fn test_recover_processing_escrow_refunds_remainder() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);

    // Simulate a partial payout: move the escrow into Processing with a
    // recorded disbursed amount, leaving an undisbursed remainder.
    let disbursed: i128 = 200;
    let mut escrow = contract.get_escrow(&transfer_id);
    escrow.status = EscrowStatus::Processing;
    escrow.disbursed_amount = disbursed;
    crate::storage::set_escrow(&env, &transfer_id, &escrow);

    // Advance past the recovery timeout.
    env.ledger().with_mut(|li| li.timestamp += 86400 * 2);

    contract.recover_processing_escrow(&sender, &transfer_id);

    let escrow = contract.get_escrow(&transfer_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);
    assert_eq!(token_balance(&token, &sender), 1000 - disbursed);
    assert_eq!(token_balance(&token, &contract.address), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #40)")]
fn test_recover_processing_escrow_too_early() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);

    let mut escrow = contract.get_escrow(&transfer_id);
    escrow.status = EscrowStatus::Processing;
    escrow.disbursed_amount = 200;
    crate::storage::set_escrow(&env, &transfer_id, &escrow);

    // No time has elapsed — recovery must be rejected.
    contract.recover_processing_escrow(&sender, &transfer_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_recover_processing_escrow_non_sender_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let attacker = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);

    let mut escrow = contract.get_escrow(&transfer_id);
    escrow.status = EscrowStatus::Processing;
    escrow.disbursed_amount = 200;
    crate::storage::set_escrow(&env, &transfer_id, &escrow);

    env.ledger().with_mut(|li| li.timestamp += 86400 * 2);

    // Only the original sender may recover the remainder.
    contract.recover_processing_escrow(&attacker, &transfer_id);
}

// ── Issue #421: zero-value net positions must not produce a transfer ──────────

#[test]
fn test_zero_net_position_produces_no_transfer() {
    // When two remittances between the same agent pair cancel each other out,
    // compute_net_settlements must return an empty vector — no zero-value
    // token transfer should be attempted.
    use crate::netting::{compute_net_settlements, NetTransfer};
    use crate::{Remittance, RemittanceStatus};
    use soroban_sdk::{testutils::Address as _, Env, Vec};

    let env = Env::default();
    let addr_a = Address::generate(&env);
    let addr_b = Address::generate(&env);

    let mut remittances: Vec<Remittance> = Vec::new(&env);

    // A -> B: 100
    remittances.push_back(Remittance {
        id: 1,
        sender: addr_a.clone(),
        agent: addr_b.clone(),
        amount: 100,
        fee: 2,
        status: RemittanceStatus::Pending,
        expiry: None,
        settlement_config: crate::MaybeSettlementConfig::None,
        token: addr_a.clone(), // placeholder
        created_at: 0,
        failed_at: None,
        dispute_evidence: crate::MaybeBytes32::None,
        expires_at: None,
    });

    // B -> A: 100 (exact mirror — net is zero)
    remittances.push_back(Remittance {
        id: 2,
        sender: addr_b.clone(),
        agent: addr_a.clone(),
        amount: 100,
        fee: 2,
        status: RemittanceStatus::Pending,
        expiry: None,
        settlement_config: crate::MaybeSettlementConfig::None,
        token: addr_a.clone(), // placeholder
        created_at: 0,
        failed_at: None,
        dispute_evidence: crate::MaybeBytes32::None,
        expires_at: None,
    });

    let net_transfers: Vec<NetTransfer> = compute_net_settlements(&env, &remittances).unwrap().net_transfers;

    // Zero net position must be skipped — no transfer entry produced
    assert_eq!(
        net_transfers.len(),
        0,
        "zero-value net position must not produce a NetTransfer"
    );
}

// ── Issue #1844: whitelisted tokens other than USDC in escrow ────────────────

#[test]
fn test_escrow_lifecycle_with_non_usdc_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let usdc = create_token_contract(&env, &admin);
    let eurc = create_token_contract(&env, &admin);
    eurc.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc.address, &250, &3600, &0, &admin);
    contract.add_token_to_whitelist(&eurc.address);

    // Create in EURC.
    let transfer_id = contract.create_escrow(&sender, &recipient, &500, &Some(eurc.address.clone()));
    let escrow = contract.get_escrow(&transfer_id);
    assert_eq!(escrow.token, eurc.address);
    assert_eq!(token_balance(&eurc, &sender), 500);
    assert_eq!(token_balance(&eurc, &contract.address), 500);
    assert_eq!(token_balance(&usdc, &contract.address), 0);

    // Release pays out in EURC.
    contract.release_escrow(&transfer_id);
    assert_eq!(contract.get_escrow(&transfer_id).status, EscrowStatus::Released);
    assert_eq!(token_balance(&eurc, &recipient), 500);
    assert_eq!(token_balance(&eurc, &contract.address), 0);

    // A second escrow refunds in EURC.
    let transfer_id2 = contract.create_escrow(&sender, &recipient, &200, &Some(eurc.address.clone()));
    contract.refund_escrow(&transfer_id2);
    assert_eq!(contract.get_escrow(&transfer_id2).status, EscrowStatus::Refunded);
    assert_eq!(token_balance(&eurc, &sender), 800);
    assert_eq!(token_balance(&eurc, &contract.address), 0);
}

#[test]
fn test_create_escrow_defaults_to_usdc() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let usdc = create_token_contract(&env, &admin);
    usdc.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500, &None);
    assert_eq!(contract.get_escrow(&transfer_id).token, usdc.address);
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")]
fn test_create_escrow_rejects_non_whitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let usdc = create_token_contract(&env, &admin);
    let rogue = create_token_contract(&env, &admin);
    rogue.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &usdc.address, &250, &3600, &0, &admin);

    contract.create_escrow(&sender, &recipient, &500, &Some(rogue.address.clone()));
}

// ── Issue #1845: paginated escrow views ──────────────────────────────────────

#[test]
fn test_get_escrows_by_sender_and_recipient_pagination() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let id1 = contract.create_escrow(&sender, &recipient, &100, &None);
    let id2 = contract.create_escrow(&sender, &recipient, &100, &None);
    let id3 = contract.create_escrow(&sender, &recipient, &100, &None);

    let by_sender = contract.get_escrows_by_sender(&sender, &0, &2);
    assert_eq!(by_sender.len(), 2);
    assert_eq!(by_sender.get_unchecked(0), id1);
    assert_eq!(by_sender.get_unchecked(1), id2);

    let by_sender_page2 = contract.get_escrows_by_sender(&sender, &2, &2);
    assert_eq!(by_sender_page2.len(), 1);
    assert_eq!(by_sender_page2.get_unchecked(0), id3);

    let by_recipient = contract.get_escrows_by_recipient(&recipient, &0, &10);
    assert_eq!(by_recipient.len(), 3);

    // Out-of-range offset yields an empty page.
    let empty = contract.get_escrows_by_sender(&sender, &10, &10);
    assert_eq!(empty.len(), 0);
}

#[test]
fn test_get_escrows_by_sender_caps_page_size() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &100_000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    for _ in 0..105 {
        contract.create_escrow(&sender, &recipient, &100, &None);
    }

    let page = contract.get_escrows_by_sender(&sender, &0, &1000);
    assert_eq!(page.len(), 100);
}

// ── Issue #1846: create_escrow compliance checks ────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_create_escrow_rejects_unverified_kyc() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);
    contract.set_kyc_required(&true);

    contract.create_escrow(&sender, &recipient, &500, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_create_escrow_rejects_daily_limit_exceeded() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);
    contract.set_daily_limit(&sender, &100);

    contract.create_escrow(&sender, &recipient, &500, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_create_escrow_rejects_rate_limit_exceeded() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);
    contract.set_rate_limit(&sender, &1, &3600);

    contract.create_escrow(&sender, &recipient, &100, &None);
    contract.create_escrow(&sender, &recipient, &100, &None);
}

// ── Issue #1847: release to a recipient blacklisted after creation ──────────

#[test]
fn test_release_escrow_rejects_recipient_blacklisted_after_creation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = create_token_contract(&env, &admin);
    token.mint(&sender, &1000);

    let contract = create_swiftremit_contract(&env);
    contract.initialize(&admin, &token.address, &250, &3600, &0, &admin);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500, &None);
    contract.blacklist_address(&recipient);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.release_escrow(&transfer_id);
    }));
    assert!(result.is_err(), "release to blacklisted recipient must fail");
    assert_eq!(contract.get_escrow(&transfer_id).status, EscrowStatus::Pending);

    // The sender can still reclaim via the normal refund path.
    contract.refund_escrow(&transfer_id);
    assert_eq!(contract.get_escrow(&transfer_id).status, EscrowStatus::Refunded);
    assert_eq!(token_balance(&token, &sender), 1000);
}
