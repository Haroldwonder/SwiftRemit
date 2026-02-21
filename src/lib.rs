#![no_std]
mod debug;
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

use soroban_sdk::{contract, contractimpl, token, Address, Env, String, Vec};

pub use debug::*;
pub use errors::ContractError;
pub use events::*;
pub use hashing::*;
pub use migration::*;
pub use netting::*;
pub use rate_limit::*;
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

        // Initialize rate limiting with default configuration
        init_rate_limit(&env);

        log_initialize(&env, &admin, &usdc_token, fee_bps);

        Ok(())
    }

    pub fn add_admin(env: Env, caller: Address, new_admin: Address) -> Result<(), ContractError> {
        // Centralized validation
        validate_admin_operation(&env, &caller, &new_admin)?;

        if is_admin(&env, &new_admin) {
            return Err(ContractError::AdminAlreadyExists);
        }

        set_admin_role(&env, &new_admin, true);
        
        let count = get_admin_count(&env);
        set_admin_count(&env, count + 1);

        // Event: Admin added - Fires when an existing admin adds a new admin to the system
        // Used by off-chain systems to track admin role assignments and access control changes
        emit_admin_added(&env, caller.clone(), new_admin.clone());
        
        log_add_admin(&env, &caller, &new_admin);

        Ok(())
    }

    pub fn remove_admin(env: Env, caller: Address, admin_to_remove: Address) -> Result<(), ContractError> {
        // Centralized validation
        validate_admin_operation(&env, &caller, &admin_to_remove)?;

        if !is_admin(&env, &admin_to_remove) {
            return Err(ContractError::AdminNotFound);
        }

        let count = get_admin_count(&env);
        if count <= 1 {
            return Err(ContractError::CannotRemoveLastAdmin);
        }

        set_admin_role(&env, &admin_to_remove, false);
        set_admin_count(&env, count - 1);

        // Event: Admin removed - Fires when an admin removes another admin from the system
        // Used by off-chain systems to track admin role revocations and access control changes
        emit_admin_removed(&env, caller.clone(), admin_to_remove.clone());
        
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

        
        // Event: Agent registered - Fires when admin adds a new agent to the approved list
        // Used by off-chain systems to track which addresses can confirm payouts
        emit_agent_registered(&env, agent, caller.clone());


        Ok(())
    }

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

    pub fn create_remittance(
        env: Env,
        sender: Address,
        agent: Address,
        amount: i128,
        expiry: Option<u64>,
    ) -> Result<u64, ContractError> {
        // Centralized validation before business logic
        validate_create_remittance_request(&env, &sender, &agent, amount)?;
        
        sender.require_auth();

        let fee_bps = get_platform_fee_bps(&env)?;
        let fee = amount
            .checked_mul(fee_bps as i128)
            .ok_or(ContractError::Overflow)?
            .checked_div(10000)
            .ok_or(ContractError::Overflow)?;

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

    pub fn confirm_payout(env: Env, remittance_id: u64) -> Result<(), ContractError> {
        // Centralized validation before business logic
        let mut remittance = validate_confirm_payout_request(&env, remittance_id)?;

        remittance.agent.require_auth();

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

    pub fn fail_remittance(env: Env, caller: Address, remittance_id: u64) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        let mut remittance = get_remittance(&env, remittance_id)?;

        if !remittance.status.can_transition_to(&RemittanceStatus::Failed) {
            return Err(ContractError::InvalidStateTransition);
        }

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(
            &env.current_contract_address(),
            &remittance.sender,
            &remittance.amount,
        );

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

    pub fn simulate_settlement(env: Env, remittance_id: u64) -> SettlementSimulation {
        // Check if paused
        if is_paused(&env) {
            return SettlementSimulation {
                would_succeed: false,
                payout_amount: 0,
                fee: 0,
                error_message: Some(ContractError::ContractPaused as u32),
            };
        }

        // Get remittance
        let remittance = match get_remittance(&env, remittance_id) {
            Ok(r) => r,
            Err(e) => {
                return SettlementSimulation {
                    would_succeed: false,
                    payout_amount: 0,
                    fee: 0,
                    error_message: Some(e as u32),
                };
            }
        };

        // Check status
        if remittance.status != RemittanceStatus::Pending {
            return SettlementSimulation {
                would_succeed: false,
                payout_amount: 0,
                fee: remittance.fee,
                error_message: Some(ContractError::InvalidStatus as u32),
            };
        }

        // Check for duplicate settlement
        if has_settlement_hash(&env, remittance_id) {
            return SettlementSimulation {
                would_succeed: false,
                payout_amount: 0,
                fee: remittance.fee,
                error_message: Some(ContractError::DuplicateSettlement as u32),
            };
        }

        // Check expiry
        if let Some(expiry_time) = remittance.expiry {
            let current_time = env.ledger().timestamp();
            if current_time > expiry_time {
                return SettlementSimulation {
                    would_succeed: false,
                    payout_amount: 0,
                    fee: remittance.fee,
                    error_message: Some(ContractError::SettlementExpired as u32),
                };
            }
        }

        // Validate agent address
        if let Err(e) = validate_address(&remittance.agent) {
            return SettlementSimulation {
                would_succeed: false,
                payout_amount: 0,
                fee: remittance.fee,
                error_message: Some(e as u32),
            };
        }

        // Calculate payout amount
        let payout_amount = match remittance.amount.checked_sub(remittance.fee) {
            Some(amount) => amount,
            None => {
                return SettlementSimulation {
                    would_succeed: false,
                    payout_amount: 0,
                    fee: remittance.fee,
                    error_message: Some(ContractError::Overflow as u32),
                };
            }
        };

        // Success case
        SettlementSimulation {
            would_succeed: true,
            payout_amount,
            fee: remittance.fee,
            error_message: None,
        }
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
        
        // Event: Paused - Fires when admin pauses the contract to prevent new payouts
        // Used by off-chain systems to halt operations during emergencies or maintenance
        emit_paused(&env, caller);

        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        set_paused(&env, false);
        
        // Event: Unpaused - Fires when admin resumes contract operations after pause
        // Used by off-chain systems to resume normal payout processing
        emit_unpaused(&env, caller);

        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        crate::storage::is_paused(&env)
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
}

#[contractimpl]
impl SwiftRemitContract {
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
        get_daily_limit(&env, &currency, &country)
    }
}
