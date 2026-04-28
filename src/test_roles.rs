#![cfg(test)]

use crate::{SwiftRemitContract, SwiftRemitContractClient, Role};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    token::StellarAssetClient::new(env, &contract_id.address())
}

#[test]
fn test_role_assignment_by_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let settler = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc_token = create_token_contract(&env, &token_admin);

    // Initialize contract
    client.initialize(&admin, &usdc_token.address, &250, &0, &0, &admin);

    // Admin should have Admin role
    assert!(client.has_role(&admin, &Role::Admin));

    // Assign Settler role
    client.assign_role(&admin, &settler, &Role::Settler);
    assert!(client.has_role(&settler, &Role::Settler));

    // Remove Settler role
    client.remove_role(&admin, &settler, &Role::Settler);
    assert!(!client.has_role(&settler, &Role::Settler));
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_non_admin_cannot_assign_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let settler = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc_token = create_token_contract(&env, &token_admin);

    // Initialize contract
    client.initialize(&admin, &usdc_token.address, &250, &0, &0, &admin);

    // Non-admin tries to assign role - should panic
    client.assign_role(&non_admin, &settler, &Role::Settler);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_confirm_payout_requires_settler_role() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    let sender = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc_token = create_token_contract(&env, &token_admin);

    // Initialize contract
    client.initialize(&admin, &usdc_token.address, &250, &0, &0, &admin);

    // Register agent and then remove Settler role
    client.register_agent(&agent);
    client.remove_role(&admin, &agent, &Role::Settler);

    // Create remittance
    usdc_token.mint(&sender, &10000);
    let remittance_id = client.create_remittance(&sender, &agent, &1000, &None, &None, &None);

    // Agent tries to confirm payout without Settler role - should panic
    client.confirm_payout(&remittance_id, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_unregistered_agent_cannot_confirm_partial_payout() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    let sender = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc_token = create_token_contract(&env, &token_admin);

    client.initialize(&admin, &usdc_token.address, &250, &0, &0, &admin);
    client.register_agent(&agent);

    usdc_token.mint(&sender, &10000);
    let remittance_id = client.create_remittance(&sender, &agent, &1000, &None, &None, &None);

    // Remove agent authorization so the agent should no longer be able to confirm a partial payout.
    client.remove_agent(&agent);

    client.confirm_partial_payout(&remittance_id, &100);
}

#[test]
fn test_settler_can_finalize_transfers() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    let sender = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc_token = create_token_contract(&env, &token_admin);

    // Initialize contract
    client.initialize(&admin, &usdc_token.address, &250, &0, &0, &admin);

    // Register agent and assign Settler role
    client.register_agent(&agent);
    client.assign_role(&admin, &agent, &Role::Settler);

    // Verify agent has Settler role
    assert!(client.has_role(&agent, &Role::Settler));

    // Create remittance
    usdc_token.mint(&sender, &10000);
    let remittance_id = client.create_remittance(&sender, &agent, &1000, &None, &None, &None);

    // Agent with Settler role can confirm payout
    client.confirm_payout(&remittance_id, &None);
}

#[test]
fn test_role_persistence() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let settler = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc_token = create_token_contract(&env, &token_admin);

    // Initialize contract
    client.initialize(&admin, &usdc_token.address, &250, &0, &0, &admin);

    // Assign Settler role
    client.assign_role(&admin, &settler, &Role::Settler);

    // Check role persists across multiple calls
    assert!(client.has_role(&settler, &Role::Settler));
    assert!(client.has_role(&settler, &Role::Settler));
    assert!(client.has_role(&settler, &Role::Settler));
}
