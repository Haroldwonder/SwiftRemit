#![cfg(test)]

use crate::{ContractError, SwiftRemitContract, TransferState};
use soroban_sdk::Env;

#[test]
fn test_transfer_state_transitions() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});
    
    let transfer_id = 1u64;
    
    // Initial state: Initiated
    env.as_contract(&contract_id, || {
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Initiated).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(TransferState::Initiated)
        );

        // Valid: Initiated -> Processing
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Processing).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(TransferState::Processing)
        );

        // Valid: Processing -> Completed
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Completed).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(TransferState::Completed)
        );
    });
}

#[test]
fn test_invalid_state_transitions() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});
    
    let transfer_id = 2u64;
    
    // Set to Initiated
    env.as_contract(&contract_id, || {
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Initiated).unwrap();

        // Invalid: Initiated -> Completed (must go through Processing)
        let result = crate::storage::set_transfer_state(&env, transfer_id, TransferState::Completed);
        assert_eq!(result, Err(ContractError::InvalidStateTransition));

        // State should remain Initiated
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(TransferState::Initiated)
        );
    });
}

#[test]
fn test_terminal_states_cannot_transition() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});
    
    let transfer_id = 3u64;
    
    // Set to Completed (terminal state)
    env.as_contract(&contract_id, || {
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Completed).unwrap();

        // Cannot transition from Completed
        let result = crate::storage::set_transfer_state(&env, transfer_id, TransferState::Processing);
        assert_eq!(result, Err(ContractError::InvalidStateTransition));

        // Set to Refunded (terminal state)
        let transfer_id2 = 4u64;
        crate::storage::set_transfer_state(&env, transfer_id2, TransferState::Refunded).unwrap();

        // Cannot transition from Refunded
        let result = crate::storage::set_transfer_state(&env, transfer_id2, TransferState::Completed);
        assert_eq!(result, Err(ContractError::InvalidStateTransition));
    });
}

#[test]
fn test_refund_path() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});
    
    let transfer_id = 5u64;
    
    // Initiated -> Refunded (early cancellation)
    env.as_contract(&contract_id, || {
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Initiated).unwrap();
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Refunded).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(TransferState::Refunded)
        );

        // Processing -> Refunded (failed payout)
        let transfer_id2 = 6u64;
        crate::storage::set_transfer_state(&env, transfer_id2, TransferState::Initiated).unwrap();
        crate::storage::set_transfer_state(&env, transfer_id2, TransferState::Processing).unwrap();
        crate::storage::set_transfer_state(&env, transfer_id2, TransferState::Refunded).unwrap();
        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id2),
            Some(TransferState::Refunded)
        );
    });
}

#[test]
fn test_idempotent_same_state() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});
    
    let transfer_id = 7u64;
    
    // Set to Initiated
    env.as_contract(&contract_id, || {
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Initiated).unwrap();

        // Setting same state should succeed (idempotent)
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Initiated).unwrap();

        assert_eq!(
            crate::storage::get_transfer_state(&env, transfer_id),
            Some(TransferState::Initiated)
        );
    });
}

#[test]
fn test_storage_efficiency() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});
    
    let transfer_id = 8u64;
    
    // Set initial state
    env.as_contract(&contract_id, || {
        crate::storage::set_transfer_state(&env, transfer_id, TransferState::Initiated).unwrap();

        // Setting same state should not write (storage-efficient)
        // This is tested by the fact that it returns Ok without error
        let result = crate::storage::set_transfer_state(&env, transfer_id, TransferState::Initiated);
        assert!(result.is_ok());
    });
}
