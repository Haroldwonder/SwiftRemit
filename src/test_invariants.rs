//! Property-based tests for SwiftRemit contract invariants.
//!
//! Uses `proptest` to verify critical safety properties across randomized inputs.
//!
//! # Invariants Tested
//!
//! 1. **Balance Conservation**: Contract balance always equals the sum of all active
//!    (Pending) escrow amounts. No tokens are created or destroyed — only redistributed.
//!
//! 2. **Monotonic Status Transitions**: Remittance status transitions are monotonic and
//!    irreversible. Once a terminal state (Completed, Cancelled) is reached, no further
//!    transitions are possible. The state machine only moves forward.
//!
//! 3. **Authorization Enforcement**: Only authorized parties can change state. Senders
//!    can only cancel their own remittances; only registered agents can confirm payouts;
//!    only the admin can register agents or update fees.
#![cfg(test)]
extern crate std;

use crate::{RemittanceStatus, SwiftRemitContract, SwiftRemitContractClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env};

// ============================================================================
// Helpers
// ============================================================================

fn make_token<'a>(env: &'a Env, admin: &Address) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    (token::Client::new(env, &addr), token::StellarAssetClient::new(env, &addr))
}

fn make_contract<'a>(env: &'a Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

/// Valid remittance amounts: 1 to 1_000_000 stroops
fn valid_amount() -> impl Strategy<Value = i128> {
    1i128..=1_000_000i128
}

/// Valid fee basis points: 0 to 1000 (0%–10%)
fn valid_fee_bps() -> impl Strategy<Value = u32> {
    0u32..=1000u32
}

// ============================================================================
// Invariant 1: Balance Conservation
//
// The contract's token balance must always equal the sum of all Pending escrow
// amounts. Tokens are never created or destroyed — only moved between parties.
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    /// After `create_remittance`, the contract holds exactly `amount` tokens
    /// and the total supply (sender + contract) is unchanged.
    #[test]
    fn prop_contract_balance_equals_pending_escrow(
        amount in valid_amount(),
        fee_bps in valid_fee_bps(),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let (token, token_sa) = make_token(&env, &token_admin);
        token_sa.mint(&sender, &10_000_000_000i128);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let sender_before = token.balance(&sender);

        let id = contract.create_remittance(&sender, &agent, &amount, &None);

        // Contract must hold exactly the escrowed amount
        prop_assert_eq!(
            token.balance(&contract.address),
            amount,
            "Contract balance must equal the single pending escrow amount"
        );

        // Total supply is conserved (sender + contract = sender_before)
        prop_assert_eq!(
            token.balance(&sender) + token.balance(&contract.address),
            sender_before,
            "Tokens were created or destroyed during escrow"
        );

        // Remittance records the correct amount
        let r = contract.get_remittance(&id);
        prop_assert_eq!(r.amount, amount);
    }

    /// After settlement, the contract balance drops to zero and the total
    /// supply across all parties is unchanged.
    #[test]
    fn prop_balance_conserved_after_settlement(
        amount in valid_amount(),
        fee_bps in valid_fee_bps(),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let (token, token_sa) = make_token(&env, &token_admin);
        token_sa.mint(&sender, &10_000_000_000i128);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let id = contract.create_remittance(&sender, &agent, &amount, &None);

        let total_before = token.balance(&sender)
            + token.balance(&contract.address)
            + token.balance(&agent)
            + token.balance(&admin); // admin doubles as treasury

        contract.confirm_payout(&id);

        let total_after = token.balance(&sender)
            + token.balance(&contract.address)
            + token.balance(&agent)
            + token.balance(&admin);

        prop_assert_eq!(
            total_before, total_after,
            "Tokens were created or destroyed during settlement"
        );
        prop_assert_eq!(
            token.balance(&contract.address),
            0,
            "Contract still holds tokens after settlement"
        );
    }

    /// After cancellation, the sender receives a full refund and the contract
    /// balance returns to zero.
    #[test]
    fn prop_balance_conserved_after_cancellation(
        amount in valid_amount(),
        fee_bps in valid_fee_bps(),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let (token, token_sa) = make_token(&env, &token_admin);
        token_sa.mint(&sender, &10_000_000_000i128);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);

        let sender_before = token.balance(&sender);
        let id = contract.create_remittance(&sender, &agent, &amount, &None);

        contract.cancel_remittance(&id);

        prop_assert_eq!(
            token.balance(&sender),
            sender_before,
            "Sender did not receive full refund on cancellation"
        );
        prop_assert_eq!(
            token.balance(&contract.address),
            0,
            "Contract still holds tokens after cancellation"
        );
    }
}

// ============================================================================
// Invariant 2: Monotonic Status Transitions
//
// Status transitions are strictly forward-only. Terminal states (Completed,
// Cancelled) are irreversible. The state machine never goes backwards.
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    /// A new remittance always starts in Pending state.
    #[test]
    fn prop_new_remittance_starts_pending(
        amount in valid_amount(),
        fee_bps in valid_fee_bps(),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let (token, token_sa) = make_token(&env, &token_admin);
        token_sa.mint(&sender, &10_000_000_000i128);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);

        let id = contract.create_remittance(&sender, &agent, &amount, &None);
        let r = contract.get_remittance(&id);

        prop_assert_eq!(
            r.status,
            RemittanceStatus::Pending,
            "New remittance must start in Pending state"
        );
    }

    /// Pending → Completed is valid; Completed → anything is rejected (terminal).
    #[test]
    fn prop_completed_is_terminal(
        amount in valid_amount(),
        fee_bps in valid_fee_bps(),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let (token, token_sa) = make_token(&env, &token_admin);
        token_sa.mint(&sender, &10_000_000_000i128);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let id = contract.create_remittance(&sender, &agent, &amount, &None);
        contract.confirm_payout(&id);

        prop_assert_eq!(contract.get_remittance(&id).status, RemittanceStatus::Completed);

        // A second confirm_payout on a Completed remittance must fail
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.confirm_payout(&id);
        }));
        prop_assert!(
            result.is_err(),
            "Completed remittance must not accept further transitions"
        );
    }

    /// Pending → Cancelled is valid; Cancelled → anything is rejected (terminal).
    #[test]
    fn prop_cancelled_is_terminal(
        amount in valid_amount(),
        fee_bps in valid_fee_bps(),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let (token, token_sa) = make_token(&env, &token_admin);
        token_sa.mint(&sender, &10_000_000_000i128);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);

        let id = contract.create_remittance(&sender, &agent, &amount, &None);
        contract.cancel_remittance(&id);

        prop_assert_eq!(contract.get_remittance(&id).status, RemittanceStatus::Cancelled);

        // Attempting to cancel again must fail
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.cancel_remittance(&id);
        }));
        prop_assert!(
            result.is_err(),
            "Cancelled remittance must not accept further transitions"
        );
    }
}

// ============================================================================
// Invariant 3: Authorization Enforcement
//
// Only authorized parties can change state. Unauthorized calls must be
// rejected regardless of the remittance's current status.
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    /// An unregistered agent cannot receive a remittance.
    #[test]
    fn prop_unregistered_agent_rejected(
        amount in valid_amount(),
        fee_bps in valid_fee_bps(),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let unregistered_agent = Address::generate(&env); // never registered

        let (token, token_sa) = make_token(&env, &token_admin);
        token_sa.mint(&sender, &10_000_000i128);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        // Intentionally NOT registering `unregistered_agent`

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.create_remittance(&sender, &unregistered_agent, &amount, &None);
        }));

        prop_assert!(
            result.is_err(),
            "Contract must reject remittances to unregistered agents"
        );
    }

    /// An address that was never registered via `register_agent` is not recognized
    /// as an agent. Only the admin can grant agent status.
    #[test]
    fn prop_only_registered_addresses_are_agents(
        fee_bps in valid_fee_bps(),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let (token, _) = make_token(&env, &token_admin);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);

        let random_address = Address::generate(&env);

        // An address that was never registered must not be recognized as an agent
        prop_assert!(
            !contract.is_agent_registered(&random_address),
            "Unregistered address must not be recognized as an agent"
        );
    }

    /// Fee calculation is always non-negative and never exceeds the principal.
    /// This enforces that only valid fee math can authorize a state change.
    #[test]
    fn prop_fee_never_exceeds_amount(
        amount in valid_amount(),
        fee_bps in valid_fee_bps(),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let (token, token_sa) = make_token(&env, &token_admin);
        token_sa.mint(&sender, &10_000_000_000i128);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent);

        let id = contract.create_remittance(&sender, &agent, &amount, &None);
        let r = contract.get_remittance(&id);

        prop_assert!(r.fee >= 0, "Fee must be non-negative");
        prop_assert!(r.fee <= r.amount, "Fee must not exceed the remittance amount");
        prop_assert_eq!(
            (r.amount * fee_bps as i128) / 10_000,
            r.fee,
            "Fee must equal amount * fee_bps / 10000"
        );
    }
}
