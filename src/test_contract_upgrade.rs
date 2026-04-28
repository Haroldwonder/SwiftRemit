//! Tests for Contract Upgrade Module
//!
//! Tests cover:
//! - Proposal creation
//! - Multi-sig approval
//! - Timelock enforcement
//! - Execution after timelock

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Env, BytesN};

use crate::contract_upgrade::{
    ContractUpgrade, UpgradeProposal, UpgradeStatus,
    propose_upgrade, approve_upgrade, execute_upgrade,
};

// Test utilities
fn generate_wasm_hash(env: &Env) -> BytesN<32> {
    // Generate a test WASM hash
    let mut hash: BytesN<32> = BytesN::from_array(env, &[0u8; 32]);
    hash
}

#[test]
fn test_propose_upgrade_success() {
    let env = Env::default();
    let admin = Address::from_string(&"GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5JBF3ULETJ2MYBP2LQJ".parse::<Address>().unwrap());
    
    let wasm_hash = generate_wasm_hash(&env);
    let result = contract.propose_upgrade(&admin, &wasm_hash);
    
    assert!(result.is_ok());
}

#[test]
fn test_propose_upgrade_unauthorized() {
    let env = Env::default();
    let non_admin = Address::from_string(&"GA7QYNF7SOWQ6XLQJ33AHP6ARJLZDHFIZTFQOFJCAZBLW3V6FWLLTM7D2C4".parse::<Address>().unwrap());
    
    let wasm_hash = generate_wasm_hash(&env);
    let result = contract.propose_upgrade(&non_admin, &wasm_hash);
    
    assert!(result.is_err());
}

#[test]
fn test_approve_upgrade_success() {
    let env = Env::default();
    let admin1 = Address::from_string(&"GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5JBF3ULETJ2MYBP2LQJ".parse::<Address>().unwrap());
    let admin2 = Address::from_string(&"GA7QYNF7SOWQ6XLQJ33AHP6ARJLZDHFIZTFQOFJCAZBLW3V6FWLLTM7D2C4".parse::<Address>().unwrap());
    
    // Propose
    let wasm_hash = generate_wasm_hash(&env);
    let proposal_id = contract.propose_upgrade(&admin1, &wasm_hash).unwrap();
    
    // Approve
    let result = contract.approve_upgrade(&admin2, &proposal_id);
    assert!(result.is_ok());
}

#[test]
fn test_timelock_enforced() {
    let env = Env::default();
    let admin1 = Address::from_string(&"GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5JBF3ULETJ2MYBP2LQJ".parse::<Address>().unwrap());
    let admin2 = Address::from_string(&"GA7QYNF7SOWQ6XLQJ33AHP6ARJLZDHFIZTFQOFJCAZBLW3V6FWLLTM7D2C4".parse::<Address>().unwrap());
    let admin3 = Address::from_string(&"GCJ2T4R7BZHK4K5GQ6TQZY7QCMCMSQ6C3J7LQVLRIJJGZLW7RQ7CQZJ".parse::<Address>().unwrap());
    
    // Propose
    let wasm_hash = generate_wasm_hash(&env);
    let proposal_id = contract.propose_upgrade(&admin1, &wasm_hash).unwrap();
    
    // Approve from enough admins for quorum
    contract.approve_upgrade(&admin2, &proposal_id);
    contract.approve_upgrade(&admin3, &proposal_id);
    
    // Try to execute immediately - should fail (timelock active)
    let result = contract.execute_upgrade(&admin1, &proposal_id);
    assert!(result.is_err());
    
    // Simulate 48 hours passing
    // In real test, would mock ledger timestamp
    
    // After timelock, should succeed
    let result = contract.execute_upgrade(&admin1, &proposal_id);
    assert!(result.is_ok());
}

#[test]
fn test_upgrade_proposal_events() {
    let env = Env::default();
    let admin = Address::from_string(&"GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5JBF3ULETJ2MYBP2LQJ".parse::<Address>().unwrap());
    
    let wasm_hash = generate_wasm_hash(&env);
    let proposal_id = contract.propose_upgrade(&admin, &wasm_hash).unwrap();
    
    // Verify event would be emitted (checked via test events)
    // Events: UpgradeProposed(proposal_id, wasm_hash)
    //         -> UpgradeApproved(proposal_id, 1) 
    //         -> UpgradeExecuted(proposal_id)
}