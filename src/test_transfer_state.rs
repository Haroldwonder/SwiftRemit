#![cfg(test)]

// TransferState is now a type alias for RemittanceStatus.
// These tests validate the unified state machine through the storage layer.
use crate::{ContractError, SwiftRemitContract, RemittanceStatus};
use soroban_sdk::Env;

#[test]
fn test_transfer_state_transitions() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let transfer_id = 1u64;

    env.as_contract(&contract_id, || {
        // Initial state: Pending
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Pending).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(RemittanceStatus::Pending)
        );

        // Valid: Pending -> Processing
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Processing).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(RemittanceStatus::Processing)
        );

        // Valid: Processing -> Completed
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Completed).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(RemittanceStatus::Completed)
        );
    });
}

#[test]
fn test_invalid_state_transitions() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let transfer_id = 2u64;

    env.as_contract(&contract_id, || {
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Pending).unwrap();

        // Invalid: Pending -> Completed (must go through Processing)
        let result = crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Completed);
        assert_eq!(result, Err(ContractError::InvalidStateTransition));

        // State should remain Pending
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(RemittanceStatus::Pending)
        );
    });
}

#[test]
fn test_terminal_states_cannot_transition() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let transfer_id = 3u64;

    env.as_contract(&contract_id, || {
        // Set to Completed (terminal state)
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Completed).unwrap();

        // Cannot transition from Completed
        let result = crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Processing);
        assert_eq!(result, Err(ContractError::InvalidStateTransition));

        // Set to Cancelled (terminal state)
        let transfer_id2 = 4u64;
        crate::storage::set_transfer_state(&env, transfer_id2, RemittanceStatus::Cancelled).unwrap();

        // Cannot transition from Cancelled
        let result = crate::storage::set_transfer_state(&env, transfer_id2, RemittanceStatus::Completed);
        assert_eq!(result, Err(ContractError::InvalidStateTransition));
    });
}

#[test]
fn test_cancellation_path() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let transfer_id = 5u64;

    env.as_contract(&contract_id, || {
        // Pending -> Cancelled (early cancellation)
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Pending).unwrap();
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Cancelled).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(RemittanceStatus::Cancelled)
        );

        // Processing -> Cancelled (failed payout)
        let transfer_id2 = 6u64;
        crate::storage::set_transfer_state(&env, transfer_id2, RemittanceStatus::Pending).unwrap();
        crate::storage::set_transfer_state(&env, transfer_id2, RemittanceStatus::Processing).unwrap();
        crate::storage::set_transfer_state(&env, transfer_id2, RemittanceStatus::Cancelled).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id2),
            Some(RemittanceStatus::Cancelled)
        );
    });
}

#[test]
fn test_idempotent_same_state() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let transfer_id = 7u64;

    env.as_contract(&contract_id, || {
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Pending).unwrap();

        // Setting same state should succeed (idempotent)
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Pending).unwrap();

        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(RemittanceStatus::Pending)
        );
    });
}

#[test]
fn test_storage_efficiency() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let transfer_id = 8u64;

    env.as_contract(&contract_id, || {
        crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Pending).unwrap();

        // Setting same state should not write (storage-efficient)
        let result = crate::storage::set_transfer_state(&env, transfer_id, RemittanceStatus::Pending);
        assert!(result.is_ok());
    });
}
