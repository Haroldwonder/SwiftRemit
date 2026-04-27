//! Core logic for the emergency pause / circuit-breaker module.
//!
//! This module implements the four internal functions that back all circuit-breaker
//! entry points exposed in `lib.rs`:
//!
//! - [`do_emergency_pause`]   — pause with structured reason, auth, and audit trail
//! - [`do_emergency_unpause`] — unpause with optional timelock + quorum enforcement
//! - [`do_vote_unpause`]      — cast an admin vote; auto-unpause when quorum is reached
//! - [`build_status`]         — assemble a [`CircuitBreakerStatus`] snapshot from storage
//!
//! The `bypass_checks` / `bypass_timelock_quorum` flags allow the legacy `pause` /
//! `unpause` wrappers in `lib.rs` to delegate here without duplicating logic.

use soroban_sdk::{Address, Env};

use crate::{
    circuit_breaker_storage as cb_storage,
    events::{emit_circuit_breaker_paused, emit_circuit_breaker_unpaused},
    storage::{is_paused, require_role_admin, set_paused},
    types::{CircuitBreakerStatus, PauseReason, PauseRecord, UnpauseRecord},
    ContractError,
};

// ─── 3.1 do_emergency_pause ──────────────────────────────────────────────────

/// Pauses the contract, recording a structured [`PauseRecord`] and emitting an event.
///
/// # Parameters
/// - `caller`         — address initiating the pause; `require_auth()` is called unless
///                      `bypass_checks` is `true`.
/// - `reason`         — structured [`PauseReason`] stored in the audit record.
/// - `bypass_checks`  — when `true` (legacy `pause` wrapper), skips the admin role check
///                      and the already-paused guard.
///
/// # Errors
/// - [`ContractError::Unauthorized`]  — caller does not hold `Role::Admin` (unless bypassed).
/// - [`ContractError::AlreadyPaused`] — contract is already paused (unless bypassed).
pub fn do_emergency_pause(
    env: &Env,
    caller: &Address,
    reason: PauseReason,
    bypass_checks: bool,
) -> Result<(), ContractError> {
    if !bypass_checks {
        // Require caller authentication before the admin check.
        caller.require_auth();
        require_role_admin(env, caller)?;

        if is_paused(env) {
            return Err(ContractError::AlreadyPaused);
        }
    }

    // Increment the global pause sequence counter.
    let seq = cb_storage::get_pause_sequence(env)
        .checked_add(1)
        .ok_or(ContractError::Overflow)?;
    cb_storage::set_pause_sequence(env, seq);

    // Build and persist the pause record.
    let timestamp = env.ledger().timestamp();
    let record = PauseRecord {
        seq,
        caller: caller.clone(),
        timestamp,
        reason: reason.clone(),
    };
    cb_storage::save_pause_record(env, &record);

    // Mark this sequence as the active pause.
    cb_storage::set_active_pause_seq(env, seq);

    // Set the shared paused flag (read by validate_not_paused in validation.rs).
    set_paused(env, true);

    // Emit the circuit-breaker paused event.
    emit_circuit_breaker_paused(env, caller.clone(), timestamp, reason);

    Ok(())
}

// ─── 3.2 do_emergency_unpause ────────────────────────────────────────────────

/// Unpauses the contract, writing an [`UnpauseRecord`] and emitting an event.
///
/// # Parameters
/// - `caller`                   — address initiating the unpause; `require_auth()` is
///                                called unless `bypass_timelock_quorum` is `true`.
/// - `bypass_timelock_quorum`   — when `true` (legacy `unpause` wrapper), skips the
///                                admin role check, timelock, and quorum gate.
///
/// # Errors
/// - [`ContractError::NotPaused`]      — contract is not currently paused.
/// - [`ContractError::Unauthorized`]   — caller does not hold `Role::Admin` (unless bypassed).
/// - [`ContractError::TimelockActive`] — timelock has not yet elapsed (unless bypassed).
pub fn do_emergency_unpause(
    env: &Env,
    caller: &Address,
    bypass_timelock_quorum: bool,
) -> Result<(), ContractError> {
    if !is_paused(env) {
        return Err(ContractError::NotPaused);
    }

    if !bypass_timelock_quorum {
        // Require caller authentication before the admin check.
        caller.require_auth();
        require_role_admin(env, caller)?;

        // Enforce timelock: unpause is only allowed after the configured delay.
        let timelock = cb_storage::get_timelock_seconds(env);
        if timelock > 0 {
            if let Some(active_seq) = cb_storage::get_active_pause_seq(env) {
                if let Some(pause_record) = cb_storage::get_pause_record_by_seq(env, active_seq) {
                    let elapsed = env
                        .ledger()
                        .timestamp()
                        .saturating_sub(pause_record.timestamp);
                    if elapsed < timelock {
                        return Err(ContractError::TimelockActive);
                    }
                }
            }
        }

        // Enforce quorum: enough admin votes must have been cast.
        let quorum = cb_storage::get_unpause_quorum(env);
        let pause_seq_for_quorum = cb_storage::get_active_pause_seq(env).unwrap_or(0);
        let votes = cb_storage::get_vote_count_for_seq(env, pause_seq_for_quorum);
        if votes < quorum {
            return Err(ContractError::Unauthorized);
        }
    }

    // Retrieve the active pause sequence for the unpause record.
    let pause_seq = cb_storage::get_active_pause_seq(env).unwrap_or(0);

    // Clear the paused flag and active sequence.
    set_paused(env, false);
    cb_storage::clear_active_pause_seq(env);

    // Persist the unpause record.
    let timestamp = env.ledger().timestamp();
    let unpause_record = UnpauseRecord {
        caller: caller.clone(),
        timestamp,
        pause_seq,
    };
    cb_storage::save_unpause_record(env, &unpause_record);

    // Emit the circuit-breaker unpaused event.
    emit_circuit_breaker_unpaused(env, caller.clone(), timestamp);

    Ok(())
}

// ─── 3.3 do_vote_unpause ─────────────────────────────────────────────────────

/// Records an admin vote to unpause; auto-unpauses when quorum is reached.
///
/// The timelock is still enforced when quorum triggers an automatic unpause —
/// quorum is a separate gate, not a timelock bypass.
///
/// # Errors
/// - [`ContractError::NotPaused`]    — contract is not currently paused.
/// - [`ContractError::Unauthorized`] — caller does not hold `Role::Admin`.
/// - [`ContractError::AlreadyVoted`] — caller already voted for this pause instance.
pub fn do_vote_unpause(env: &Env, caller: &Address) -> Result<(), ContractError> {
    if !is_paused(env) {
        return Err(ContractError::NotPaused);
    }

    caller.require_auth();
    require_role_admin(env, caller)?;

    // Retrieve the active pause sequence to scope the vote.
    let pause_seq = cb_storage::get_active_pause_seq(env).unwrap_or(0);

    // Reject duplicate votes.
    if cb_storage::has_voted(env, pause_seq, caller) {
        return Err(ContractError::AlreadyVoted);
    }

    // Record the vote and increment the count.
    cb_storage::record_vote(env, pause_seq, caller);
    let new_count = cb_storage::get_vote_count_for_seq(env, pause_seq)
        .checked_add(1)
        .ok_or(ContractError::Overflow)?;
    cb_storage::set_vote_count_for_seq(env, pause_seq, new_count);

    // Auto-unpause when quorum is reached (timelock still applies).
    let quorum = cb_storage::get_unpause_quorum(env);
    if new_count >= quorum {
        // bypass_timelock_quorum = false: timelock is still enforced.
        do_emergency_unpause(env, caller, false)?;
    }

    Ok(())
}

// ─── 3.4 build_status ────────────────────────────────────────────────────────

/// Assembles a [`CircuitBreakerStatus`] snapshot from storage.
///
/// All fields are populated from the current storage state; no auth is required.
pub fn build_status(env: &Env) -> CircuitBreakerStatus {
    let paused = is_paused(env);

    let (pause_reason, pause_timestamp) = if paused {
        if let Some(seq) = cb_storage::get_active_pause_seq(env) {
            if let Some(record) = cb_storage::get_pause_record_by_seq(env, seq) {
                (Some(record.reason), Some(record.timestamp))
            } else {
                (None, None)
            }
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    CircuitBreakerStatus {
        is_paused: paused,
        pause_reason,
        pause_timestamp,
        timelock_seconds: cb_storage::get_timelock_seconds(env),
        unpause_quorum: cb_storage::get_unpause_quorum(env),
        current_vote_count: {
            let active_seq = cb_storage::get_active_pause_seq(env).unwrap_or(0);
            cb_storage::get_vote_count_for_seq(env, active_seq)
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        circuit_breaker_storage as cb_storage,
        storage::{assign_role, set_paused},
        types::PauseReason,
        Role, SwiftRemitContract,
    };
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn setup() -> (Env, soroban_sdk::Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SwiftRemitContract {});
        let admin = Address::generate(&env);
        env.as_contract(&contract_id, || {
            assign_role(&env, &admin, &Role::Admin);
            cb_storage::set_unpause_quorum(&env, 1);
        });
        (env, contract_id, admin)
    }

    /// Votes from cycle 1 must not be counted in cycle 2.
    #[test]
    fn test_vote_count_isolated_across_pause_cycles() {
        let (env, contract_id, admin) = setup();

        env.as_contract(&contract_id, || {
            // ── Cycle 1 ──────────────────────────────────────────────────────
            do_emergency_pause(&env, &admin, PauseReason::MaintenanceWindow, true).unwrap();
            let seq1 = cb_storage::get_active_pause_seq(&env).unwrap();

            // Cast 1 vote in cycle 1.
            do_vote_unpause(&env, &admin).unwrap();
            // Quorum=1 so the contract auto-unpaused; verify vote count for seq1 = 1.
            assert_eq!(cb_storage::get_vote_count_for_seq(&env, seq1), 1);

            // ── Cycle 2 ──────────────────────────────────────────────────────
            // Pause again (contract was auto-unpaused by quorum).
            do_emergency_pause(&env, &admin, PauseReason::SecurityIncident, true).unwrap();
            let seq2 = cb_storage::get_active_pause_seq(&env).unwrap();
            assert!(seq2 > seq1, "sequence must increment");

            // Cycle 2 vote count must start at 0 — not inherit cycle 1's count.
            assert_eq!(
                cb_storage::get_vote_count_for_seq(&env, seq2),
                0,
                "vote count for new pause cycle must be 0"
            );

            // build_status must also report 0 for the new cycle.
            let status = build_status(&env);
            assert_eq!(status.current_vote_count, 0);
        });
    }

    /// A voter who voted in cycle 1 can vote again in cycle 2 (different seq key).
    #[test]
    fn test_voter_can_vote_in_new_cycle() {
        let (env, contract_id, admin) = setup();
        // Use quorum=2 so the first vote doesn't auto-unpause.
        env.as_contract(&contract_id, || {
            cb_storage::set_unpause_quorum(&env, 2);

            // Cycle 1: vote once, then force-unpause.
            do_emergency_pause(&env, &admin, PauseReason::MaintenanceWindow, true).unwrap();
            do_vote_unpause(&env, &admin).unwrap();
            // Force-unpause (bypass quorum).
            do_emergency_unpause(&env, &admin, true).unwrap();

            // Cycle 2: same admin must be able to vote again.
            do_emergency_pause(&env, &admin, PauseReason::SecurityIncident, true).unwrap();
            let result = do_vote_unpause(&env, &admin);
            assert!(result.is_ok(), "admin should be able to vote in a new pause cycle");
        });
    }
}
