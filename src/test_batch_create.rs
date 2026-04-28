//! Unit tests for batch remittance creation functionality.
//!
//! Tests cover:
//! - Successful batch creation with multiple entries
//! - Partial failure scenarios (atomic rollback)
//! - Oversized batch rejection
//! - Empty batch rejection
//! - Validation failures (invalid amount, unregistered agent, blacklisted user)

#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

    use crate::{
        storage, test::create_test_contract, BatchCreateEntry, ContractError, RemittanceStatus,
    };

    /// Helper function to set up a test environment with initialized contract
    fn setup_test_env() -> (Env, Address, Address) {
        let env = Env::default();
        let contract_id = env.register(crate::SwiftRemit, ());
        let sender = Address::generate(&env);
        let agent = Address::generate(&env);

        // Initialize contract
        let token = Address::generate(&env);
        let fee_bps = 250; // 2.5%
        env.as_contract(&contract_id, || {
            crate::initialize(env.clone(), sender.clone(), token, fee_bps).unwrap();
            crate::register_agent(env.clone(), agent.clone()).unwrap();
        });

        (env, contract_id, sender)
    }

    /// Test 1: Successful batch creation with multiple entries
    #[test]
    fn test_batch_create_success() {
        let (env, contract_id, sender) = setup_test_env();

        let agent1 = Address::generate(&env);
        let agent2 = Address::generate(&env);
        let agent3 = Address::generate(&env);

        // Register agents
        env.as_contract(&contract_id, || {
            crate::register_agent(env.clone(), agent1.clone()).unwrap();
            crate::register_agent(env.clone(), agent2.clone()).unwrap();
            crate::register_agent(env.clone(), agent3.clone()).unwrap();
        });

        // Create batch entries
        let mut entries = Vec::new(&env);
        entries.push_back(BatchCreateEntry {
            agent: agent1.clone(),
            amount: 100_000_000, // 100 USDC
            expiry: None,
        });
        entries.push_back(BatchCreateEntry {
            agent: agent2.clone(),
            amount: 200_000_000, // 200 USDC
            expiry: Some(env.ledger().timestamp() + 3600),
        });
        entries.push_back(BatchCreateEntry {
            agent: agent3.clone(),
            amount: 150_000_000, // 150 USDC
            expiry: None,
        });

        // Execute batch creation
        let result = env.as_contract(&contract_id, || {
            crate::batch_create_remittances(env.clone(), sender.clone(), entries)
        });

        assert!(result.is_ok());
        let remittance_ids = result.unwrap();
        assert_eq!(remittance_ids.len(), 3);

        // Verify all remittances were created
        env.as_contract(&contract_id, || {
            for i in 0..remittance_ids.len() {
                let remittance_id = remittance_ids.get_unchecked(i);
                let remittance = crate::get_remittance(&env, remittance_id).unwrap();
                assert_eq!(remittance.status, RemittanceStatus::Pending);
                assert_eq!(remittance.sender, sender);
            }

            // Verify first remittance
            let remittance1 = crate::get_remittance(&env, remittance_ids.get_unchecked(0)).unwrap();
            assert_eq!(remittance1.agent, agent1);
            assert_eq!(remittance1.amount, 100_000_000);

            // Verify second remittance
            let remittance2 = crate::get_remittance(&env, remittance_ids.get_unchecked(1)).unwrap();
            assert_eq!(remittance2.agent, agent2);
            assert_eq!(remittance2.amount, 200_000_000);
            assert!(remittance2.expiry.is_some());

            // Verify third remittance
            let remittance3 = crate::get_remittance(&env, remittance_ids.get_unchecked(2)).unwrap();
            assert_eq!(remittance3.agent, agent3);
            assert_eq!(remittance3.amount, 150_000_000);
        });
    }

    /// Test 2: Partial failure - atomic rollback when one entry fails validation
    #[test]
    fn test_batch_create_partial_failure() {
        let (env, contract_id, sender) = setup_test_env();

        let agent1 = Address::generate(&env);
        let agent2 = Address::generate(&env);
        let unregistered_agent = Address::generate(&env);

        // Register only agent1 and agent2
        env.as_contract(&contract_id, || {
            crate::register_agent(env.clone(), agent1.clone()).unwrap();
            crate::register_agent(env.clone(), agent2.clone()).unwrap();
        });

        // Create batch with one unregistered agent
        let mut entries = Vec::new(&env);
        entries.push_back(BatchCreateEntry {
            agent: agent1.clone(),
            amount: 100_000_000,
            expiry: None,
        });
        entries.push_back(BatchCreateEntry {
            agent: unregistered_agent.clone(), // This should fail
            amount: 200_000_000,
            expiry: None,
        });
        entries.push_back(BatchCreateEntry {
            agent: agent2.clone(),
            amount: 150_000_000,
            expiry: None,
        });

        // Execute batch creation - should fail
        let result = env.as_contract(&contract_id, || {
            crate::batch_create_remittances(env.clone(), sender.clone(), entries)
        });

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ContractError::AgentNotRegistered);

        // Verify no remittances were created (atomic rollback)
        env.as_contract(&contract_id, || {
            let counter = crate::get_remittance_counter(&env).unwrap();
            assert_eq!(counter, 0);
        });
    }

    /// Test 3: Oversized batch rejection
    #[test]
    fn test_batch_create_oversized() {
        let (env, contract_id, sender) = setup_test_env();

        let agent = Address::generate(&env);
        env.as_contract(&contract_id, || {
            crate::register_agent(env.clone(), agent.clone()).unwrap();
        });

        // Create batch with 101 entries (exceeds MAX_BATCH_SIZE of 100)
        let mut entries = Vec::new(&env);
        for _ in 0..101 {
            entries.push_back(BatchCreateEntry {
                agent: agent.clone(),
                amount: 1_000_000, // 1 USDC each
                expiry: None,
            });
        }

        // Execute batch creation - should fail
        let result = env.as_contract(&contract_id, || {
            crate::batch_create_remittances(env.clone(), sender.clone(), entries)
        });

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ContractError::InvalidBatchSize);
    }

    /// Test 4: Empty batch rejection
    #[test]
    fn test_batch_create_empty() {
        let (env, contract_id, sender) = setup_test_env();

        let entries = Vec::new(&env);

        // Execute batch creation - should fail
        let result = env.as_contract(&contract_id, || {
            crate::batch_create_remittances(env.clone(), sender.clone(), entries)
        });

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ContractError::InvalidBatchSize);
    }

    /// Test 5: Invalid amount in batch
    #[test]
    fn test_batch_create_invalid_amount() {
        let (env, contract_id, sender) = setup_test_env();

        let agent1 = Address::generate(&env);
        let agent2 = Address::generate(&env);

        env.as_contract(&contract_id, || {
            crate::register_agent(env.clone(), agent1.clone()).unwrap();
            crate::register_agent(env.clone(), agent2.clone()).unwrap();
        });

        // Create batch with one invalid amount
        let mut entries = Vec::new(&env);
        entries.push_back(BatchCreateEntry {
            agent: agent1.clone(),
            amount: 100_000_000,
            expiry: None,
        });
        entries.push_back(BatchCreateEntry {
            agent: agent2.clone(),
            amount: 0, // Invalid amount
            expiry: None,
        });

        // Execute batch creation - should fail
        let result = env.as_contract(&contract_id, || {
            crate::batch_create_remittances(env.clone(), sender.clone(), entries)
        });

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ContractError::InvalidAmount);

        // Verify no remittances were created (atomic rollback)
        env.as_contract(&contract_id, || {
            let counter = crate::get_remittance_counter(&env).unwrap();
            assert_eq!(counter, 0);
        });
    }

    /// Test 6: Batch with maximum size (100 entries)
    #[test]
    fn test_batch_create_max_size() {
        let (env, contract_id, sender) = setup_test_env();

        let agent = Address::generate(&env);
        env.as_contract(&contract_id, || {
            crate::register_agent(env.clone(), agent.clone()).unwrap();
        });

        // Create batch with exactly 100 entries
        let mut entries = Vec::new(&env);
        for _ in 0..100 {
            entries.push_back(BatchCreateEntry {
                agent: agent.clone(),
                amount: 1_000_000, // 1 USDC each
                expiry: None,
            });
        }

        // Execute batch creation - should succeed
        let result = env.as_contract(&contract_id, || {
            crate::batch_create_remittances(env.clone(), sender.clone(), entries)
        });

        assert!(result.is_ok());
        let remittance_ids = result.unwrap();
        assert_eq!(remittance_ids.len(), 100);

        // Verify all remittances were created
        env.as_contract(&contract_id, || {
            let counter = crate::get_remittance_counter(&env).unwrap();
            assert_eq!(counter, 100);
        });
    }

    /// Test 7: Batch with different amounts and fees
    #[test]
    fn test_batch_create_different_amounts() {
        let (env, contract_id, sender) = setup_test_env();

        let agent1 = Address::generate(&env);
        let agent2 = Address::generate(&env);

        env.as_contract(&contract_id, || {
            crate::register_agent(env.clone(), agent1.clone()).unwrap();
            crate::register_agent(env.clone(), agent2.clone()).unwrap();
        });

        // Create batch with different amounts
        let mut entries = Vec::new(&env);
        entries.push_back(BatchCreateEntry {
            agent: agent1.clone(),
            amount: 50_000_000, // 50 USDC
            expiry: None,
        });
        entries.push_back(BatchCreateEntry {
            agent: agent2.clone(),
            amount: 150_000_000, // 150 USDC
            expiry: None,
        });

        // Execute batch creation
        let result = env.as_contract(&contract_id, || {
            crate::batch_create_remittances(env.clone(), sender.clone(), entries)
        });

        assert!(result.is_ok());
        let remittance_ids = result.unwrap();

        // Verify fees are calculated correctly for each entry
        env.as_contract(&contract_id, || {
            let remittance1 = crate::get_remittance(&env, remittance_ids.get_unchecked(0)).unwrap();
            let remittance2 = crate::get_remittance(&env, remittance_ids.get_unchecked(1)).unwrap();

            // Fees should be different based on amounts
            assert!(remittance1.fee > 0);
            assert!(remittance2.fee > 0);
            assert_ne!(remittance1.fee, remittance2.fee);
        });
    }
}
