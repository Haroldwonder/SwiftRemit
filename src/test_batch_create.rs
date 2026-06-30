//! Unit tests for batch remittance creation functionality.

#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

    use crate::{
        BatchCreateEntry, ContractError, RemittanceStatus, SwiftRemitContract,
        SwiftRemitContractClient,
    };

    fn setup(env: &Env) -> (SwiftRemitContractClient, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let token_addr = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract = SwiftRemitContractClient::new(
            env,
            &env.register_contract(None, SwiftRemitContract {}),
        );
        contract.initialize(&admin, &token_addr, &250, &0, &0, &admin);
        let agent = Address::generate(env);
        contract.register_agent(&agent, &None);
        (contract, admin, agent)
    }

    #[test]
    fn test_batch_create_success() {
        let env = Env::default();
        let (contract, _admin, _) = setup(&env);
        let sender = Address::generate(&env);

        let agent1 = Address::generate(&env);
        let agent2 = Address::generate(&env);
        let agent3 = Address::generate(&env);
        contract.register_agent(&agent1, &None);
        contract.register_agent(&agent2, &None);
        contract.register_agent(&agent3, &None);

        let mut entries = Vec::new(&env);
        entries.push_back(BatchCreateEntry { agent: agent1.clone(), amount: 100_000_000, expiry: None });
        entries.push_back(BatchCreateEntry { agent: agent2.clone(), amount: 200_000_000, expiry: Some(env.ledger().timestamp() + 3600) });
        entries.push_back(BatchCreateEntry { agent: agent3.clone(), amount: 150_000_000, expiry: None });

        let remittance_ids = contract.batch_create_remittances(&sender, &entries);
        assert_eq!(remittance_ids.len(), 3);

        let r1 = contract.get_remittance(&remittance_ids.get_unchecked(0));
        assert_eq!(r1.status, RemittanceStatus::Pending);
        assert_eq!(r1.sender, sender);
        assert_eq!(r1.agent, agent1);
        assert_eq!(r1.amount, 100_000_000);

        let r2 = contract.get_remittance(&remittance_ids.get_unchecked(1));
        assert_eq!(r2.agent, agent2);
        assert!(r2.expiry.is_some());

        let r3 = contract.get_remittance(&remittance_ids.get_unchecked(2));
        assert_eq!(r3.agent, agent3);
        assert_eq!(r3.amount, 150_000_000);
    }

    #[test]
    fn test_batch_create_partial_failure() {
        let env = Env::default();
        let (contract, _admin, _) = setup(&env);
        let sender = Address::generate(&env);

        let agent1 = Address::generate(&env);
        let agent2 = Address::generate(&env);
        let unregistered = Address::generate(&env);
        contract.register_agent(&agent1, &None);
        contract.register_agent(&agent2, &None);

        let mut entries = Vec::new(&env);
        entries.push_back(BatchCreateEntry { agent: agent1.clone(), amount: 100_000_000, expiry: None });
        entries.push_back(BatchCreateEntry { agent: unregistered.clone(), amount: 200_000_000, expiry: None });
        entries.push_back(BatchCreateEntry { agent: agent2.clone(), amount: 150_000_000, expiry: None });

        let result = contract.try_batch_create_remittances(&sender, &entries);
        assert_eq!(result, Err(Ok(ContractError::AgentNotRegistered)));
    }

    #[test]
    fn test_batch_create_oversized() {
        let env = Env::default();
        let (contract, _admin, agent) = setup(&env);
        let sender = Address::generate(&env);

        let mut entries = Vec::new(&env);
        for _ in 0..101 {
            entries.push_back(BatchCreateEntry { agent: agent.clone(), amount: 1_000_000, expiry: None });
        }

        let result = contract.try_batch_create_remittances(&sender, &entries);
        assert_eq!(result, Err(Ok(ContractError::InvalidBatchSize)));
    }

    #[test]
    fn test_batch_create_empty() {
        let env = Env::default();
        let (contract, _admin, _) = setup(&env);
        let sender = Address::generate(&env);

        let entries = Vec::new(&env);
        let result = contract.try_batch_create_remittances(&sender, &entries);
        assert_eq!(result, Err(Ok(ContractError::InvalidBatchSize)));
    }

    #[test]
    fn test_batch_create_invalid_amount() {
        let env = Env::default();
        let (contract, _admin, _) = setup(&env);
        let sender = Address::generate(&env);

        let agent1 = Address::generate(&env);
        let agent2 = Address::generate(&env);
        contract.register_agent(&agent1, &None);
        contract.register_agent(&agent2, &None);

        let mut entries = Vec::new(&env);
        entries.push_back(BatchCreateEntry { agent: agent1.clone(), amount: 100_000_000, expiry: None });
        entries.push_back(BatchCreateEntry { agent: agent2.clone(), amount: 0, expiry: None });

        let result = contract.try_batch_create_remittances(&sender, &entries);
        assert_eq!(result, Err(Ok(ContractError::InvalidAmount)));
    }

    #[test]
    fn test_batch_create_max_size() {
        let env = Env::default();
        let (contract, _admin, agent) = setup(&env);
        let sender = Address::generate(&env);

        let mut entries = Vec::new(&env);
        for _ in 0..100 {
            entries.push_back(BatchCreateEntry { agent: agent.clone(), amount: 1_000_000, expiry: None });
        }

        let remittance_ids = contract.batch_create_remittances(&sender, &entries);
        assert_eq!(remittance_ids.len(), 100);
    }

    #[test]
    fn test_batch_create_different_amounts() {
        let env = Env::default();
        let (contract, _admin, _) = setup(&env);
        let sender = Address::generate(&env);

        let agent1 = Address::generate(&env);
        let agent2 = Address::generate(&env);
        contract.register_agent(&agent1, &None);
        contract.register_agent(&agent2, &None);

        let mut entries = Vec::new(&env);
        entries.push_back(BatchCreateEntry { agent: agent1.clone(), amount: 50_000_000, expiry: None });
        entries.push_back(BatchCreateEntry { agent: agent2.clone(), amount: 150_000_000, expiry: None });

        let remittance_ids = contract.batch_create_remittances(&sender, &entries);
        let r1 = contract.get_remittance(&remittance_ids.get_unchecked(0));
        let r2 = contract.get_remittance(&remittance_ids.get_unchecked(1));

        assert!(r1.fee > 0);
        assert!(r2.fee > 0);
        assert_ne!(r1.fee, r2.fee);
    }
}
