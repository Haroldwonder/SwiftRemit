#![cfg(test)]

use crate::{ContractError, SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

fn setup<'a>(env: &'a Env) -> (SwiftRemitContractClient<'a>, token::StellarAssetClient<'a>) {
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
    (contract, token_client)
}

/// #1263: withdraw_integrator_fees now uses per-integrator balance.
#[test]
fn test_withdraw_integrator_fees_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, token) = setup(&env);
    let integrator = Address::generate(&env);
    let to = Address::generate(&env);

    // Seed the per-integrator balance directly (mirrors what confirm_payout does).
    token.mint(&contract.address, &500);
    env.as_contract(&contract.address, || {
        crate::storage::add_integrator_balance(&env, &integrator, 500);
    });

    contract.withdraw_integrator_fees(&integrator, &to);

    // Balance should be cleared after withdrawal.
    env.as_contract(&contract.address, || {
        assert_eq!(crate::storage::get_integrator_balance(&env, &integrator), 0);
    });
    assert_eq!(token::Client::new(&env, &token.address).balance(&to), 500);
}

/// #1622: the platform and integrator shares of a remittance fee must sum to
/// exactly `remittance.fee`, and the contract must stay solvent: its token
/// balance must cover escrow liabilities plus all withdrawable fees.
#[test]
fn test_integrator_share_not_double_counted() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, token) = setup(&env);
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let integrator = Address::generate(&env);
    contract.register_agent(&agent, &None);
    token.mint(&sender, &10_000);

    let amount = 10_000i128;
    let id = contract.create_remittance(
        &sender,
        &agent,
        &amount,
        &None,
        &None,
        &None,
        &None,
        &None,
        &Some(integrator.clone()),
    );

    let remittance = env.as_contract(&contract.address, || {
        crate::storage::get_remittance(&env, id).unwrap()
    });
    let fee = remittance.fee;
    let integrator_share = fee / 10;
    let platform_share = fee - integrator_share;

    contract.confirm_payout(&agent, &id, &None, &None);

    let (accumulated, integrator_balance) = env.as_contract(&contract.address, || {
        (
            crate::storage::get_accumulated_fees_for_token(&env, &token.address),
            crate::storage::get_integrator_balance_for_token(&env, &integrator, &token.address),
        )
    });

    assert_eq!(integrator_balance, integrator_share);
    assert_eq!(accumulated, platform_share);
    assert_eq!(accumulated + integrator_balance, fee);

    // Solvency: no escrow liabilities remain, and the contract holds at least
    // every withdrawable fee.
    let contract_balance = token::Client::new(&env, &token.address).balance(&contract.address);
    assert!(contract_balance >= accumulated + integrator_balance);
}

/// #1672: withdrawing to the contract's own address must be rejected and leave
/// the integrator balance untouched.
#[test]
fn test_withdraw_integrator_fees_to_contract_address_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, token) = setup(&env);
    let integrator = Address::generate(&env);

    token.mint(&contract.address, &500);
    env.as_contract(&contract.address, || {
        crate::storage::add_integrator_balance(&env, &integrator, 500);
    });

    let result = contract.try_withdraw_integrator_fees(&integrator, &contract.address);
    assert_eq!(result, Err(Ok(ContractError::InvalidAddress)));

    // Balance must be unchanged and tokens must remain in the contract.
    env.as_contract(&contract.address, || {
        assert_eq!(crate::storage::get_integrator_balance(&env, &integrator), 500);
    });
    assert_eq!(
        token::Client::new(&env, &token.address).balance(&contract.address),
        500
    );
}

#[test]
fn test_withdraw_integrator_fees_no_fees_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token) = setup(&env);
    let integrator = Address::generate(&env);
    let to = Address::generate(&env);

    let result = contract.try_withdraw_integrator_fees(&integrator, &to);
    assert_eq!(result, Err(Ok(ContractError::NoFeesToWithdraw)));
}

/// #1263: Different integrators have independent balances — one cannot drain another.
#[test]
fn test_integrator_balances_are_isolated() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});
    let integrator_a = Address::generate(&env);
    let integrator_b = Address::generate(&env);

    env.as_contract(&contract_id, || {
        crate::storage::add_integrator_balance(&env, &integrator_a, 300);
        crate::storage::add_integrator_balance(&env, &integrator_b, 700);

        assert_eq!(crate::storage::get_integrator_balance(&env, &integrator_a), 300);
        assert_eq!(crate::storage::get_integrator_balance(&env, &integrator_b), 700);

        crate::storage::clear_integrator_balance(&env, &integrator_a);
        // B's balance is unaffected.
        assert_eq!(crate::storage::get_integrator_balance(&env, &integrator_a), 0);
        assert_eq!(crate::storage::get_integrator_balance(&env, &integrator_b), 700);
    });
}

#[test]
fn test_get_accumulated_integrator_fees_default_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract, _token) = setup(&env);
    // Global counter still returns 0 (no accrual without integrator-linked remittances).
    assert_eq!(contract.get_accumulated_integrator_fees(), 0);
}

#[test]
fn test_set_and_get_accumulated_integrator_fees() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    env.as_contract(&contract_id, || {
        // Legacy global counter still works (kept for backward compat).
        crate::storage::set_accumulated_integrator_fees(&env, 1234);
        assert_eq!(crate::storage::get_accumulated_integrator_fees(&env), 1234);

        crate::storage::set_accumulated_integrator_fees(&env, 0);
        assert_eq!(crate::storage::get_accumulated_integrator_fees(&env), 0);
    });
}
