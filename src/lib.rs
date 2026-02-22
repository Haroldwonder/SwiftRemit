//! SwiftRemit - A Soroban smart contract for cross-border remittance services.
//!
//! This contract enables secure, fee-based remittance transactions between senders and agents,
//! with built-in duplicate settlement protection and expiry mechanisms.

#![no_std]
mod debug;
mod error_handler;
mod errors;
mod events;
mod hashing;
mod migration;
mod netting;
mod rate_limit;
mod storage;
mod types;
mod validation;
#[cfg(test)]
mod test;

#[cfg(test)]
mod test; 

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

pub use debug::*;
pub use error_handler::*;
pub use errors::ContractError;
pub use events::*;
pub use hashing::*;
pub use migration::*;
pub use netting::*;
pub use rate_limit::*;
pub use storage::*;
pub use types::*;
pub use validation::*;

/// The main SwiftRemit contract for managing cross-border remittances.
///
/// This contract handles the complete lifecycle of remittance transactions including:
/// - Agent registration and management
/// - Remittance creation with automatic fee calculation
/// - Settlement confirmation with duplicate protection
/// - Cancellation and refund processing
/// - Platform fee collection and withdrawal
#[contract]
pub struct SwiftRemitContract;

#[contractimpl]
impl SwiftRemitContract {
    /// Initializes the contract with admin, token, and fee configuration.
    ///
    /// This function can only be called once. It sets up the contract's core parameters
    /// and initializes all counters and accumulators to zero.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `admin` - Address that will have administrative privileges
    /// * `usdc_token` - Address of the USDC token contract used for transactions
    /// * `fee_bps` - Platform fee in basis points (1 bps = 0.01%, max 10000 = 100%)
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Contract successfully initialized
    /// * `Err(ContractError::AlreadyInitialized)` - Contract was already initialized
    /// * `Err(ContractError::InvalidFeeBps)` - Fee exceeds maximum allowed (10000 bps)
    ///
    /// # Examples
    ///
    /// ```ignore
    /// contract.initialize(env, admin_addr, usdc_addr, 250); // 2.5% fee
    /// ```
    pub fn initialize(
        env: Env,
        admin: Address,
        usdc_token: Address,
        fee_bps: u32,
        rate_limit_cooldown: u64,
    ) -> Result<(), ContractError> {
        // Centralized validation before business logic
        validate_initialize_request(&env, &admin, &usdc_token, fee_bps)?;

        // Set legacy admin for backward compatibility
        set_admin(&env, &admin);
        
        // Initialize new admin role system
        set_admin_role(&env, &admin, true);
        set_admin_count(&env, 1);
        
        set_usdc_token(&env, &usdc_token);
        set_platform_fee_bps(&env, fee_bps);
        set_remittance_counter(&env, 0);
        set_accumulated_fees(&env, 0);
        set_rate_limit_cooldown(&env, rate_limit_cooldown);

        // Initialize rate limiting with default configuration
        init_rate_limit(&env);

        log_initialize(&env, &admin, &usdc_token, fee_bps);

        Ok(())
    }

    /// Registers a new agent authorized to receive remittance payouts.
    ///
    /// Only the contract admin can register agents. Registered agents can confirm
    /// payouts for remittances assigned to them.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `agent` - Address to register as an authorized agent
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Agent successfully registered
    /// * `Err(ContractError::NotInitialized)` - Contract not initialized
    ///
    /// # Authorization
    ///
    /// Requires authentication from the contract admin.
    pub fn register_agent(env: Env, agent: Address) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        set_agent_registered(&env, &agent, true);

        emit_agent_registered(&env, agent.clone(), caller.clone());

        
        // Event: Agent registered - Fires when admin adds a new agent to the approved list
        // Used by off-chain systems to track which addresses can confirm payouts
        emit_agent_registered(&env, agent, caller.clone());


        Ok(())
    }

    /// Removes an agent's authorization to receive remittance payouts.
    ///
    /// Only the contract admin can remove agents. Removed agents cannot confirm
    /// new payouts, but existing remittances assigned to them remain valid.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `agent` - Address of the agent to remove
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Agent successfully removed
    /// * `Err(ContractError::NotInitialized)` - Contract not initialized
    ///
    /// # Authorization
    ///
    /// Requires authentication from the contract admin.
    pub fn remove_agent(env: Env, agent: Address) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        set_agent_registered(&env, &agent, false);

        emit_agent_removed(&env, agent.clone(), caller.clone());

        
        // Event: Agent removed - Fires when admin removes an agent from the approved list
        // Used by off-chain systems to revoke payout confirmation privileges
        emit_agent_removed(&env, agent, caller.clone());


        Ok(())
    }

    /// Updates the platform fee rate.
    ///
    /// Only the contract admin can update the fee. The new fee applies to all
    /// remittances created after the update.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `fee_bps` - New platform fee in basis points (1 bps = 0.01%, max 10000 = 100%)
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Fee successfully updated
    /// * `Err(ContractError::NotInitialized)` - Contract not initialized
    /// * `Err(ContractError::InvalidFeeBps)` - Fee exceeds maximum allowed (10000 bps)
    ///
    /// # Authorization
    ///
    /// Requires authentication from the contract admin.
    pub fn update_fee(env: Env, fee_bps: u32) -> Result<(), ContractError> {
        // Centralized validation
        validate_update_fee_request(fee_bps)?;
        
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        let old_fee = get_platform_fee_bps(&env)?;
        set_platform_fee_bps(&env, fee_bps);
        emit_fee_updated(&env, caller.clone(), old_fee, fee_bps);

        log_update_fee(&env, fee_bps);

        Ok(())
    }

    /// Creates a new remittance transaction.
    ///
    /// Transfers the specified amount from the sender to the contract, calculates
    /// the platform fee, and creates a pending remittance record. The agent can later
    /// confirm the payout to receive the amount minus fees.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `sender` - Address initiating the remittance
    /// * `agent` - Address of the registered agent who will receive the payout
    /// * `amount` - Amount to remit in USDC (must be positive)
    /// * `expiry` - Optional expiry timestamp (seconds since epoch) after which settlement fails
    ///
    /// # Returns
    ///
    /// * `Ok(remittance_id)` - Unique ID of the created remittance
    /// * `Err(ContractError::InvalidAmount)` - Amount is zero or negative
    /// * `Err(ContractError::AgentNotRegistered)` - Specified agent is not registered
    /// * `Err(ContractError::Overflow)` - Arithmetic overflow in fee calculation
    /// * `Err(ContractError::NotInitialized)` - Contract not initialized
    ///
    /// # Authorization
    ///
    /// Requires authentication from the sender address.
   pub fn create_remittance(
    env: Env,
    sender: Address,
    agent: Address,
    amount: i128,
    expiry: Option<u64>,
) -> Result<u64, ContractError> {
    validate_create_remittance_request(&env, &sender, &agent, amount)?;

    sender.require_auth();

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

    Ok(remittance_id)  // ← capital O
}
    /// Confirms a remittance payout to the agent.
    ///
    /// Transfers the remittance amount (minus platform fee) to the agent and marks
    /// the remittance as completed. Includes duplicate settlement protection and
    /// expiry validation.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `remittance_id` - ID of the remittance to confirm
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Payout successfully confirmed and transferred
    /// * `Err(ContractError::RemittanceNotFound)` - Remittance ID does not exist
    /// * `Err(ContractError::InvalidStatus)` - Remittance is not in Pending status
    /// * `Err(ContractError::DuplicateSettlement)` - Settlement already executed
    /// * `Err(ContractError::SettlementExpired)` - Current time exceeds expiry timestamp
    /// * `Err(ContractError::InvalidAddress)` - Agent address validation failed
    /// * `Err(ContractError::Overflow)` - Arithmetic overflow in payout calculation
    ///
    /// # Authorization
    ///
    /// Requires authentication from the agent address assigned to the remittance.
    pub fn confirm_payout(env: Env, remittance_id: u64) -> Result<(), ContractError> {
        // Centralized validation before business logic
        let mut remittance = validate_confirm_payout_request(&env, remittance_id)?;

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

        // Check rate limit for sender
        check_rate_limit(&env, &remittance.sender)?;

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

        remittance.status = RemittanceStatus::Settled;
        set_remittance(&env, remittance_id, &remittance);

        // Mark settlement as executed to prevent duplicates
        set_settlement_hash(&env, remittance_id);
        
        // Update last settlement time for rate limiting
        let current_time = env.ledger().timestamp();
        set_last_settlement_time(&env, &remittance.sender, current_time);

        // Event: Remittance completed - Fires when agent confirms fiat payout and USDC is released
        // Used by off-chain systems to track successful settlements and update transaction status
        emit_remittance_completed(&env, remittance_id, remittance.sender.clone(), remittance.agent.clone(), usdc_token.clone(), payout_amount);
        
        // Event: Settlement completed - Fires with final executed settlement values
        // Used by off-chain systems for reconciliation and audit trails of completed transactions
        emit_settlement_completed(&env, remittance.sender.clone(), remittance.agent.clone(), usdc_token.clone(), payout_amount);

        log_confirm_payout(&env, remittance_id, payout_amount);

        Ok(remittance_id)
    }

    pub fn finalize_remittance(env: Env, caller: Address, remittance_id: u64) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        let mut remittance = get_remittance(&env, remittance_id)?;

        if !remittance.status.can_transition_to(&RemittanceStatus::Finalized) {
            return Err(ContractError::InvalidStateTransition);
        }

        remittance.status = RemittanceStatus::Finalized;
        set_remittance(&env, remittance_id, &remittance);

        Ok(())
    }

    /// Cancels a pending remittance and refunds the sender.
    ///
    /// Returns the full remittance amount to the sender and marks the remittance
    /// as cancelled. Can only be called by the original sender.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `remittance_id` - ID of the remittance to cancel
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Remittance successfully cancelled and refunded
    /// * `Err(ContractError::RemittanceNotFound)` - Remittance ID does not exist
    /// * `Err(ContractError::InvalidStatus)` - Remittance is not in Pending status
    ///
    /// # Authorization
    ///
    /// Requires authentication from the sender address who created the remittance.
    pub fn cancel_remittance(env: Env, remittance_id: u64) -> Result<(), ContractError> {
        // Centralized validation before business logic
        let mut remittance = validate_cancel_remittance_request(&env, remittance_id)?;

        remittance.sender.require_auth();

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(
            &env.current_contract_address(),
            &remittance.sender,
            &remittance.amount,
        );

        remittance.status = RemittanceStatus::Failed;
        set_remittance(&env, remittance_id, &remittance);

        // Event: Remittance cancelled - Fires when sender cancels a pending remittance and receives full refund
        // Used by off-chain systems to track cancellations and update transaction status
        emit_remittance_cancelled(&env, remittance_id, remittance.sender.clone(), remittance.agent.clone(), usdc_token.clone(), remittance.amount);

        log_cancel_remittance(&env, remittance_id);

        Ok(())
    }

    /// Withdraws accumulated platform fees to a specified address.
    ///
    /// Transfers all accumulated fees to the recipient address and resets the
    /// fee counter to zero. Only the contract admin can withdraw fees.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `to` - Address to receive the withdrawn fees
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Fees successfully withdrawn
    /// * `Err(ContractError::NotInitialized)` - Contract not initialized
    /// * `Err(ContractError::NoFeesToWithdraw)` - No fees available (balance is zero or negative)
    /// * `Err(ContractError::InvalidAddress)` - Recipient address validation failed
    ///
    /// # Authorization
    ///
    /// Requires authentication from the contract admin.
    pub fn withdraw_fees(env: Env, to: Address) -> Result<(), ContractError> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        remittance.status = RemittanceStatus::Failed;
        set_remittance(&env, remittance_id, &remittance);

        log_cancel_remittance(&env, remittance_id);

        Ok(())
    }

    pub fn withdraw_fees(env: Env, to: Address) -> Result<(), ContractError> {
        // Centralized validation before business logic
        let fees = validate_withdraw_fees_request(&env, &to)?;
        
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &to, &fees);

        set_accumulated_fees(&env, 0);

        // Event: Fees withdrawn - Fires when admin withdraws accumulated platform fees
        // Used by off-chain systems to track revenue collection and maintain financial records
        emit_fees_withdrawn(&env, caller.clone(), to.clone(), usdc_token.clone(), fees);

        log_withdraw_fees(&env, &to, fees);

        Ok(())
    }

    /// Retrieves a remittance record by ID.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `remittance_id` - ID of the remittance to retrieve
    ///
    /// # Returns
    ///
    /// * `Ok(Remittance)` - The remittance record
    /// * `Err(ContractError::RemittanceNotFound)` - Remittance ID does not exist
    pub fn get_remittance(env: Env, remittance_id: u64) -> Result<Remittance, ContractError> {
        get_remittance(&env, remittance_id)
    }


    pub fn get_accumulated_fees(env: Env) -> Result<i128, ContractError> {
        get_accumulated_fees(&env)
    }

    /// Checks if an address is registered as an agent.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `agent` - Address to check
    ///
    /// # Returns
    ///
    /// * `true` - Address is a registered agent
    /// * `false` - Address is not registered
    pub fn is_agent_registered(env: Env, agent: Address) -> bool {
        is_agent_registered(&env, &agent)
    }

    /// Retrieves the current platform fee rate.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    ///
    /// # Returns
    ///
    /// * `Ok(u32)` - Platform fee in basis points (1 bps = 0.01%)
    /// * `Err(ContractError::NotInitialized)` - Contract not initialized
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
        crate::storage::is_paused(&env)
    }
    
    pub fn update_rate_limit(env: Env, cooldown_seconds: u64) -> Result<(), ContractError> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        let old_cooldown = get_rate_limit_cooldown(&env)?;
        set_rate_limit_cooldown(&env, cooldown_seconds);
        
        emit_rate_limit_updated(&env, admin, old_cooldown, cooldown_seconds);

        Ok(())
    }
    
    pub fn get_rate_limit_cooldown(env: Env) -> Result<u64, ContractError> {
        get_rate_limit_cooldown(&env)
    }
    
    pub fn get_last_settlement_time(env: Env, sender: Address) -> Option<u64> {
        get_last_settlement_time(&env, &sender)
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
        let net_transfers = compute_net_settlements(&env, &remittances);

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
            remittance.status = RemittanceStatus::Settled;
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
        // Centralized validation
        validate_admin_operation(&env, &caller, &token)?;

        if is_token_whitelisted(&env, &token) {
            return Err(ContractError::TokenAlreadyWhitelisted);
        }

        set_token_whitelisted(&env, &token, true);
        
        // Event: Token whitelisted - Fires when admin adds a token to the approved list
        // Used by off-chain systems to track which tokens can be used for remittances
        emit_token_whitelisted(&env, caller.clone(), token.clone());
        log_whitelist_token(&env, &token);

        Ok(())
    }

    /// Remove a token from the whitelist. Only admins can call this.
    pub fn remove_whitelisted_token(env: Env, caller: Address, token: Address) -> Result<(), ContractError> {
        // Centralized validation
        validate_admin_operation(&env, &caller, &token)?;

        if !is_token_whitelisted(&env, &token) {
            return Err(ContractError::TokenNotWhitelisted);
        }

        set_token_whitelisted(&env, &token, false);
        
        // Event: Token removed - Fires when admin removes a token from the approved list
        // Used by off-chain systems to track which tokens are no longer accepted for remittances
        emit_token_removed(&env, caller.clone(), token.clone());
        log_remove_whitelisted_token(&env, &token);

        Ok(())
    }

    /// Check if a token is whitelisted.
    pub fn is_token_whitelisted(env: Env, token: Address) -> bool {
        is_token_whitelisted(&env, &token)
    }

    /// Update rate limit configuration. Only admins can call this.
    /// 
    /// # Parameters
    /// - `caller`: Admin address (must be authorized)
    /// - `max_requests`: Maximum number of requests allowed per window
    /// - `window_seconds`: Time window in seconds
    /// - `enabled`: Whether rate limiting is enabled
    /// 
    /// # Example
    /// ```ignore
    /// // Set rate limit to 50 requests per 30 seconds
    /// contract.update_rate_limit(&admin, 50, 30, true)?;
    /// ```
    pub fn update_rate_limit(
        env: Env,
        caller: Address,
        max_requests: u32,
        window_seconds: u64,
        enabled: bool,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;

        let config = RateLimitConfig {
            max_requests,
            window_seconds,
            enabled,
        };

        set_rate_limit_config(&env, config);

        log_update_rate_limit(&env, max_requests, window_seconds, enabled);

        Ok(())
    }

    /// Get current rate limit configuration
    /// 
    /// # Returns
    /// Tuple of (max_requests, window_seconds, enabled)
    pub fn get_rate_limit_config(env: Env) -> (u32, u64, bool) {
        let config = get_rate_limit_config(&env);
        (config.max_requests, config.window_seconds, config.enabled)
    }

    /// Get rate limit status for a specific address
    /// 
    /// # Parameters
    /// - `address`: Address to check
    /// 
    /// # Returns
    /// Tuple of (current_requests, max_requests, window_seconds)
    pub fn get_rate_limit_status(env: Env, address: Address) -> (u32, u32, u64) {
        get_rate_limit_status(&env, &address)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Migration Functions
    // ═══════════════════════════════════════════════════════════════════════════

    /// Export complete contract state for migration
    /// 
    /// Creates a cryptographically verified snapshot of all contract data including:
    /// - Instance storage (admin, token, fees, counters)
    /// - Persistent storage (remittances, agents, admins, settlement hashes)
    /// - Verification hash for integrity checking
    /// 
    /// # Security
    /// - Only callable by admin
    /// - Generates deterministic SHA-256 hash
    /// - Includes timestamp and ledger sequence for audit trail
    /// - Prevents tampering through cryptographic verification
    /// 
    /// # Returns
    /// MigrationSnapshot containing complete contract state
    /// 
    /// # Example
    /// ```ignore
    /// let snapshot = contract.export_migration_state(&admin)?;
    /// // Verify hash before using
    /// let verification = contract.verify_migration_snapshot(&snapshot)?;
    /// assert!(verification.valid);
    /// ```
    pub fn export_migration_state(
        env: Env,
        caller: Address,
    ) -> Result<MigrationSnapshot, ContractError> {
        require_admin(&env, &caller)?;
        migration::export_state(&env)
    }

    /// Import contract state from migration snapshot
    /// 
    /// Restores complete contract state from a verified snapshot including:
    /// - Cryptographic hash verification
    /// - Instance storage restoration
    /// - Persistent storage restoration
    /// - Replay protection
    /// 
    /// # Security
    /// - Only callable by admin
    /// - Verifies cryptographic hash before import
    /// - Prevents import if contract already initialized
    /// - Atomic operation (all or nothing)
    /// - No trust assumptions (cryptographically verified)
    /// 
    /// # Parameters
    /// - `caller`: Admin address (must be authorized)
    /// - `snapshot`: Complete migration snapshot to import
    /// 
    /// # Returns
    /// Ok(()) if import successful
    /// 
    /// # Errors
    /// - AlreadyInitialized: Contract already has data
    /// - InvalidMigrationHash: Hash verification failed
    /// - Unauthorized: Caller is not admin
    /// 
    /// # Example
    /// ```ignore
    /// // On new contract deployment
    /// let snapshot = get_snapshot_from_old_contract();
    /// contract.import_migration_state(&admin, snapshot)?;
    /// ```
    pub fn import_migration_state(
        env: Env,
        caller: Address,
        snapshot: MigrationSnapshot,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        migration::import_state(&env, snapshot)
    }

    /// Verify migration snapshot integrity without importing
    /// 
    /// Validates that a snapshot's cryptographic hash matches its contents.
    /// Useful for pre-import validation and auditing.
    /// 
    /// # Parameters
    /// - `snapshot`: Snapshot to verify
    /// 
    /// # Returns
    /// MigrationVerification with:
    /// - valid: Whether hash matches
    /// - expected_hash: Hash from snapshot
    /// - actual_hash: Computed hash
    /// - timestamp: Verification time
    /// 
    /// # Example
    /// ```ignore
    /// let snapshot = get_snapshot();
    /// let verification = contract.verify_migration_snapshot(&snapshot)?;
    /// if !verification.valid {
    ///     panic!("Snapshot integrity check failed!");
    /// }
    /// ```
    pub fn verify_migration_snapshot(
        env: Env,
        snapshot: MigrationSnapshot,
    ) -> MigrationVerification {
        migration::verify_snapshot(&env, &snapshot)
    }

    /// Export state in batches for large datasets
    /// 
    /// For contracts with many remittances, export in batches to avoid
    /// resource limits. Each batch includes its own hash for verification.
    /// 
    /// # Parameters
    /// - `caller`: Admin address (must be authorized)
    /// - `batch_number`: Which batch to export (0-indexed)
    /// - `batch_size`: Number of items per batch (max 100)
    /// 
    /// # Returns
    /// MigrationBatch containing subset of data with verification hash
    /// 
    /// # Example
    /// ```ignore
    /// // Export in batches of 50
    /// let batch0 = contract.export_migration_batch(&admin, 0, 50)?;
    /// let batch1 = contract.export_migration_batch(&admin, 1, 50)?;
    /// ```
    pub fn export_migration_batch(
        env: Env,
        caller: Address,
        batch_number: u32,
        batch_size: u32,
    ) -> Result<MigrationBatch, ContractError> {
        require_admin(&env, &caller)?;
        migration::export_batch(&env, batch_number, batch_size)
    }

    /// Import state from batch
    /// 
    /// Import a single batch of remittances with hash verification.
    /// Batches should be imported in order (0, 1, 2, ...) for consistency.
    /// 
    /// # Parameters
    /// - `caller`: Admin address (must be authorized)
    /// - `batch`: Batch to import with verification hash
    /// 
    /// # Returns
    /// Ok(()) if import successful
    /// 
    /// # Errors
    /// - InvalidMigrationHash: Batch hash verification failed
    /// - Unauthorized: Caller is not admin
    /// 
    /// # Example
    /// ```ignore
    /// let batch = get_batch_from_old_contract(0);
    /// contract.import_migration_batch(&admin, batch)?;
    /// ```
    pub fn import_migration_batch(
        env: Env,
        caller: Address,
        batch: MigrationBatch,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        migration::import_batch(&env, batch)
    }

    /// Sets the daily send limit for a specific currency-country pair.
    /// 
    /// # Parameters
    /// - `currency`: Currency code (e.g., "USD", "EUR")
    /// - `country`: Country code (e.g., "US", "UK")
    /// - `limit`: Maximum amount that can be sent in 24 hours
    /// 
    /// # Authorization
    /// Requires admin authentication
    /// 
    /// # Errors
    /// - InvalidAmount: If limit is negative
    /// - Unauthorized: If caller is not admin
    pub fn set_daily_limit(
        env: Env,
        currency: String,
        country: String,
        limit: i128,
    ) -> Result<(), ContractError> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        if limit < 0 {
            return Err(ContractError::InvalidAmount);
        }


        let currency = normalize_symbol(&env, &currency);
        let country = normalize_symbol(&env, &country);


        set_daily_limit(&env, &currency, &country, limit);

        Ok(())
    }

    /// Gets the configured daily send limit for a currency-country pair.
    /// 
    /// # Parameters
    /// - `currency`: Currency code (e.g., "USD", "EUR")
    /// - `country`: Country code (e.g., "US", "UK")
    /// 
    /// # Returns
    /// - `Some(DailyLimit)`: If a limit is configured
    /// - `None`: If no limit is configured (unlimited)
    pub fn get_daily_limit(env: Env, currency: String, country: String) -> Option<DailyLimit> {

    let currency = normalize_symbol(&env, &currency);
    let country = normalize_symbol(&env, &country);

        get_daily_limit(&env, &currency, &country)
    }
}
