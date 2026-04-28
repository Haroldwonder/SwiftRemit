#![cfg(test)]

use crate::{ContractError, FeeStrategy, FeeCorridor, SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

fn setup<'a>(env: &'a Env) -> (SwiftRemitContractClient<'a>, Address, token::StellarAssetClient<'a>) {
    let admin = Address::generate(env);
    let token_client = token::StellarAssetClient::new(
        env,
        &env.register_stellar_asset_contract_v2(admin.clone()).address(),
    );
    let contract = SwiftRemitContractClient::new(
        env,
        &env.register_contract(None, SwiftRemitContract {}),
    );
    contract.initialize(&admin, &token_client.address, &250, &0, &0, &admin);
    (contract, admin, token_client)
}

fn s(env: &Env, val: &str) -> String {
    String::from_str(env, val)
}

// ── CRUD Tests ─────────────────────────────────────────────────────

#[test]
fn test_set_and_get_fee_corridor() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, admin, _) = setup(&env);

    let corridor = FeeCorridor {
        from_country: s(&env, "US"),
        to_country: s(&env, "MX"),
        strategy: FeeStrategy::Percentage(300),
        protocol_fee_bps: None,
    };

    contract.set_fee_corridor(&admin, &corridor);

    let stored = contract.get_fee_corridor(&s(&env, "US"), &s(&env, "MX"));
    assert_eq!(stored, Some(corridor));
}

#[test]
fn test_get_fee_corridor_returns_none_when_not_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, _, _) = setup(&env);

    let result = contract.get_fee_corridor(&s(&env, "US"), &s(&env, "MX"));
    assert_eq!(result, None);
}

#[test]
fn test_remove_fee_corridor() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, admin, _) = setup(&env);

    let corridor = FeeCorridor {
        from_country: s(&env, "US"),
        to_country: s(&env, "MX"),
        strategy: FeeStrategy::Percentage(300),
        protocol_fee_bps: None,
    };

    contract.set_fee_corridor(&admin, &corridor);
    assert!(contract.get_fee_corridor(&s(&env, "US"), &s(&env, "MX")).is_some());

    contract.remove_fee_corridor(&admin, &s(&env, "US"), &s(&env, "MX"));
    assert_eq!(contract.get_fee_corridor(&s(&env, "US"), &s(&env, "MX")), None);
}

#[test]
fn test_set_fee_corridor_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, _, _) = setup(&env);
    let non_admin = Address::generate(&env);

    let corridor = FeeCorridor {
        from_country: s(&env, "US"),
        to_country: s(&env, "MX"),
        strategy: FeeStrategy::Percentage(300),
        protocol_fee_bps: None,
    };

    let result = contract.try_set_fee_corridor(&non_admin, &corridor);
    assert!(result.is_err());
}

#[test]
fn test_corridors_are_independent() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, admin, _) = setup(&env);

    let us_mx = FeeCorridor {
        from_country: s(&env, "US"),
        to_country: s(&env, "MX"),
        strategy: FeeStrategy::Percentage(300),
        protocol_fee_bps: None,
    };
    let gb_ng = FeeCorridor {
        from_country: s(&env, "GB"),
        to_country: s(&env, "NG"),
        strategy: FeeStrategy::Flat(500),
        protocol_fee_bps: Some(50),
    };

    contract.set_fee_corridor(&admin, &us_mx);
    contract.set_fee_corridor(&admin, &gb_ng);

    assert_eq!(
        contract.get_fee_corridor(&s(&env, "US"), &s(&env, "MX")).unwrap().strategy,
        FeeStrategy::Percentage(300)
    );
    assert_eq!(
        contract.get_fee_corridor(&s(&env, "GB"), &s(&env, "NG")).unwrap().strategy,
        FeeStrategy::Flat(500)
    );
}

// ── Fee Calculation Tests ──────────────────────────────────────────

#[test]
fn test_create_remittance_uses_corridor_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, admin, token) = setup(&env);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    token.mint(&sender, &100_000);
    contract.register_agent(&agent);

    // Global strategy: 2.5% (250 bps), corridor: 5% (500 bps)
    let corridor = FeeCorridor {
        from_country: s(&env, "US"),
        to_country: s(&env, "MX"),
        strategy: FeeStrategy::Percentage(500),
        protocol_fee_bps: None,
    };
    contract.set_fee_corridor(&admin, &corridor);

    let id = contract.create_remittance_with_corridor(
        &sender, &agent, &10_000, &None,
        &Some(s(&env, "US")), &Some(s(&env, "MX")),
    );
    // Corridor fee: 5% of 10_000 = 500
    assert_eq!(contract.get_remittance(&id).fee, 500);
}

#[test]
fn test_create_remittance_falls_back_to_global_fee_without_corridor() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, _, token) = setup(&env);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    token.mint(&sender, &100_000);
    contract.register_agent(&agent);

    // No corridor set, global strategy: 2.5%
    let id = contract.create_remittance_with_corridor(
        &sender, &agent, &10_000, &None, &None, &None,
    );
    // Global fee: 2.5% of 10_000 = 250
    assert_eq!(contract.get_remittance(&id).fee, 250);
}

#[test]
fn test_create_remittance_falls_back_when_corridor_not_configured() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, _, token) = setup(&env);

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    token.mint(&sender, &100_000);
    contract.register_agent(&agent);

    // Pass country codes but no corridor stored for this pair
    let id = contract.create_remittance_with_corridor(
        &sender, &agent, &10_000, &None,
        &Some(s(&env, "US")), &Some(s(&env, "NG")),
    );
    // Falls back to global 2.5%
    assert_eq!(contract.get_remittance(&id).fee, 250);
}
