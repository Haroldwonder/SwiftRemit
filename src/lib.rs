#![no_std]

mod debug;
mod errors;
mod events;
mod storage;
mod types;
mod validation;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

pub use debug::*;
pub use errors::ContractError;
pub use events::*;
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

        set_admin(&env, &admin);
        set_usdc_token(&env, &usdc_token);
        set_platform_fee_bps(&env, fee_bps);
        set_remittance_counter(&env, 0);
        set_accumulated_fees(&env, 0);

        log_initialize(&env, &admin, &usdc_token, fee_bps);

        Ok(())
    }

    pub fn register_agent(env: Env, agent: Address) -> Result<(), ContractError> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        set_agent_registered(&env, &agent, true);
        emit_agent_registered(&env, agent.clone(), admin.clone());

        log_register_agent(&env, &agent);

        Ok(())
    }

    pub fn remove_agent(env: Env, agent: Address) -> Result<(), ContractError> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        set_agent_registered(&env, &agent, false);
        emit_agent_removed(&env, agent.clone(), admin.clone());

        log_remove_agent(&env, &agent);

        Ok(())
    }

    pub fn update_fee(env: Env, fee_bps: u32) -> Result<(), ContractError> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        if fee_bps > 10000 {
            return Err(ContractError::InvalidFeeBps);
        }

        set_platform_fee_bps(&env, fee_bps);
        let old_fee = get_platform_fee_bps(&env)?;
        emit_fee_updated(&env, admin.clone(), old_fee, fee_bps);

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
        let remittance_id = counter
            .checked_add(1)
            .ok_or(ContractError::Overflow)?;

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
        let admin = get_admin(&env)?;
        admin.require_auth();

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

        emit_fees_withdrawn(&env, admin.clone(), to.clone(), usdc_token.clone(), fees);

        log_withdraw_fees(&env, &to, fees);

        Ok(())
    }

    pub fn get_remittance(env: Env, remittance_id: u64) -> Result<Remittance, ContractError> {
        get_remittance(&env, remittance_id)
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

    /// Batch settle multiple remittances in a single transaction.
    /// 
    /// This function processes multiple settlement requests atomically - 
    /// either all succeed or all fail. This ensures data consistency and 
    /// reduces the number of transactions required.
    /// 
    /// # Arguments
    /// * `settlements` - Vector of BatchSettleEntry containing remittance IDs to settle
    /// 
    /// # Returns
    /// * `Vec<BatchSettleResult>` - Results for each settlement
    /// 
    /// # Errors
    /// Returns error if:
    /// * The batch is empty
    /// * Any entry fails validation
    /// * Any settlement fails during execution
    /// 
    /// # Notes
    /// - Uses snapshot-based atomic execution: validates all entries first,
    ///   then executes all at once to prevent partial state writes
    /// - Duplicate settlement detection is performed per entry
    /// - Expiry checks are performed for each remittance
    pub fn batch_settle(
        env: Env,
        settlements: Vec<BatchSettleEntry>,
    ) -> Result<Vec<BatchSettleResult>, ContractError> {
        // Check for empty batch
        if settlements.is_empty() {
            return Err(ContractError::BatchEmpty);
        }

        let batch_size = settlements.len();
        emit_batch_settlement_started(&env, batch_size);

        // Pre-validate all entries before execution (fail-fast approach)
        // This ensures atomic execution: all valid or all fail
        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        let mut validated_settlements: Vec<ValidatedSettlement> = Vec::new(&env);

        // Phase 1: Validate all entries
        for i in 0..settlements.len() {
            let entry = settlements.get(i).unwrap();
            
            // Fetch and validate remittance
            let remittance = match get_remittance(&env, entry.remittance_id) {
                Ok(r) => r,
                Err(_e) => {
                    emit_batch_settlement_failed(&env, i, entry.remittance_id, 6); // RemittanceNotFound
                    return Err(ContractError::BatchValidationFailed);
                }
            };

            // Validate status is Pending
            if remittance.status != RemittanceStatus::Pending {
                emit_batch_settlement_failed(&env, i, entry.remittance_id, 7); // InvalidStatus
                return Err(ContractError::BatchValidationFailed);
            }

            // Check for duplicate settlement
            if has_settlement_hash(&env, entry.remittance_id) {
                emit_batch_settlement_failed(&env, i, entry.remittance_id, 12); // DuplicateSettlement
                return Err(ContractError::BatchValidationFailed);
            }

            // Check for expiry
            if let Some(expiry_time) = remittance.expiry {
                let current_time = env.ledger().timestamp();
                if current_time > expiry_time {
                    emit_batch_settlement_failed(&env, i, entry.remittance_id, 11); // SettlementExpired
                    return Err(ContractError::BatchValidationFailed);
                }
            }

            // Validate agent address
            if let Err(_e) = validate_address(&remittance.agent) {
                emit_batch_settlement_failed(&env, i, entry.remittance_id, 10); // InvalidAddress
                return Err(ContractError::BatchValidationFailed);
            }

            // Calculate payout amount
            let payout_amount = match remittance.amount.checked_sub(remittance.fee) {
                Some(amt) => amt,
                None => {
                    emit_batch_settlement_failed(&env, i, entry.remittance_id, 8); // Overflow
                    return Err(ContractError::BatchValidationFailed);
                }
            };

            // Store validated data for execution phase
            validated_settlements.push_back(ValidatedSettlement {
                remittance_id: entry.remittance_id,
                agent: remittance.agent.clone(),
                payout_amount,
                fee: remittance.fee,
                sender: remittance.sender.clone(),
            });
        }

        // Phase 2: Execute all validated settlements (atomic commit)
        let mut results: Vec<BatchSettleResult> = Vec::new(&env);
        let mut success_count: u32 = 0;
        let mut total_payout: i128 = 0;

        for i in 0..validated_settlements.len() {
            let settlement = validated_settlements.get(i).unwrap();
            
            // Execute the transfer
            token_client.transfer(
                &env.current_contract_address(),
                &settlement.agent,
                &settlement.payout_amount,
            );

            // Update accumulated fees
            let current_fees = get_accumulated_fees(&env)?;
            let new_fees = current_fees
                .checked_add(settlement.fee)
                .ok_or(ContractError::Overflow)?;
            set_accumulated_fees(&env, new_fees);

            // Update remittance status
            let mut remittance = get_remittance(&env, settlement.remittance_id)?;
            remittance.status = RemittanceStatus::Completed;
            set_remittance(&env, settlement.remittance_id, &remittance);

            // Mark settlement as executed
            set_settlement_hash(&env, settlement.remittance_id);

            // Emit completion event
            emit_remittance_completed(&env, settlement.remittance_id, settlement.sender.clone(), settlement.agent.clone(), usdc_token.clone(), settlement.payout_amount);

            success_count += 1;
            total_payout = total_payout.checked_add(settlement.payout_amount).ok_or(ContractError::Overflow)?;

            results.push_back(BatchSettleResult {
                remittance_id: settlement.remittance_id,
                success: true,
                payout_amount: settlement.payout_amount,
            });
        }

        // Emit batch completion event
        emit_batch_settlement_completed(&env, batch_size, success_count, total_payout);

        log_batch_settle(&env, batch_size, success_count, total_payout);

        Ok(results)
    }
}
