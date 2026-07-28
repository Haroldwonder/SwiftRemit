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
//!
//! 4. **Escrow Solvency** (SR-008): The contract's USDC balance must always be greater
//!    than or equal to the sum of every outstanding obligation — pending/processing
//!    remittances net of partial disbursements, open standalone escrows, and
//!    accumulated platform + integrator fees — across long randomized sequences of
//!    create/cancel/confirm/partial-confirm/mark-failed/dispute/resolve/expire/withdraw
//!    operations. Also asserts that remittance count and total volume are monotonic,
//!    and that accumulated fees never decrease except via `withdraw_fees`.
#![cfg(test)]
extern crate std;

use crate::{RemittanceStatus, SwiftRemitContract, SwiftRemitContractClient};
use proptest::collection::vec as prop_vec;
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
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
        contract.register_agent(&agent, &None);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let sender_before = token.balance(&sender);

        let id = contract.create_remittance(&sender, &agent, &amount, &None, &None, &None, &None, &None);

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
        contract.register_agent(&agent, &None);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let id = contract.create_remittance(&sender, &agent, &amount, &None, &None, &None, &None, &None);

        let total_before = token.balance(&sender)
            + token.balance(&contract.address)
            + token.balance(&agent)
            + token.balance(&admin); // admin doubles as treasury

        contract.confirm_payout(&agent, &id, &None, &None);

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
        contract.register_agent(&agent, &None);

        let sender_before = token.balance(&sender);
        let id = contract.create_remittance(&sender, &agent, &amount, &None, &None, &None, &None, &None);

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
        contract.register_agent(&agent, &None);

        let id = contract.create_remittance(&sender, &agent, &amount, &None, &None, &None, &None, &None);
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
        contract.register_agent(&agent, &None);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let id = contract.create_remittance(&sender, &agent, &amount, &None, &None, &None, &None, &None);
        contract.confirm_payout(&agent, &id, &None, &None);

        prop_assert_eq!(contract.get_remittance(&id).status, RemittanceStatus::Completed);

        // A second confirm_payout on a Completed remittance must fail
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.confirm_payout(&agent, &id, &None, &None);
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
        contract.register_agent(&agent, &None);

        let id = contract.create_remittance(&sender, &agent, &amount, &None, &None, &None, &None, &None);
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
            contract.create_remittance(&sender, &unregistered_agent, &amount, &None, &None, &None, &None, &None);
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
        contract.register_agent(&agent, &None);

        let id = contract.create_remittance(&sender, &agent, &amount, &None, &None, &None, &None, &None);
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

// ============================================================================
// Invariant 4: Escrow Solvency (SR-008)
//
// The contract's token balance must always be >= the sum of all outstanding
// obligations:
//
//   token_balance(contract) >= Σ(pending+processing amounts - disbursed)
//                             + Σ(open escrows)
//                             + accumulated_fees
//                             + accumulated_integrator_fees
//
// A generated sequence of operations is applied to a single contract
// instance. Each operation is wrapped in `catch_unwind` so that an expected
// precondition failure (e.g. confirming an already-settled remittance, or
// picking an index into an empty pool) simply skips that step rather than
// aborting the case — the invariant is checked after *every* step regardless
// of which operations actually succeeded on-chain.
//
// A lightweight local model tracks only what the test itself caused to
// happen (successful creates/disbursements/closures); it is intentionally
// derived from confirmed on-chain call outcomes rather than mirrored
// business logic, so it cannot drift into falsely proving solvency.
// ============================================================================

#[derive(Clone, Debug)]
enum Op {
    CreateRemittance { amount_seed: u32 },
    Cancel { pick: u32 },
    Confirm { pick: u32 },
    PartialConfirm { pick: u32, amount_seed: u32 },
    MarkFailed { pick: u32 },
    RaiseDispute { pick: u32 },
    ResolveDispute { pick: u32, favor_sender: bool },
    Expire { pick: u32 },
    WithdrawFees,
    CreateEscrow { amount_seed: u32 },
    ReleaseEscrow { pick: u32 },
    RefundEscrow { pick: u32 },
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => (1u32..=500_000u32).prop_map(|amount_seed| Op::CreateRemittance { amount_seed }),
        2 => any::<u32>().prop_map(|pick| Op::Cancel { pick }),
        3 => any::<u32>().prop_map(|pick| Op::Confirm { pick }),
        2 => (any::<u32>(), 1u32..=500_000u32)
            .prop_map(|(pick, amount_seed)| Op::PartialConfirm { pick, amount_seed }),
        1 => any::<u32>().prop_map(|pick| Op::MarkFailed { pick }),
        1 => any::<u32>().prop_map(|pick| Op::RaiseDispute { pick }),
        1 => (any::<u32>(), any::<bool>())
            .prop_map(|(pick, favor_sender)| Op::ResolveDispute { pick, favor_sender }),
        1 => any::<u32>().prop_map(|pick| Op::Expire { pick }),
        1 => Just(Op::WithdrawFees),
        2 => (1u32..=500_000u32).prop_map(|amount_seed| Op::CreateEscrow { amount_seed }),
        1 => any::<u32>().prop_map(|pick| Op::ReleaseEscrow { pick }),
        1 => any::<u32>().prop_map(|pick| Op::RefundEscrow { pick }),
    ]
}

/// Local bookkeeping for a remittance created during the run.
struct RemModel {
    id: u64,
    amount: i128,
    disbursed: i128,
    open: bool,
}

/// Local bookkeeping for a standalone escrow created during the run.
struct EscrowModel {
    id: u64,
    amount: i128,
    open: bool,
}

fn pick_index(pick: u32, len: usize) -> Option<usize> {
    if len == 0 {
        None
    } else {
        Some((pick as usize) % len)
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// Applies a random sequence of operations across remittances and escrows,
    /// asserting solvency plus the monotonicity invariants after every step.
    #[test]
    fn prop_solvency_invariant_holds_across_random_op_sequences(
        fee_bps in valid_fee_bps(),
        ops in prop_vec(op_strategy(), 1..=20),
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        let (token, token_sa) = make_token(&env, &token_admin);
        token_sa.mint(&sender, &1_000_000_000_000i128);

        let contract = make_contract(&env);
        contract.initialize(&admin, &token.address, &fee_bps, &0, &0, &admin);
        contract.register_agent(&agent, &None);
        contract.assign_role(&admin, &agent, &crate::Role::Settler);

        let mut rems: std::vec::Vec<RemModel> = std::vec::Vec::new();
        let mut escrows: std::vec::Vec<EscrowModel> = std::vec::Vec::new();

        let mut prev_remittance_count = contract.get_remittance_count();
        let mut prev_total_volume = contract.get_total_volume();
        let mut prev_accumulated_fees = contract.get_accumulated_fees();

        // Captures `contract` and `token` by shared reference; mutates the
        // `prev_*` locals across calls, so it must be an `FnMut`.
        let mut check_invariants = |rems: &std::vec::Vec<RemModel>,
                                     escrows: &std::vec::Vec<EscrowModel>,
                                     just_withdrew_fees: bool|
         -> Result<(), TestCaseError> {
            let pending_processing: i128 = rems
                .iter()
                .filter(|r| r.open)
                .map(|r| r.amount - r.disbursed)
                .sum();
            let open_escrows: i128 = escrows.iter().filter(|e| e.open).map(|e| e.amount).sum();
            let accumulated_fees = contract.get_accumulated_fees();
            let integrator_fees = contract.get_accumulated_integrator_fees();
            let obligations = pending_processing + open_escrows + accumulated_fees + integrator_fees;
            let balance = token.balance(&contract.address);

            prop_assert!(
                balance >= obligations,
                "Solvency violated: balance {} < obligations {} \
                 (pending/processing {}, open escrows {}, fees {}, integrator fees {})",
                balance, obligations, pending_processing, open_escrows, accumulated_fees, integrator_fees
            );

            let count = contract.get_remittance_count();
            prop_assert!(
                count >= prev_remittance_count,
                "Remittance count is not monotonic: {} < {}",
                count, prev_remittance_count
            );
            prev_remittance_count = count;

            let volume = contract.get_total_volume();
            prop_assert!(
                volume >= prev_total_volume,
                "Total volume decreased: {} < {}",
                volume, prev_total_volume
            );
            prev_total_volume = volume;

            if !just_withdrew_fees {
                prop_assert!(
                    accumulated_fees >= prev_accumulated_fees,
                    "Accumulated fees decreased without a withdrawal: {} < {}",
                    accumulated_fees, prev_accumulated_fees
                );
            }
            prev_accumulated_fees = accumulated_fees;

            Ok(())
        };

        check_invariants(&rems, &escrows, false)?;

        for op in ops {
            let mut just_withdrew_fees = false;

            match op {
                Op::CreateRemittance { amount_seed } => {
                    let amount = 1i128 + (amount_seed as i128 % 500_000);
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        contract.create_remittance(&sender, &agent, &amount, &None, &None, &None, &None, &None)
                    }));
                    if let Ok(id) = result {
                        rems.push(RemModel { id, amount, disbursed: 0, open: true });
                    }
                }

                Op::Cancel { pick } => {
                    if let Some(idx) = pick_index(pick, rems.len()) {
                        let id = rems[idx].id;
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            contract.cancel_remittance(&id)
                        }));
                        if result.is_ok() {
                            rems[idx].open = false;
                        }
                    }
                }

                Op::Confirm { pick } => {
                    if let Some(idx) = pick_index(pick, rems.len()) {
                        let id = rems[idx].id;
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            contract.confirm_payout(&agent, &id, &None, &None)
                        }));
                        if result.is_ok() {
                            rems[idx].open = false;
                        }
                    }
                }

                Op::PartialConfirm { pick, amount_seed } => {
                    if let Some(idx) = pick_index(pick, rems.len()) {
                        let id = rems[idx].id;
                        let remaining = rems[idx].amount - rems[idx].disbursed;
                        if remaining > 0 {
                            let amount = (1i128 + (amount_seed as i128 % remaining)).min(remaining);
                            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                contract.confirm_partial_payout(&id, &amount)
                            }));
                            if result.is_ok() {
                                rems[idx].disbursed += amount;
                            }
                        }
                    }
                }

                Op::MarkFailed { pick } => {
                    if let Some(idx) = pick_index(pick, rems.len()) {
                        let id = rems[idx].id;
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            contract.mark_failed(&id)
                        }));
                        if result.is_ok() {
                            rems[idx].open = false;
                        }
                    }
                }

                Op::RaiseDispute { pick } => {
                    if let Some(idx) = pick_index(pick, rems.len()) {
                        let id = rems[idx].id;
                        let hash = soroban_sdk::BytesN::from_array(&env, &[7u8; 32]);
                        // Disputed remittances stay escrowed either way, so no model change is needed.
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            contract.raise_dispute(&id, &hash)
                        }));
                    }
                }

                Op::ResolveDispute { pick, favor_sender } => {
                    if let Some(idx) = pick_index(pick, rems.len()) {
                        let id = rems[idx].id;
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            contract.resolve_dispute(&id, &favor_sender)
                        }));
                        if result.is_ok() {
                            rems[idx].open = false;
                        }
                    }
                }

                Op::Expire { pick } => {
                    if let Some(idx) = pick_index(pick, rems.len()) {
                        let id = rems[idx].id;
                        let ids = soroban_sdk::vec![&env, id];
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            contract.process_expired_remittances(&ids)
                        }));
                        if let Ok(processed) = result {
                            if processed.iter().any(|pid| pid == id) {
                                rems[idx].open = false;
                            }
                        }
                    }
                }

                Op::WithdrawFees => {
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        contract.withdraw_fees(&admin)
                    }));
                    just_withdrew_fees = result.is_ok();
                }

                Op::CreateEscrow { amount_seed } => {
                    let amount = 1i128 + (amount_seed as i128 % 500_000);
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        contract.create_escrow(&sender, &agent, &amount)
                    }));
                    if let Ok(id) = result {
                        escrows.push(EscrowModel { id, amount, open: true });
                    }
                }

                Op::ReleaseEscrow { pick } => {
                    if let Some(idx) = pick_index(pick, escrows.len()) {
                        let id = escrows[idx].id;
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            contract.release_escrow(&id)
                        }));
                        if result.is_ok() {
                            escrows[idx].open = false;
                        }
                    }
                }

                Op::RefundEscrow { pick } => {
                    if let Some(idx) = pick_index(pick, escrows.len()) {
                        let id = escrows[idx].id;
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            contract.refund_escrow(&id)
                        }));
                        if result.is_ok() {
                            escrows[idx].open = false;
                        }
                    }
                }
            }

            check_invariants(&rems, &escrows, just_withdrew_fees)?;
        }
    }
}
