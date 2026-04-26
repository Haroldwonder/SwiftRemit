#![cfg(test)]
use crate::{SwiftRemitContract, SwiftRemitContractClient, EscrowStatus};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events},
    token, Address, BytesN, Env, IntoVal, Symbol, TryFromVal,
};

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
    contract.update_escrow_ttl(&admin, &86400);

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
    contract.update_escrow_ttl(&admin, &1);

    let transfer_id = contract.create_escrow(&sender, &recipient, &500);
    env.ledger().set(soroban_sdk::testutils::LedgerInfo { timestamp: env.ledger().timestamp() + 2, ..env.ledger().get() });

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

    let events = env.events().all();
    let create_event = events.iter().find(|e| {
        let topic0 = e.1.get(0).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        let topic1 = e.1.get(1).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        topic0 == Some(Symbol::new(&env, "escrow"))
            && topic1 == Some(Symbol::new(&env, "created"))
    });
    assert!(create_event.is_some());

    contract.release_escrow(&transfer_id);

    let events = env.events().all();
    let release_event = events.iter().find(|e| {
        let topic0 = e.1.get(0).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        let topic1 = e.1.get(1).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        topic0 == Some(Symbol::new(&env, "escrow"))
            && topic1 == Some(Symbol::new(&env, "released"))
    });
    assert!(release_event.is_some());
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

    let stats = contract.get_agent_stats(&escrow.agent);
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
    };
    crate::storage::set_agent_stats(&env, &agent, &stats);

    let reputation = contract.get_agent_reputation(&agent);
    assert_eq!(reputation, 79);
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
        settlement_config: None,
        token: addr_a.clone(), // placeholder
        created_at: 0,
        failed_at: None,
        dispute_evidence: None,
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
        settlement_config: None,
        token: addr_a.clone(), // placeholder
        created_at: 0,
        failed_at: None,
        dispute_evidence: None,
    });

    let net_transfers: Vec<NetTransfer> = compute_net_settlements(&env, &remittances);

    // Zero net position must be skipped — no transfer entry produced
    assert_eq!(
        net_transfers.len(),
        0,
        "zero-value net position must not produce a NetTransfer"
    );
}
