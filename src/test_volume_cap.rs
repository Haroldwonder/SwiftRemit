//! Regression tests for the corridor volume cap (#1646).
//!
//! The cap must be enforced cumulatively across rolling windows: once the
//! cumulative volume in a window reaches the configured cap, further
//! settlements in that window must be rejected, and the same must hold for
//! the second and third windows.

use super::*;

#[test]
fn corridor_volume_cap_enforced_across_multiple_windows() {
    let mut env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let currency = String::from_str(&env, "USD");
    let country = String::from_str(&env, "NGN");

    // Cap of 100 units per 1-hour window.
    let cap: i128 = 100;
    let window_seconds: u64 = 3600;
    client.initialize(&admin, &token);
    client.set_corridor_volume_cap(&admin, &currency, &country, &cap, &window_seconds);

    // Window 1: fill the cap exactly, then assert the next settlement fails.
    client.record_corridor_volume(&admin, &currency, &country, &60);
    client.record_corridor_volume(&admin, &currency, &country, &40);
    assert_eq!(client.get_corridor_volume(&currency, &country), cap);

    let over_cap = client.try_record_corridor_volume(&admin, &currency, &country, &1);
    assert!(over_cap.is_err(), "cap must reject volume beyond limit in window 1");

    // Window 2: the window advances naturally with ledger time; the cap must
    // reset and then be enforced cumulatively again.
    env.ledger().set_timestamp(env.ledger().timestamp() + window_seconds);
    assert_eq!(client.get_corridor_volume(&currency, &country), cap);

    client.record_corridor_volume(&admin, &currency, &country, &70);
    client.record_corridor_volume(&admin, &currency, &country, &30);
    assert_eq!(client.get_corridor_volume(&currency, &country), cap);

    let over_cap_w2 = client.try_record_corridor_volume(&admin, &currency, &country, &1);
    assert!(over_cap_w2.is_err(), "cap must reject volume beyond limit in window 2");

    // Window 3: same cumulative enforcement must hold.
    env.ledger().set_timestamp(env.ledger().timestamp() + window_seconds);
    client.record_corridor_volume(&admin, &currency, &country, &50);
    client.record_corridor_volume(&admin, &currency, &country, &50);
    assert_eq!(client.get_corridor_volume(&currency, &country), cap);

    let over_cap_w3 = client.try_record_corridor_volume(&admin, &currency, &country, &1);
    assert!(over_cap_w3.is_err(), "cap must reject volume beyond limit in window 3");
}
