#![no_std]
mod debug;
mod errors;
mod events;
mod hashing;
mod netting;
mod storage;
mod types;
mod validation;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

pub use debug::*;
pub use errors::ContractError;
pub use events::*;
pub use hashing::*;
pub use netting::*;
pub use storage::*;
pub use types::*;
pub use validation::*;

#[contract]
pub struct SwiftRemitContract;

#[contractimpl]
impl SwiftRemitContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        usdc_token: Address,
        fee_bps: u32,
    ) -> Result<(), ContractError> {
        if has_admin(&env) {
            return Err(ContractError::AlreadyInitialized);
        }

        if fee_bps > 10000 {
            return Err(ContractError::InvalidFeeBps);
        }

        // Check if token is whitelisted
        if !is_token_whitelisted(&env, &usdc_token) {
            return Err(ContractError::TokenNotWhitelisted);
        }

        // Set legacy admin for backward compatibility
        set_admin(&env, &admin);
        
        // Initialize new admin role system
        set_admin_role(&env, &admin, true);
        set_admin_count(&env, 1);
        
        set_usdc_token(&env, &usdc_token);
        set_platform_fee_bps(&env, fee_bps);
        set_remittance_counter(&env, 0);
        set_accumulated_fees(&env, 0);

        log_initialize(&env, &admin, &usdc_token, fee_bps);

        Ok(())
    }

    pub fn add_admin(env: Env, caller: Address, new_admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;

        if is_admin(&env, &new_admin) {
            return Err(ContractError::AdminAlreadyExists);
        }

        set_admin_role(&env, &new_admin, true);
        
        let count = get_admin_count(&env);
        set_admin_count(&env, count + 1);

        log_add_admin(&env, &caller, &new_admin);

        Ok(())
    }

    pub fn remove_admin(env: Env, caller: Address, admin_to_remove: Address) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;

        if !is_admin(&env, &admin_to_remove) {
            return Err(ContractError::AdminNotFound);
        }

        let count = get_admin_count(&env);
        if count <= 1 {
            return Err(ContractError::CannotRemoveLastAdmin);
        }

        set_admin_role(&env, &admin_to_remove, false);
        set_admin_count(&env, count - 1);

        log_remove_admin(&env, &caller, &admin_to_remove);

        Ok(())
    }

    pub fn is_admin(env: Env, address: Address) -> bool {
        is_admin(&env, &address)
    }

    pub fn register_agent(env: Env, agent: Address) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        set_agent_registered(&env, &agent, true);
        emit_agent_registered(&env, agent.clone(), caller.clone());

        Ok(())
    }

    pub fn remove_agent(env: Env, agent: Address) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        set_agent_registered(&env, &agent, false);
        emit_agent_removed(&env, agent.clone(), caller.clone());

        Ok(())
    }

    pub fn update_fee(env: Env, fee_bps: u32) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        if fee_bps > 10000 {
            return Err(ContractError::InvalidFeeBps);
        }

        set_platform_fee_bps(&env, fee_bps);
        let old_fee = get_platform_fee_bps(&env)?;
        emit_fee_updated(&env, caller.clone(), old_fee, fee_bps);

        log_update_fee(&env, fee_bps);

        Ok(())
    }

    pub fn create_remittance(
        env: Env,
        sender: Address,
        agent: Address,
        amount: i128,
        expiry: Option<u64>,
    ) -> Result<u64, ContractError> {
        sender.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        if !is_agent_registered(&env, &agent) {
            return Err(ContractError::AgentNotRegistered);
        }

        let fee_bps = get_platform_fee_bps(&env)?;
        let fee = amount
            .checked_mul(fee_bps as i128)
            .ok_or(ContractError::Overflow)?
            .checked_div(10000)
            .ok_or(ContractError::Overflow)?;

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        let counter = get_remittance_counter(&env)?;
        let remittance_id = counter.checked_add(1).ok_or(ContractError::Overflow)?;

        let remittance = Remittance {
            id: remittance_id,
            sender: sender.clone(),
            agent: agent.clone(),
            amount,
            fee,
            status: RemittanceStatus::Pending,
            expiry,
        };

        set_remittance(&env, remittance_id, &remittance);
        set_remittance_counter(&env, remittance_id);

        emit_remittance_created(&env, remittance_id, sender.clone(), agent.clone(), usdc_token.clone(), amount, fee);

        log_create_remittance(&env, remittance_id, &sender, &agent, amount, fee);

        Ok(remittance_id)
    }

    pub fn confirm_payout(env: Env, remittance_id: u64) -> Result<(), ContractError> {
        if is_paused(&env) {
            return Err(ContractError::ContractPaused);
        }

        let mut remittance = get_remittance(&env, remittance_id)?;

        remittance.agent.require_auth();

        if remittance.status != RemittanceStatus::Pending {
            return Err(ContractError::InvalidStatus);
        }

        // Check for duplicate settlement execution
        if has_settlement_hash(&env, remittance_id) {
            return Err(ContractError::DuplicateSettlement);
        }

        // Check if settlement has expired
        if let Some(expiry_time) = remittance.expiry {
            let current_time = env.ledger().timestamp();
            if current_time > expiry_time {
                return Err(ContractError::SettlementExpired);
            }
        }

        // Validate the agent address before transfer
        validate_address(&remittance.agent)?;

        let payout_amount = remittance
            .amount
            .checked_sub(remittance.fee)
            .ok_or(ContractError::Overflow)?;

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(
            &env.current_contract_address(),
            &remittance.agent,
            &payout_amount,
        );

        let current_fees = get_accumulated_fees(&env)?;
        let new_fees = current_fees
            .checked_add(remittance.fee)
            .ok_or(ContractError::Overflow)?;
        set_accumulated_fees(&env, new_fees);

        remittance.status = RemittanceStatus::Completed;
        set_remittance(&env, remittance_id, &remittance);

        // Mark settlement as executed to prevent duplicates
        set_settlement_hash(&env, remittance_id);

        emit_remittance_completed(&env, remittance_id, remittance.sender.clone(), remittance.agent.clone(), usdc_token.clone(), payout_amount);
        
        // Emit settlement completed event with final executed values
        emit_settlement_completed(&env, remittance.sender.clone(), remittance.agent.clone(), usdc_token.clone(), payout_amount);

        log_confirm_payout(&env, remittance_id, payout_amount);

        Ok(())
    }

    pub fn cancel_remittance(env: Env, remittance_id: u64) -> Result<(), ContractError> {
        let mut remittance = get_remittance(&env, remittance_id)?;

        remittance.sender.require_auth();

        if remittance.status != RemittanceStatus::Pending {
            return Err(ContractError::InvalidStatus);
        }

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(
            &env.current_contract_address(),
            &remittance.sender,
            &remittance.amount,
        );

        remittance.status = RemittanceStatus::Cancelled;
        set_remittance(&env, remittance_id, &remittance);

        emit_remittance_cancelled(&env, remittance_id, remittance.sender.clone(), remittance.agent.clone(), usdc_token.clone(), remittance.amount);

        log_cancel_remittance(&env, remittance_id);

        Ok(())
    }

    pub fn withdraw_fees(env: Env, to: Address) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        // Validate the recipient address
        validate_address(&to)?;

        let fees = get_accumulated_fees(&env)?;

        if fees <= 0 {
            return Err(ContractError::NoFeesToWithdraw);
        }

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &to, &fees);

        set_accumulated_fees(&env, 0);

        emit_fees_withdrawn(&env, caller.clone(), to.clone(), usdc_token.clone(), fees);

        log_withdraw_fees(&env, &to, fees);

        Ok(())
    }

    pub fn get_remittance(env: Env, remittance_id: u64) -> Result<Remittance, ContractError> {
        get_remittance(&env, remittance_id)
    }

    pub fn get_settlement(env: Env, id: u64) -> Result<Remittance, ContractError> {
        get_remittance(&env, id)
    }

    pub fn get_accumulated_fees(env: Env) -> Result<i128, ContractError> {
        get_accumulated_fees(&env)
    }

    pub fn is_agent_registered(env: Env, agent: Address) -> bool {
        is_agent_registered(&env, &agent)
    }

    pub fn get_platform_fee_bps(env: Env) -> Result<u32, ContractError> {
        get_platform_fee_bps(&env)
    }

    pub fn pause(env: Env) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        set_paused(&env, true);
        emit_paused(&env, caller);

        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        set_paused(&env, false);
        emit_unpaused(&env, caller);

        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_version(env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    /// Batch settle multiple remittances with net settlement optimization.
    /// 
    /// This function processes multiple remittances in a single transaction and applies
    /// net settlement logic to offset opposing transfers between the same parties.
    /// Only the net difference is executed on-chain, reducing total token transfers.
    /// 
    /// # Benefits
    /// - Reduces on-chain transfer count by offsetting opposing flows
    /// - Preserves all fees and accounting integrity
    /// - Deterministic and order-independent results
    /// - Gas-efficient batch processing
    /// 
    /// # Example
    /// If batch contains:
    /// - Remittance 1: A -> B: 100 USDC (fee: 2)
    /// - Remittance 2: B -> A: 90 USDC (fee: 1.8)
    /// 
    /// Result: Single transfer of 10 USDC from A to B, total fees: 3.8
    /// 
    /// # Parameters
    /// - `entries`: Vector of BatchSettlementEntry containing remittance IDs to settle
    /// 
    /// # Returns
    /// BatchSettlementResult with list of successfully settled remittance IDs
    /// 
    /// # Errors
    /// - ContractPaused: Contract is in paused state
    /// - InvalidAmount: Batch size exceeds MAX_BATCH_SIZE or is empty
    /// - RemittanceNotFound: One or more remittance IDs don't exist
    /// - InvalidStatus: One or more remittances are not in Pending status
    /// - DuplicateSettlement: Duplicate remittance IDs in batch
    /// - Overflow: Arithmetic overflow in calculations
    pub fn batch_settle_with_netting(
        env: Env,
        entries: Vec<BatchSettlementEntry>,
    ) -> Result<BatchSettlementResult, ContractError> {
        if is_paused(&env) {
            return Err(ContractError::ContractPaused);
        }

        // Validate batch size
        let batch_size = entries.len();
        if batch_size == 0 {
            return Err(ContractError::InvalidAmount);
        }
        if batch_size > MAX_BATCH_SIZE {
            return Err(ContractError::InvalidAmount);
        }

        // Load all remittances and validate
        let mut remittances = Vec::new(&env);
        let mut seen_ids = Vec::new(&env);

        for i in 0..batch_size {
            let entry = entries.get_unchecked(i);
            let remittance_id = entry.remittance_id;

            // Check for duplicate IDs in batch
            for j in 0..seen_ids.len() {
                if seen_ids.get_unchecked(j) == remittance_id {
                    return Err(ContractError::DuplicateSettlement);
                }
            }
            seen_ids.push_back(remittance_id);

            // Load and validate remittance
            let remittance = get_remittance(&env, remittance_id)?;

            // Verify remittance is pending
            if remittance.status != RemittanceStatus::Pending {
                return Err(ContractError::InvalidStatus);
            }

            // Check for duplicate settlement execution
            if has_settlement_hash(&env, remittance_id) {
                return Err(ContractError::DuplicateSettlement);
            }

            // Check expiry
            if let Some(expiry_time) = remittance.expiry {
                let current_time = env.ledger().timestamp();
                if current_time > expiry_time {
                    return Err(ContractError::SettlementExpired);
                }
            }

            // Validate addresses
            validate_address(&remittance.agent)?;

            remittances.push_back(remittance);
        }

        // Compute net settlements
        let net_transfers = compute_net_settlements(&remittances);

        // Validate net settlement calculations
        validate_net_settlement(&remittances, &net_transfers)?;

        // Execute net transfers
        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);

        for i in 0..net_transfers.len() {
            let transfer = net_transfers.get_unchecked(i);

            // Determine actual sender and recipient based on net_amount sign
            let (from, to, amount) = if transfer.net_amount > 0 {
                // Positive: party_a -> party_b
                (transfer.party_a.clone(), transfer.party_b.clone(), transfer.net_amount)
            } else if transfer.net_amount < 0 {
                // Negative: party_b -> party_a
                (transfer.party_b.clone(), transfer.party_a.clone(), -transfer.net_amount)
            } else {
                // Zero: complete offset, no transfer needed
                continue;
            };

            // Calculate payout amount (net amount minus fees)
            let payout_amount = amount
                .checked_sub(transfer.total_fees)
                .ok_or(ContractError::Overflow)?;

            // Execute the net transfer from contract to recipient
            // Note: The sender's funds are already in the contract from create_remittance
            token_client.transfer(
                &env.current_contract_address(),
                &to,
                &payout_amount,
            );

            // Accumulate fees
            let current_fees = get_accumulated_fees(&env)?;
            let new_fees = current_fees
                .checked_add(transfer.total_fees)
                .ok_or(ContractError::Overflow)?;
            set_accumulated_fees(&env, new_fees);

            // Emit settlement event
            emit_settlement_completed(&env, from, to, usdc_token.clone(), payout_amount);
        }

        // Mark all remittances as completed and set settlement hashes
        let mut settled_ids = Vec::new(&env);

        for i in 0..remittances.len() {
            let mut remittance = remittances.get_unchecked(i);
            remittance.status = RemittanceStatus::Completed;
            set_remittance(&env, remittance.id, &remittance);
            set_settlement_hash(&env, remittance.id);
            settled_ids.push_back(remittance.id);

            // Emit individual remittance completion event
            let payout_amount = remittance
                .amount
                .checked_sub(remittance.fee)
                .ok_or(ContractError::Overflow)?;
            emit_remittance_completed(
                &env,
                remittance.id,
                remittance.sender.clone(),
                remittance.agent.clone(),
                usdc_token.clone(),
                payout_amount,
            );
        }

        Ok(BatchSettlementResult { settled_ids })
    }

    /// Add a token to the whitelist. Only admins can call this.
    pub fn whitelist_token(env: Env, caller: Address, token: Address) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;

        if is_token_whitelisted(&env, &token) {
            return Err(ContractError::TokenAlreadyWhitelisted);
        }

        set_token_whitelisted(&env, &token, true);
        emit_token_whitelisted(&env, caller.clone(), token.clone());
        log_whitelist_token(&env, &token);

        Ok(())
    }

    /// Remove a token from the whitelist. Only admins can call this.
    pub fn remove_whitelisted_token(env: Env, caller: Address, token: Address) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;

        if !is_token_whitelisted(&env, &token) {
            return Err(ContractError::TokenNotWhitelisted);
        }

        set_token_whitelisted(&env, &token, false);
        emit_token_removed(&env, caller.clone(), token.clone());
        log_remove_whitelisted_token(&env, &token);

        Ok(())
    }

    /// Check if a token is whitelisted.
    pub fn is_token_whitelisted(env: Env, token: Address) -> bool {
        is_token_whitelisted(&env, &token)
    }
}
