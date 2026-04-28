//! State transition validation for the SwiftRemit contract.
//!
//! This module enforces the canonical `RemittanceStatus` state machine:
//!
//! ```
//! Pending → Processing → Completed
//!         ↘            ↘
//!           Cancelled    Cancelled
//! ```
//!
//! Rules:
//! 1. All transitions must be explicitly validated before execution
//! 2. Terminal states (Completed, Cancelled) cannot transition further
//! 3. Invalid transitions are rejected with `ContractError::InvalidStateTransition`
//! 4. State updates are atomic — no partial writes
//! 5. Same-state transitions are idempotent (safe for retries)

use crate::types::RemittanceStatus;
use crate::errors::ContractError;
use soroban_sdk::Env;

/// Validates if a state transition is allowed.
///
/// Delegates to `RemittanceStatus::can_transition_to`, which encodes all
/// valid edges of the state machine. Same-state transitions are always allowed
/// (idempotent, safe for retry scenarios).
///
/// # Errors
///
/// Returns `ContractError::InvalidStateTransition` for any disallowed transition.
pub fn validate_transition(
    from: &RemittanceStatus,
    to: &RemittanceStatus,
) -> Result<(), ContractError> {
    // Idempotent: Allow same state → same state (for retry scenarios)
    if from == to {
        return Ok(());
    }

    if from.can_transition_to(to) {
        Ok(())
    } else {
        Err(ContractError::InvalidStateTransition)
    }
}

/// Atomically updates the remittance status with validation.
///
/// This function ensures that:
/// 1. The transition is valid according to state machine rules
/// 2. The update is atomic (all or nothing)
/// 3. Storage integrity is maintained
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance` - Mutable reference to the remittance to update
/// * `new_status` - The target status to transition to
///
/// # Returns
///
/// * `Ok(())` - Status updated successfully
/// * `Err(ContractError::InvalidStateTransition)` - Transition is invalid
///
/// # Guarantees
///
/// - Atomic: Either the status is updated or an error is returned (no partial updates)
/// - Validated: All transitions are validated before execution
/// - Deterministic: Same input always produces same result
/// - Idempotent: Repeated calls with same status are safe
pub fn transition_status(
    env: &Env,
    remittance: &mut crate::Remittance,
    new_status: RemittanceStatus,
) -> Result<(), ContractError> {
    // Validate the transition
    validate_transition(&remittance.status, &new_status)?;

    // Log transition for debugging (only in test/debug builds)
    log_transition(env, remittance.id, &remittance.status, &new_status);

    // Atomically update the status
    remittance.status = new_status;

    Ok(())
}

/// Checks if a status is terminal (cannot transition further).
///
/// # Arguments
///
/// * `status` - The status to check
///
/// # Returns
///
/// * `true` - Status is terminal (COMPLETED or FAILED)
/// * `false` - Status is non-terminal
pub fn is_terminal_status(status: &RemittanceStatus) -> bool {
    status.is_terminal()
}

/// Gets the list of valid next states for a given status.
///
/// # Arguments
///
/// * `status` - The current status
///
/// # Returns
///
/// Vector of valid next states (empty for terminal states)
pub fn get_valid_next_states(status: &RemittanceStatus) -> soroban_sdk::Vec<RemittanceStatus> {
    let env = Env::default();
    let mut result = soroban_sdk::Vec::new(&env);

    match status {
        RemittanceStatus::Pending => {
            result.push_back(RemittanceStatus::Processing);
            result.push_back(RemittanceStatus::Cancelled);
        }
        RemittanceStatus::Processing => {
            result.push_back(RemittanceStatus::Completed);
            result.push_back(RemittanceStatus::Cancelled);
        }
        RemittanceStatus::Completed | RemittanceStatus::Cancelled => {}
    }

    result
}

/// Logs a state transition for debugging purposes.
///
/// This function only logs in test/debug builds and has no effect in production.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - ID of the remittance being transitioned
/// * `from` - Current status
/// * `to` - Target status
fn log_transition(env: &Env, remittance_id: u64, from: &RemittanceStatus, to: &RemittanceStatus) {
    let _ = (env, remittance_id, from, to);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_valid_transition_pending_to_processing() {
        assert!(validate_transition(
            &RemittanceStatus::Pending,
            &RemittanceStatus::Processing
        )
        .is_ok());
    }

    #[test]
    fn test_valid_transition_pending_to_cancelled() {
        assert!(validate_transition(
            &RemittanceStatus::Pending,
            &RemittanceStatus::Cancelled
        )
        .is_ok());
    }

    #[test]
    fn test_valid_transition_processing_to_completed() {
        assert!(validate_transition(
            &RemittanceStatus::Processing,
            &RemittanceStatus::Completed
        )
        .is_ok());
    }

    #[test]
    fn test_valid_transition_processing_to_cancelled() {
        assert!(validate_transition(
            &RemittanceStatus::Processing,
            &RemittanceStatus::Cancelled
        )
        .is_ok());
    }

    #[test]
    fn test_invalid_transition_pending_to_completed() {
        // Must go through Processing first
        assert!(validate_transition(
            &RemittanceStatus::Pending,
            &RemittanceStatus::Completed
        )
        .is_err());
    }

    #[test]
    fn test_invalid_transition_completed_to_pending() {
        assert!(validate_transition(
            &RemittanceStatus::Completed,
            &RemittanceStatus::Pending
        )
        .is_err());
    }

    #[test]
    fn test_invalid_transition_cancelled_to_pending() {
        assert!(validate_transition(
            &RemittanceStatus::Cancelled,
            &RemittanceStatus::Pending
        )
        .is_err());
    }

    #[test]
    fn test_idempotent_transition_pending() {
        assert!(validate_transition(
            &RemittanceStatus::Pending,
            &RemittanceStatus::Pending
        )
        .is_ok());
    }

    #[test]
    fn test_idempotent_transition_processing() {
        assert!(validate_transition(
            &RemittanceStatus::Processing,
            &RemittanceStatus::Processing
        )
        .is_ok());
    }

    #[test]
    fn test_idempotent_transition_completed() {
        assert!(validate_transition(
            &RemittanceStatus::Completed,
            &RemittanceStatus::Completed
        )
        .is_ok());
    }

    #[test]
    fn test_idempotent_transition_cancelled() {
        assert!(validate_transition(
            &RemittanceStatus::Cancelled,
            &RemittanceStatus::Cancelled
        )
        .is_ok());
    }

    #[test]
    fn test_is_terminal_status_completed() {
        assert!(is_terminal_status(&RemittanceStatus::Completed));
    }

    #[test]
    fn test_is_terminal_status_cancelled() {
        assert!(is_terminal_status(&RemittanceStatus::Cancelled));
    }

    #[test]
    fn test_is_not_terminal_status_pending() {
        assert!(!is_terminal_status(&RemittanceStatus::Pending));
    }

    #[test]
    fn test_is_not_terminal_status_processing() {
        assert!(!is_terminal_status(&RemittanceStatus::Processing));
    }

    #[test]
    fn test_valid_next_states_from_pending() {
        let next_states = get_valid_next_states(&RemittanceStatus::Pending);
        assert_eq!(next_states.len(), 2);
        assert!(next_states.contains(&RemittanceStatus::Processing));
        assert!(next_states.contains(&RemittanceStatus::Cancelled));
    }

    #[test]
    fn test_valid_next_states_from_processing() {
        let next_states = get_valid_next_states(&RemittanceStatus::Processing);
        assert_eq!(next_states.len(), 2);
        assert!(next_states.contains(&RemittanceStatus::Completed));
        assert!(next_states.contains(&RemittanceStatus::Cancelled));
    }

    #[test]
    fn test_valid_next_states_from_completed() {
        let next_states = get_valid_next_states(&RemittanceStatus::Completed);
        assert_eq!(next_states.len(), 0);
    }

    #[test]
    fn test_valid_next_states_from_cancelled() {
        let next_states = get_valid_next_states(&RemittanceStatus::Cancelled);
        assert_eq!(next_states.len(), 0);
    }

    #[test]
    fn test_transition_status_valid() {
        let env = Env::default();
        let sender = soroban_sdk::Address::generate(&env);
        let agent = soroban_sdk::Address::generate(&env);

        let mut remittance = crate::Remittance {
            id: 1,
            sender,
            agent,
            amount: 100,
            fee: 2,
            status: RemittanceStatus::Pending,
            expiry: None,
        };

        let result = transition_status(&env, &mut remittance, RemittanceStatus::Processing);
        assert!(result.is_ok());
        assert_eq!(remittance.status, RemittanceStatus::Processing);
    }

    #[test]
    fn test_transition_status_invalid() {
        let env = Env::default();
        let sender = soroban_sdk::Address::generate(&env);
        let agent = soroban_sdk::Address::generate(&env);

        let mut remittance = crate::Remittance {
            id: 1,
            sender,
            agent,
            amount: 100,
            fee: 2,
            status: RemittanceStatus::Completed,
            expiry: None,
        };

        let result = transition_status(&env, &mut remittance, RemittanceStatus::Pending);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ContractError::InvalidStateTransition);
        assert_eq!(remittance.status, RemittanceStatus::Completed);
    }

    #[test]
    fn test_transition_status_idempotent() {
        let env = Env::default();
        let sender = soroban_sdk::Address::generate(&env);
        let agent = soroban_sdk::Address::generate(&env);

        let mut remittance = crate::Remittance {
            id: 1,
            sender,
            agent,
            amount: 100,
            fee: 2,
            status: RemittanceStatus::Pending,
            expiry: None,
        };

        let result = transition_status(&env, &mut remittance, RemittanceStatus::Pending);
        assert!(result.is_ok());
        assert_eq!(remittance.status, RemittanceStatus::Pending);
    }
}
