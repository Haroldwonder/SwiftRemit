//! Tests for issue #1832 — `update_rate_limit_config` emits `config_updated`.
//!
//! Every other admin setter announces itself. This one replaced the rate limits
//! silently, so neither an indexer nor the admin audit log could see a limit
//! move.

#![cfg(test)]
extern crate std;

use crate::{SwiftRemitContract, SwiftRemitContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token, Address, Env,
};

/// True when some emitted event carries exactly these two symbol topics.
/// Compared through the XDR, which is what the ledger actually holds.
fn has_event(env: &Env, t0: &str, t1: &str) -> bool {
    use soroban_sdk::xdr::{ContractEventBody, ScSymbol, ScVal, StringM};
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

fn count_events(env: &Env, t0: &str, t1: &str) -> usize {
    use soroban_sdk::xdr::{ContractEventBody, ScSymbol, ScVal, StringM};
    let sym0 = ScVal::Symbol(ScSymbol(StringM::try_from(t0).unwrap()));
    let sym1 = ScVal::Symbol(ScSymbol(StringM::try_from(t1).unwrap()));
    env.events()
        .all()
        .events()
        .iter()
        .filter(|e| {
            if let ContractEventBody::V0(body) = &e.body {
                body.topics.len() >= 2 && body.topics[0] == sym0 && body.topics[1] == sym1
            } else {
                false
            }
        })
        .count()
}

fn setup(env: &Env) -> (SwiftRemitContractClient, Address) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_sac = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let _ = token::StellarAssetClient::new(env, &token_sac);

    let contract =
        SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}));
    contract.initialize(&admin, &token_sac, &250, &0, &0, &admin);

    (contract, admin)
}

/// Changing the limits announces the change.
#[test]
fn test_1832_update_rate_limit_config_emits_an_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, admin) = setup(&env);

    assert!(
        !has_event(&env, "ratelimit", "updated"),
        "nothing announced before the setter is called"
    );

    contract.update_rate_limit_config(&admin, &50u32, &30u64, &true);

    assert!(
        has_event(&env, "ratelimit", "updated"),
        "a rate-limit change must be visible to indexers and the audit log"
    );
}

/// The stored configuration is what the caller asked for, so the event and the
/// state cannot disagree.
#[test]
fn test_1832_the_announced_change_is_the_stored_one() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, admin) = setup(&env);

    contract.update_rate_limit_config(&admin, &50u32, &30u64, &true);

    assert_eq!(contract.get_rate_limit_config(), (50u32, 30u64, true));
    assert!(has_event(&env, "ratelimit", "updated"));
}

/// Each change is its own event: an indexer replaying the stream sees every
/// move, not just the latest state.
#[test]
fn test_1832_every_change_is_announced() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, admin) = setup(&env);

    contract.update_rate_limit_config(&admin, &50u32, &30u64, &true);
    contract.update_rate_limit_config(&admin, &10u32, &60u64, &false);
    contract.update_rate_limit_config(&admin, &10u32, &60u64, &true);

    assert_eq!(count_events(&env, "ratelimit", "updated"), 3);
    assert_eq!(contract.get_rate_limit_config(), (10u32, 60u64, true));
}

/// A non-admin cannot change the limits, so no event is emitted for a refused
/// call.
#[test]
fn test_1832_a_refused_call_announces_nothing() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract, _admin) = setup(&env);

    let stranger = Address::generate(&env);
    assert!(contract
        .try_update_rate_limit_config(&stranger, &50u32, &30u64, &true)
        .is_err());
    assert!(!has_event(&env, "ratelimit", "updated"));
}
