use soroban_sdk::{contracttype, Address, Env};

use crate::{ContractError, Remittance, RemittanceStatus};

/// Transaction state for tracking and rollback
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TransactionState {
    /// Initial state - no operations performed
    Initial,
    /// User eligibility validated
    EligibilityValidated,
    /// KYC approval confirmed
    KycConfirmed,
    /// Soroban contract called successfully
    ContractCalled(u64),
    /// Anchor withdrawal/deposit initiated
    AnchorInitiated(u64),
    /// Transaction record stored
    RecordStored,
    /// Transaction completed successfully
    Completed,
    /// Transaction failed and rolled back
    RolledBack,
}

/// Transaction record for audit and tracking
#[contracttype]
#[derive(Clone, Debug)]
pub struct TransactionRecord {
    pub user: Address,
    pub agent: Address,
    pub amount: i128,
    pub remittance_id: Option<u64>,
    pub anchor_tx_id: Option<u64>,
    pub state: TransactionState,
    pub retry_count: u32,
    pub timestamp: u64,
}

/// Centralized transaction controller
pub struct TransactionController;

impl TransactionController {
    /// Maximum retry attempts for transient failures
    const MAX_RETRIES: u32 = 3;
    
    /// Retry delay in seconds
    const RETRY_DELAY_SECS: u64 = 5;

    /// Execute a complete transaction with validation, KYC, contract call, and anchor operations
    ///
    /// This is the main entry point for transaction processing. It orchestrates:
    /// 1. User eligibility validation
    /// 2. KYC approval confirmation
    /// 3. Soroban contract interaction
    /// 4. Anchor withdrawal/deposit initiation
    /// 5. Transaction record storage
    ///
    /// Handles partial failures with automatic rollback and retry logic.
    pub fn execute_transaction(
        env: &Env,
        user: Address,
        agent: Address,
        amount: i128,
        expiry: Option<u64>,
    ) -> Result<TransactionRecord, ContractError> {
        let mut record = TransactionRecord {
            user: user.clone(),
            agent: agent.clone(),
            amount,
            remittance_id: None,
            anchor_tx_id: None,
            state: TransactionState::Initial,
            retry_count: 0,
            timestamp: env.ledger().timestamp(),
        };

        // Execute with retry logic
        match Self::execute_with_retry(env, &mut record, expiry) {
            Ok(_) => {
                record.state = TransactionState::Completed;
                Ok(record)
            }
            Err(e) => {
                // Attempt rollback
                let _ = Self::rollback_transaction(env, &mut record);
                Err(e)
            }
        }
    }

    /// Execute transaction with automatic retry on transient failures
    fn execute_with_retry(
        env: &Env,
        record: &mut TransactionRecord,
        expiry: Option<u64>,
    ) -> Result<(), ContractError> {
        let mut last_error = ContractError::NotInitialized;

        for attempt in 0..=Self::MAX_RETRIES {
            record.retry_count = attempt;

            match Self::execute_transaction_steps(env, record, expiry) {
                Ok(_) => return Ok(()),
                Err(e) => {
                    last_error = e;
                    
                    // Don't retry on non-transient errors
                    if !Self::is_retryable_error(&e) {
                        return Err(e);
                    }

                    // Don't retry on last attempt
                    if attempt < Self::MAX_RETRIES {
                        // Wait before retry (simulated with timestamp check)
                        let retry_time = env.ledger().timestamp() + Self::RETRY_DELAY_SECS;
                        // In production, this would be handled by the calling service
                        // For now, we just track the retry count
                    }
                }
            }
        }

        Err(last_error)
    }

    /// Execute all transaction steps in sequence
    fn execute_transaction_steps(
        env: &Env,
        record: &mut TransactionRecord,
        expiry: Option<u64>,
    ) -> Result<(), ContractError> {
        // Step 1: Validate user eligibility
        Self::validate_eligibility(env, &record.user)?;
        record.state = TransactionState::EligibilityValidated;

        // Step 2: Confirm KYC approval
        Self::confirm_kyc(env, &record.user)?;
        record.state = TransactionState::KycConfirmed;

        // Step 3: Call Soroban contract to create remittance
        let remittance_id = Self::call_contract(
            env,
            &record.user,
            &record.agent,
            record.amount,
            expiry,
        )?;
        record.remittance_id = Some(remittance_id);
        record.state = TransactionState::ContractCalled(remittance_id);

        // Step 4: Initiate anchor withdrawal/deposit
        let anchor_tx_id = Self::initiate_anchor_operation(env, remittance_id, record.amount)?;
        record.anchor_tx_id = Some(anchor_tx_id);
        record.state = TransactionState::AnchorInitiated(anchor_tx_id);

        // Step 5: Store transaction record
        Self::store_transaction_record(env, record)?;
        record.state = TransactionState::RecordStored;

        Ok(())
    }

    /// Validate user eligibility for transactions
    fn validate_eligibility(env: &Env, user: &Address) -> Result<(), ContractError> {
        // Check if user is not blacklisted
        if crate::storage::is_user_blacklisted(env, user) {
            return Err(ContractError::UserBlacklisted);
        }

        // Check if user has sufficient balance (this would be checked by token contract)
        // Additional eligibility checks can be added here

        Ok(())
    }

    /// Confirm KYC approval status
    fn confirm_kyc(env: &Env, user: &Address) -> Result<(), ContractError> {
        // Check KYC status from storage
        if !crate::storage::is_kyc_approved(env, user) {
            return Err(ContractError::KycNotApproved);
        }

        // Verify KYC hasn't expired
        if crate::storage::is_kyc_expired(env, user) {
            return Err(ContractError::KycExpired);
        }

        Ok(())
    }

    /// Call Soroban contract to create remittance
    fn call_contract(
        env: &Env,
        sender: &Address,
        agent: &Address,
        amount: i128,
        expiry: Option<u64>,
    ) -> Result<u64, ContractError> {
        // Validate amount
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        // Check if agent is registered
        if !crate::storage::is_agent_registered(env, agent) {
            return Err(ContractError::AgentNotRegistered);
        }

        // Calculate fee
        let fee_bps = crate::storage::get_platform_fee_bps(env)?;
        let fee = amount
            .checked_mul(fee_bps as i128)
            .ok_or(ContractError::Overflow)?
            .checked_div(10000)
            .ok_or(ContractError::Overflow)?;

        // Transfer tokens to contract
        let usdc_token = crate::storage::get_usdc_token(env)?;
        let token_client = soroban_sdk::token::Client::new(env, &usdc_token);
        token_client.transfer(sender, &env.current_contract_address(), &amount);

        // Create remittance record
        let counter = crate::storage::get_remittance_counter(env)?;
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

        crate::storage::set_remittance(env, remittance_id, &remittance);
        crate::storage::set_remittance_counter(env, remittance_id);

        // Emit event
        crate::events::emit_remittance_created(
            env,
            remittance_id,
            sender.clone(),
            agent.clone(),
            amount,
            fee,
            0, // integrator_fee (not used in transaction controller)
        );

        Ok(remittance_id)
    }

    /// Initiate anchor withdrawal or deposit operation
    fn initiate_anchor_operation(
        env: &Env,
        remittance_id: u64,
        amount: i128,
    ) -> Result<u64, ContractError> {
        // Generate anchor transaction ID
        let anchor_tx_id = Self::generate_anchor_tx_id(env, remittance_id);

        // Store anchor transaction mapping
        crate::storage::set_anchor_transaction(env, anchor_tx_id, remittance_id)?;

        // In production, this would call the actual anchor API
        // For now, we just store the mapping and return the ID

        Ok(anchor_tx_id)
    }

    /// Store transaction record for audit trail
    fn store_transaction_record(
        env: &Env,
        record: &TransactionRecord,
    ) -> Result<(), ContractError> {
        if let Some(remittance_id) = record.remittance_id {
            crate::storage::set_transaction_record(env, remittance_id, record)?;
        }
        Ok(())
    }

    /// Rollback transaction on failure
    fn rollback_transaction(
        env: &Env,
        record: &mut TransactionRecord,
    ) -> Result<(), ContractError> {
        // Rollback based on current state
        match &record.state {
            TransactionState::RecordStored | TransactionState::AnchorInitiated(_) => {
                // Cancel anchor operation if initiated
                if let Some(anchor_tx_id) = record.anchor_tx_id {
                    let _ = Self::cancel_anchor_operation(env, anchor_tx_id);
                }
                // Fall through to cancel remittance
                Self::rollback_contract_call(env, record)?;
            }
            TransactionState::ContractCalled(_) => {
                Self::rollback_contract_call(env, record)?;
            }
            _ => {
                // No rollback needed for earlier states
            }
        }

        record.state = TransactionState::RolledBack;
        Ok(())
    }

    /// Rollback contract call by cancelling remittance
    fn rollback_contract_call(
        env: &Env,
        record: &TransactionRecord,
    ) -> Result<(), ContractError> {
        if let Some(remittance_id) = record.remittance_id {
            let mut remittance = crate::storage::get_remittance(env, remittance_id)?;

            // Only cancel if still pending
            if remittance.status == RemittanceStatus::Pending {
                // Refund tokens
                let usdc_token = crate::storage::get_usdc_token(env)?;
                let token_client = soroban_sdk::token::Client::new(env, &usdc_token);
                token_client.transfer(
                    &env.current_contract_address(),
                    &remittance.sender,
                    &remittance.amount,
                );

                // Update status
                remittance.status = RemittanceStatus::Cancelled;
                crate::storage::set_remittance(env, remittance_id, &remittance);

                // Emit event
                crate::events::emit_remittance_cancelled(
                    env,
                    remittance_id,
                    remittance.sender,
                    remittance.agent,
                    usdc_token,
                    remittance.amount,
                );
            }
        }

        Ok(())
    }

    /// Cancel anchor operation
    fn cancel_anchor_operation(env: &Env, anchor_tx_id: u64) -> Result<(), ContractError> {
        // In production, this would call the anchor API to cancel
        // For now, we just remove the mapping
        crate::storage::remove_anchor_transaction(env, anchor_tx_id)?;
        Ok(())
    }

    /// Check if error is retryable
    fn is_retryable_error(error: &ContractError) -> bool {
        matches!(
            error,
            ContractError::Overflow | ContractError::NotInitialized
        )
    }

    /// Generate anchor transaction ID
    fn generate_anchor_tx_id(env: &Env, remittance_id: u64) -> u64 {
        // Simple ID generation based on remittance ID and timestamp
        let timestamp = env.ledger().timestamp();
        remittance_id
            .wrapping_mul(1000000)
            .wrapping_add(timestamp)
    }

    /// Get transaction status
    pub fn get_transaction_status(
        env: &Env,
        remittance_id: u64,
    ) -> Result<TransactionRecord, ContractError> {
        crate::storage::get_transaction_record(env, remittance_id)
    }

    /// Retry failed transaction
    pub fn retry_transaction(
        env: &Env,
        remittance_id: u64,
    ) -> Result<TransactionRecord, ContractError> {
        let mut record = Self::get_transaction_status(env, remittance_id)?;

        // Only retry if in failed state
        if record.state != TransactionState::RolledBack {
            return Err(ContractError::InvalidStatus);
        }

        // Reset state and retry
        record.state = TransactionState::Initial;
        record.retry_count = 0;

        Self::execute_with_retry(env, &mut record, None)?;
        record.state = TransactionState::Completed;

        Ok(record)
    }
}
