//! SwiftRemit - A Soroban smart contract for cross-border remittance services.
// Initial commit: project setup and contract scaffolding
//!
//! This contract enables secure, fee-based remittance transactions between senders and agents,
//! with built-in duplicate settlement protection and expiry mechanisms.

#![no_std]
mod abuse_protection;
mod asset_verification;
mod config;
mod debug;
mod error_handler;
mod errors;
mod events;
mod fee_management;
mod fee_service;
mod fee_strategy;
mod hashing;
mod health;
#[cfg(test)]
mod health_test;
mod migration;
mod netting;
mod rate_limit;
mod storage;
pub mod circuit_breaker;
pub mod circuit_breaker_storage;
#[cfg(all(test, feature = "legacy-tests"))]
mod test;
#[cfg(test)]
mod test_batch_create;
#[cfg(test)]
mod test_coverage_gaps;
#[cfg(test)]
mod test_blacklist;
#[cfg(test)]
mod test_escrow;
#[cfg(test)]
mod test_fee_corridor;
#[cfg(test)]
mod test_fee_strategy;
#[cfg(test)]
mod test_fee_overflow;
#[cfg(test)]
mod test_integrator_fees;
#[cfg(test)]
mod test_limits_and_proof;
#[cfg(test)]
mod test_migration;
#[cfg(test)]
mod test_agent_migration;
#[cfg(test)]
mod test_property;
#[cfg(test)]
mod test_protocol_fee;
#[cfg(test)]
mod test_roles;
#[cfg(test)]
mod test_roles_simple;
#[cfg(test)]
mod test_token_whitelist;
#[cfg(test)]
mod test_transfer_state;
#[cfg(test)]
mod test_transitions;
#[cfg(test)]
mod test_treasury;
#[cfg(all(test, feature = "testnet-integration"))]
mod test_testnet_integration;
mod transaction_controller;
mod transitions;
mod types;
mod validation;
mod verification;
mod recipient_verification;
#[cfg(test)]
mod test_recipient_verification;
mod governance;
#[cfg(test)]
mod test_governance;
#[cfg(test)]
mod test_governance_property;

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env, String, Vec};

pub use abuse_protection::*;
pub use asset_verification::*;
pub use config::*;
pub use debug::*;
pub use error_handler::*;
pub use errors::ContractError;
pub use events::*;
pub use fee_management::*;
pub use fee_service::*;
pub use fee_strategy::*;
pub use hashing::*;
pub use migration::*;
pub use netting::*;
pub use rate_limit::*;
pub use storage::*;
pub use transaction_controller::*;
pub use transitions::*;
pub use recipient_verification::{
    RecipientDetails, WalletRecipient, BankRecipient, RecipientHashRecord,
    RecipientHashMigrationEntry, VerificationOutcome,
    RECIPIENT_HASH_SCHEMA_VERSION, compute_recipient_hash,
};
pub use types::*;
pub use validation::*;
pub use verification::*;

fn enforce_daily_send_limit(
    env: &Env,
    sender: &Address,
    currency: &String,
    country: &String,
    amount: i128,
) -> Result<(), ContractError> {
    let now = env.ledger().timestamp();
    let window_start = now.saturating_sub(DAILY_LIMIT_WINDOW_SECONDS);

    let transfers = get_user_transfers(env, sender);
    let mut pruned = Vec::new(env);
    let mut rolling_total: i128 = 0;

    for i in 0..transfers.len() {
        let record = transfers.get_unchecked(i);
        if record.timestamp > window_start {
            if record.currency == *currency && record.country == *country {
                rolling_total = rolling_total
                    .checked_add(record.amount)
                    .ok_or(ContractError::Overflow)?;
            }
            pruned.push_back(record);
        }
    }

    if let Some(limit_cfg) = get_daily_limit(env, currency, country) {
        let next_total = rolling_total
            .checked_add(amount)
            .ok_or(ContractError::Overflow)?;
        if next_total > limit_cfg.limit {
            return Err(ContractError::DailySendLimitExceeded);
        }
    }

    pruned.push_back(TransferRecord {
        timestamp: now,
        amount,
        currency: currency.clone(),
        country: country.clone(),
    });
    set_user_transfers(env, sender, &pruned);

    Ok(())
}

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

// ============================================================================
// Configuration Constants
// ============================================================================
//
// These constants define validation limits and calculation parameters.
// They are intentionally hardcoded in the contract to ensure consistent
// on-chain behavior across all deployments.
//
// MAX_FEE_BPS: Maximum allowed fee in basis points (100% = 10000 bps)
// - This limit prevents accidentally setting fees above 100%
// - Used in initialize() and update_fee() for validation
// - Value: 10000 (represents 100%)
//
// FEE_DIVISOR: Divisor for converting basis points to actual fee amount
// - Formula: fee_amount = amount * fee_bps / FEE_DIVISOR
// - Used in create_remittance() for fee calculation
// - Value: 10000 (basis points scale)
//
// Configurable Values at Deployment:
// - initial fee_bps: Set during initialize(), can be any value 0-10000
//   This value can be configured via the INITIAL_FEE_BPS environment variable
//   in deployment scripts (deploy.sh, deploy.ps1)
//
// Runtime Configurable Values:
// - fee_bps: Can be updated by admin via update_fee()
// ============================================================================

#[contractimpl]
impl SwiftRemitContract {
    fn set_blacklist_status(
        env: &Env,
        user: Address,
        blacklisted: bool,
    ) -> Result<(), ContractError> {
        let caller = get_admin(env)?;
        require_admin(env, &caller)?;

        set_user_blacklisted(env, &user, blacklisted);

        if blacklisted {
            emit_user_blacklisted(env, user, caller);
        } else {
            emit_user_removed_from_blacklist(env, user, caller);
        }

        Ok(())
    }

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
        protocol_fee_bps: u32,
        treasury: Address,
    ) -> Result<(), ContractError> {
        // Centralized validation before business logic
        validate_initialize_request(&env, &admin, &usdc_token, fee_bps)?;

        // Set legacy admin for backward compatibility
        set_admin(&env, &admin);

        // Initialize new admin role system
        set_admin_role(&env, &admin, true);
        set_admin_count(&env, 1);

        // Assign Admin role to initial admin
        assign_role(&env, &admin, &Role::Admin);

        set_usdc_token(&env, &usdc_token);
        set_token_whitelisted(&env, &usdc_token, true);
        set_platform_fee_bps(&env, fee_bps);
        set_token_fee_bps(&env, &usdc_token, fee_bps)?;
        set_fee_strategy(&env, &FeeStrategy::Percentage(fee_bps));
        set_remittance_counter(&env, 0);
        set_accumulated_fees(&env, 0);
        set_rate_limit_cooldown(&env, rate_limit_cooldown);
        set_escrow_counter(&env, 0);
        set_escrow_ttl(&env, 0);

        // Initialize protocol fee and treasury
        set_protocol_fee_bps(&env, protocol_fee_bps)?;
        set_treasury(&env, &treasury);

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
    pub fn register_agent(env: Env, agent: Address, kyc_hash: Option<soroban_sdk::BytesN<32>>) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        set_agent_registered(&env, &agent, true);
        assign_role(&env, &agent, &Role::Settler);

        if let Some(ref hash) = kyc_hash {
            set_agent_kyc_hash(&env, &agent, hash);
        }

        // Event: Agent registered - Fires when admin adds a new agent to the approved list
        // Used by off-chain systems to track which addresses can confirm payouts
        emit_agent_registered(&env, agent, caller, kyc_hash);

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
        remove_role(&env, &agent, &Role::Settler);

        // Event: Agent removed - Fires when admin removes an agent from the approved list
        // Used by off-chain systems to revoke payout confirmation privileges
        emit_agent_removed(&env, agent, caller);

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

        set_platform_fee_bps(&env, fee_bps);
        set_fee_strategy(&env, &FeeStrategy::Percentage(fee_bps));
        emit_fee_updated(&env, fee_bps);

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
        token: Option<Address>,
        idempotency_key: Option<String>,
        settlement_config: Option<SettlementConfig>,
        recipient_hash: Option<BytesN<32>>,
    ) -> Result<u64, ContractError> {
        if crate::storage::is_migration_in_progress(&env) {
            return Err(ContractError::MigrationInProgress);
        }
        validate_create_remittance_request(&env, &sender, &agent, amount)?;

        let token_address = token.unwrap_or_else(|| get_usdc_token(&env).unwrap());
        if !is_token_whitelisted(&env, &token_address) {
            return Err(ContractError::TokenNotWhitelisted);
        }

        sender.require_auth();

        let default_currency = String::from_str(&env, DEFAULT_DAILY_LIMIT_CURRENCY);
        let default_country = String::from_str(&env, DEFAULT_DAILY_LIMIT_COUNTRY);
        enforce_daily_send_limit(&env, &sender, &default_currency, &default_country, amount)?;

        // Validate settlement config
        if let Some(ref config) = settlement_config {
            if config.require_proof && config.oracle_address.is_none() {
                return Err(ContractError::InvalidOracleAddress);
            }
        }

        // Check idempotency if key provided
        if let Some(ref key) = idempotency_key {
            if let Some(record) = storage::get_idempotency_record(&env, key) {
                // Key exists and not expired - verify payload matches
                let request_hash =
                    hashing::compute_request_hash(&env, &sender, &agent, amount, expiry);
                if request_hash != record.request_hash {
                    return Err(ContractError::IdempotencyConflict);
                }
                // Same key and payload - return existing remittance_id
                return Ok(record.remittance_id);
            }
        }

        // Use centralized fee service with sender-specific rolling volume discounts.
        let fee = fee_service::calculate_platform_fee_for_sender(
            &env,
            &sender,
            amount,
            Some(&token_address),
        )?;

        let token_client = token::Client::new(&env, &token_address);
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
            settlement_config: settlement_config.clone().into(),
            token: token_address.clone(),
            created_at: env.ledger().timestamp(),
            failed_at: None,
            dispute_evidence: MaybeBytes32::None,
        };

        let payout_commitment = compute_payout_commitment(&env, &remittance);

        set_remittance(&env, remittance_id, &remittance);
        set_payout_commitment(&env, remittance_id, &payout_commitment);
        set_remittance_counter(&env, remittance_id);
        storage::record_sender_volume(&env, &sender, amount, env.ledger().timestamp())?;

        // Store recipient hash if provided (Task 7.1)
        if let Some(ref hash) = recipient_hash {
            recipient_verification::store_recipient_hash(&env, remittance_id, hash)?;
        }

        // Increment analytics counter
        storage::increment_remittance_count(&env)?;

        // Index this remittance under the sender for paginated queries
        storage::append_sender_remittance(&env, &sender, remittance_id);
        // Set initial transfer state
        set_transfer_state(&env, remittance_id, RemittanceStatus::Pending)?;

        // Store idempotency record if key provided
        if let Some(key) = idempotency_key {
            let request_hash = hashing::compute_request_hash(&env, &sender, &agent, amount, expiry);
            let ttl = storage::get_idempotency_ttl(&env);
            let expires_at = env
                .ledger()
                .timestamp()
                .checked_add(ttl)
                .ok_or(ContractError::Overflow)?;

            let record = IdempotencyRecord {
                key: key.clone(),
                request_hash,
                remittance_id,
                expires_at,
            };
            storage::set_idempotency_record(&env, &key, &record);
            storage::set_remittance_idempotency_key(&env, remittance_id, &key);
        }

        Ok(remittance_id)
    }

    /// Creates a remittance using corridor-specific fees when available.
    ///
    /// If a corridor is configured for the given country pair, its fee strategy
    /// is used instead of the global strategy. Falls back to global if not found.
    pub fn create_remittance_with_corridor(
        env: Env,
        sender: Address,
        agent: Address,
        amount: i128,
        expiry: Option<u64>,
        from_country: Option<String>,
        to_country: Option<String>,
    ) -> Result<u64, ContractError> {
        validate_create_remittance_request(&env, &sender, &agent, amount)?;

        sender.require_auth();

        let limit_currency = String::from_str(&env, DEFAULT_DAILY_LIMIT_CURRENCY);
        let limit_country = to_country
            .clone()
            .unwrap_or_else(|| String::from_str(&env, DEFAULT_DAILY_LIMIT_COUNTRY));
        enforce_daily_send_limit(&env, &sender, &limit_currency, &limit_country, amount)?;

        let corridor = match (&from_country, &to_country) {
            (Some(from), Some(to)) => storage::get_fee_corridor(&env, from, to),
            _ => None,
        };
        let fee = fee_service::calculate_fees_with_breakdown_for_sender(
            &env,
            &sender,
            amount,
            Some(&get_usdc_token(&env)?),
            corridor.as_ref(),
        )?
        .platform_fee;

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
            settlement_config: MaybeSettlementConfig::None,
            token: usdc_token.clone(),
            created_at: env.ledger().timestamp(),
            failed_at: None,
            dispute_evidence: MaybeBytes32::None,
        };

        let payout_commitment = compute_payout_commitment(&env, &remittance);

        set_remittance(&env, remittance_id, &remittance);
        set_payout_commitment(&env, remittance_id, &payout_commitment);
        set_remittance_counter(&env, remittance_id);
        set_transfer_state(&env, remittance_id, RemittanceStatus::Pending)?;
        storage::record_sender_volume(&env, &sender, amount, env.ledger().timestamp())?;

        Ok(remittance_id)
    }

    /// Creates multiple remittances in a single atomic batch operation.
    ///
    /// This function allows high-volume senders to create multiple remittances
    /// at once, reducing transaction costs by batching the token transfer.
    /// All entries are validated before any state changes occur.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `sender` - Address of the sender initiating the batch
    /// * `entries` - Vector of BatchCreateEntry structs containing remittance details
    ///
    /// # Returns
    ///
    /// * `Ok(Vec<u64>)` - Vector of created remittance IDs
    /// * `Err(ContractError)` - If any entry fails validation or batch size exceeds limit
    ///
    /// # Errors
    ///
    /// * `ContractError::InvalidBatchSize` - Batch is empty or exceeds MAX_BATCH_SIZE (100)
    /// * `ContractError::InvalidAmount` - Any entry has zero or negative amount
    /// * `ContractError::AgentNotRegistered` - Any agent is not registered
    /// * `ContractError::UserBlacklisted` - Sender is blacklisted
    /// * `ContractError::DailySendLimitExceeded` - Total amount exceeds daily limit
    /// * `ContractError::Overflow` - Arithmetic overflow in amount calculation
    ///
    /// # Authorization
    ///
    /// Requires authentication from the sender address.
    pub fn batch_create_remittances(
        env: Env,
        sender: Address,
        entries: Vec<BatchCreateEntry>,
    ) -> Result<Vec<u64>, ContractError> {
        if crate::storage::is_migration_in_progress(&env) {
            return Err(ContractError::MigrationInProgress);
        }

        // Validate batch size
        let batch_size = entries.len();
        if batch_size == 0 || batch_size > MAX_BATCH_SIZE {
            return Err(ContractError::InvalidBatchSize);
        }

        sender.require_auth();

        // Validate all entries before any state changes
        let mut total_amount: i128 = 0;
        for i in 0..batch_size {
            let entry = entries.get_unchecked(i);
            validate_create_remittance_request(&env, &sender, &entry.agent, entry.amount)?;

            // Check daily limit for each entry
            let default_currency = String::from_str(&env, DEFAULT_DAILY_LIMIT_CURRENCY);
            let default_country = String::from_str(&env, DEFAULT_DAILY_LIMIT_COUNTRY);
            enforce_daily_send_limit(
                &env,
                &sender,
                &default_currency,
                &default_country,
                entry.amount,
            )?;

            // Accumulate total amount
            total_amount = total_amount
                .checked_add(entry.amount)
                .ok_or(ContractError::Overflow)?;
        }

        // Transfer total amount in a single token transfer
        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&sender, &env.current_contract_address(), &total_amount);

        // Create all remittances
        let mut remittance_ids = Vec::new(&env);
        let mut counter = get_remittance_counter(&env)?;
        let prior_volume = storage::get_sender_rolling_volume(&env, &sender, env.ledger().timestamp());
        let mut cumulative_volume = prior_volume;

        for i in 0..batch_size {
            let entry = entries.get_unchecked(i);
            counter = counter.checked_add(1).ok_or(ContractError::Overflow)?;
            let remittance_id = counter;

            // Calculate fee for this entry using the sender's rolling volume and batch cumulative amount.
            let total_volume = cumulative_volume
                .checked_add(entry.amount)
                .ok_or(ContractError::Overflow)?;
            let fee = fee_service::calculate_platform_fee_for_volume(
                &env,
                entry.amount,
                Some(&usdc_token),
                total_volume,
            )?;
            cumulative_volume = total_volume;

            let remittance = Remittance {
                id: remittance_id,
                sender: sender.clone(),
                agent: entry.agent.clone(),
                amount: entry.amount,
                fee,
                status: RemittanceStatus::Pending,
                expiry: entry.expiry,
                settlement_config: MaybeSettlementConfig::None,
                token: usdc_token.clone(),
                created_at: env.ledger().timestamp(),
                failed_at: None,
                dispute_evidence: MaybeBytes32::None,
            };

            let payout_commitment = compute_payout_commitment(&env, &remittance);

            set_remittance(&env, remittance_id, &remittance);
            set_payout_commitment(&env, remittance_id, &payout_commitment);
            set_transfer_state(&env, remittance_id, RemittanceStatus::Pending)?;

            // Persist the sender's volume history for future discount calculations.
            storage::record_sender_volume(&env, &sender, entry.amount, env.ledger().timestamp())?;

            // Index this remittance under the sender for paginated queries
            storage::append_sender_remittance(&env, &sender, remittance_id);

            remittance_ids.push_back(remittance_id);
        }

        // Update counter once at the end
        set_remittance_counter(&env, counter);

        Ok(remittance_ids)
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
    /// Requires Settler role.
    pub fn confirm_payout(
        env: Env,
        remittance_id: u64,
        proof: Option<soroban_sdk::BytesN<32>>,
        recipient_details_hash: Option<BytesN<32>>,
    ) -> Result<(), ContractError> {
        if crate::storage::is_migration_in_progress(&env) {
            return Err(ContractError::MigrationInProgress);
        }
        // Centralized validation before business logic (returns remittance to avoid re-read)
        let mut remittance = validate_confirm_payout_request(&env, remittance_id)?;

        // Validate that the assigned agent is registered and authenticated before any payout execution.
        crate::storage::require_agent_authorized(&env, &remittance.agent)?;

        // Require Settler role
        require_role_settler(&env, &remittance.agent)?;

        if let MaybeSettlementConfig::Some(config) = remittance.settlement_config.clone() {
            if config.require_proof {
                let submitted_proof = proof.ok_or(ContractError::MissingProof)?;
                let expected = get_payout_commitment(&env, remittance_id)
                    .ok_or(ContractError::InvalidProof)?;
                if !verify_proof_commitment(&submitted_proof, &expected) {
                    return Err(ContractError::InvalidProof);
                }
            }
        }

        // Transition to Processing state
        crate::transitions::transition_status(&env, &mut remittance, RemittanceStatus::Processing)?;

        // Verify recipient hash before any token transfer (Task 7.2)
        recipient_verification::verify_recipient_hash(
            &env,
            remittance_id,
            &remittance.agent,
            recipient_details_hash,
        )?;

        // Update Agent Stats
        let mut stats = crate::storage::get_agent_stats(&env, &remittance.agent);
        stats.total_settlements += 1;
        stats.total_settlement_time += env
            .ledger()
            .timestamp()
            .saturating_sub(remittance.created_at);
        crate::storage::set_agent_stats(&env, &remittance.agent, &stats);

        // Check rate limit for sender
        check_settlement_rate_limit(&env, &remittance.sender)?;

        // Enforce per-agent daily withdrawal cap
        storage::check_and_record_agent_withdrawal(&env, &remittance.agent, remittance.amount)?;

        // Use centralized fee service to get complete breakdown
        let fee_breakdown = fee_service::calculate_fees_with_breakdown(
            &env,
            remittance.amount,
            None, // No corridor specified
            None, // No corridor config
        )?;

        // Verify stored fee matches calculated platform fee
        if remittance.fee != fee_breakdown.platform_fee {
            return Err(ContractError::InvalidAmount);
        }

        let payout_amount = fee_breakdown.net_amount;
        let protocol_fee = fee_breakdown.protocol_fee;

        let remittance_token = remittance.token.clone();
        let current_fees = get_accumulated_fees(&env)?;
        let current_time = env.ledger().timestamp();

        let token_client = token::Client::new(&env, &remittance_token);

        // Transfer payout to agent
        token_client.transfer(
            &env.current_contract_address(),
            &remittance.agent,
            &payout_amount,
        );

        // Transfer protocol fee to treasury if needed
        if protocol_fee > 0 {
            let treasury = get_treasury(&env)?;
            token_client.transfer(&env.current_contract_address(), &treasury, &protocol_fee);
        }

        // Update accumulated fees with overflow protection and automatic flush
        safe_add_accumulated_fee(&env, remittance.fee)?;

        // Update analytics: add completed volume
        storage::add_completed_volume(&env, remittance.amount)?;

        // Update remittance status via validated transition
        crate::transitions::transition_status(&env, &mut remittance, RemittanceStatus::Completed)?;
        set_remittance(&env, remittance_id, &remittance);

        // Mark settlement as executed to prevent duplicates
        set_settlement_hash(&env, remittance_id);

        // Update last settlement time for rate limiting
        set_last_settlement_time(&env, &remittance.sender, current_time);

        // Event: Remittance completed - Fires when agent confirms fiat payout and USDC is released
        // Used by off-chain systems to track successful settlements and update transaction status
        emit_remittance_completed(
            &env,
            remittance_id,
            remittance.sender.clone(),
            remittance.agent.clone(),
        );

        // Event: Settlement completed - Fires with final executed settlement values
        // Used by off-chain systems for reconciliation and audit trails of completed transactions
        emit_settlement_completed(
            &env,
            remittance_id,
            remittance.sender,
            remittance.agent,
            remittance_token,
            payout_amount,
        );

        log_confirm_payout(&env, remittance_id, payout_amount);

        // Cleanup: remove idempotency record on terminal state (Completed)
        if let Some(idem_key) = storage::take_remittance_idempotency_key(&env, remittance_id) {
            storage::remove_idempotency_record(&env, &idem_key);
        }

        Ok(())
    }

    pub fn mark_failed(env: Env, remittance_id: u64) -> Result<(), ContractError> {
        let mut remittance = get_remittance(&env, remittance_id)?;
        crate::storage::require_agent_authorized(&env, &remittance.agent)?;

        if remittance.status != RemittanceStatus::Pending
            && remittance.status != RemittanceStatus::Processing
        {
            return Err(ContractError::InvalidStatus);
        }

        remittance.status = RemittanceStatus::Failed;
        remittance.failed_at = Some(env.ledger().timestamp());
        set_remittance(&env, remittance_id, &remittance);

        let mut stats = crate::storage::get_agent_stats(&env, &remittance.agent);
        stats.failed_settlements += 1;
        crate::storage::set_agent_stats(&env, &remittance.agent, &stats);

        emit_remittance_failed(&env, remittance_id, remittance.agent);
        Ok(())
    }

    pub fn raise_dispute(
        env: Env,
        remittance_id: u64,
        evidence_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        let mut remittance = get_remittance(&env, remittance_id)?;
        remittance.sender.require_auth();

        if remittance.status != RemittanceStatus::Failed {
            return Err(ContractError::InvalidStatus);
        }

        let failed_at = remittance.failed_at.ok_or(ContractError::InvalidStatus)?;
        let window = get_dispute_window(&env);
        if env.ledger().timestamp() > failed_at + window {
            return Err(ContractError::DisputeWindowExpired);
        }

        remittance.status = RemittanceStatus::Disputed;
        remittance.dispute_evidence = MaybeBytes32::Some(evidence_hash.clone());
        set_remittance(&env, remittance_id, &remittance);

        let mut stats = crate::storage::get_agent_stats(&env, &remittance.agent);
        stats.dispute_count += 1;
        crate::storage::set_agent_stats(&env, &remittance.agent, &stats);

        emit_dispute_raised(&env, remittance_id, remittance.sender, evidence_hash);
        Ok(())
    }

    pub fn resolve_dispute(
        env: Env,
        remittance_id: u64,
        in_favour_of_sender: bool,
    ) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        let mut remittance = get_remittance(&env, remittance_id)?;
        if remittance.status != RemittanceStatus::Disputed {
            return Err(ContractError::NotDisputed);
        }

        let token_client = token::Client::new(&env, &remittance.token);
        if in_favour_of_sender {
            token_client.transfer(
                &env.current_contract_address(),
                &remittance.sender,
                &remittance.amount,
            );
            remittance.status = RemittanceStatus::Cancelled;
        } else {
            let fee_breakdown = fee_service::calculate_fees_with_breakdown(
                &env,
                remittance.amount,
                Some(&remittance.token),
                None,
            )?;
            token_client.transfer(
                &env.current_contract_address(),
                &remittance.agent,
                &fee_breakdown.net_amount,
            );
            remittance.status = RemittanceStatus::Completed;
        }

        set_remittance(&env, remittance_id, &remittance);
        emit_dispute_resolved(&env, remittance_id, in_favour_of_sender);
        Ok(())
    }

    /// Sets the dispute window duration (admin only).
    ///
    /// Senders have this many seconds after a payout is marked Failed to raise a dispute.
    pub fn set_dispute_window(env: Env, seconds: u64) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;
        storage::set_dispute_window(&env, seconds);
        Ok(())
    }

    /// Returns the current dispute window in seconds.
    pub fn get_dispute_window(env: Env) -> u64 {
        storage::get_dispute_window(&env)
    }

    /// Confirms a partial payout for a remittance, disbursing `amount` to the agent.
    ///
    /// Large remittances can be split into multiple disbursements. Each call transfers
    /// `amount` from escrow to the agent. When the total disbursed equals the net payout
    /// (amount - fee), the remittance is automatically marked Completed.
    ///
    /// # Authorization
    /// Requires authentication from the agent assigned to the remittance.
    pub fn confirm_partial_payout(
        env: Env,
        remittance_id: u64,
        amount: i128,
    ) -> Result<(), ContractError> {
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let mut remittance = get_remittance(&env, remittance_id)?;
        crate::storage::require_agent_authorized(&env, &remittance.agent)?;

        if remittance.status != RemittanceStatus::Pending
            && remittance.status != RemittanceStatus::Processing
        {
            return Err(ContractError::InvalidStatus);
        }

        // Enforce per-agent daily cap
        storage::check_and_record_agent_withdrawal(&env, &remittance.agent, amount)?;

        let fee_breakdown = fee_service::calculate_fees_with_breakdown(&env, remittance.amount, None, None)?;
        let net_payout = fee_breakdown.net_amount;

        let already_disbursed = storage::get_disbursed_amount(&env, remittance_id);
        let remaining = net_payout
            .checked_sub(already_disbursed)
            .ok_or(ContractError::Underflow)?;

        if amount > remaining {
            return Err(ContractError::InvalidAmount);
        }

        // Move to Processing on first partial disbursement
        if remittance.status == RemittanceStatus::Pending {
            crate::transitions::transition_status(&env, &mut remittance, RemittanceStatus::Processing)?;
        }

        let token_client = token::Client::new(&env, &remittance.token);
        token_client.transfer(&env.current_contract_address(), &remittance.agent, &amount);

        storage::add_disbursed_amount(&env, remittance_id, amount)?;
        let new_total = already_disbursed.checked_add(amount).ok_or(ContractError::Overflow)?;

        emit_partial_payout(&env, remittance_id, remittance.agent.clone(), amount, new_total);

        // If fully disbursed, collect fee and complete
        if new_total >= net_payout {
            // Update accumulated fees with overflow protection and automatic flush
            safe_add_accumulated_fee(&env, remittance.fee)?;

            storage::add_completed_volume(&env, remittance.amount)?;

            crate::transitions::transition_status(&env, &mut remittance, RemittanceStatus::Completed)?;
            set_remittance(&env, remittance_id, &remittance);
            set_settlement_hash(&env, remittance_id);

            emit_remittance_completed(&env, remittance_id, remittance.sender, remittance.agent);
        } else {
            set_remittance(&env, remittance_id, &remittance);
        }

        Ok(())
    }

    /// Sets a per-agent daily withdrawal cap (admin only).
    ///
    /// The agent may not withdraw more than `cap` USDC in any rolling 24-hour window.
    /// Set `cap` to 0 to remove the cap.
    pub fn set_agent_daily_cap(env: Env, agent: Address, cap: i128) -> Result<(), ContractError> {
        if cap < 0 {
            return Err(ContractError::InvalidAmount);
        }
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;
        storage::set_agent_daily_cap(&env, &agent, cap);
        emit_agent_cap_set(&env, agent, cap, caller);
        Ok(())
    }

    /// Returns the per-agent daily withdrawal cap (0 = no cap).
    pub fn get_agent_daily_cap(env: Env, agent: Address) -> i128 {
        storage::get_agent_daily_cap(&env, &agent)
    }

    pub fn get_agent_stats(env: Env, agent: Address) -> AgentStats {
        crate::storage::get_agent_stats(&env, &agent)
    }

    pub fn get_agent_reputation(env: Env, agent: Address) -> u32 {
        let stats = crate::storage::get_agent_stats(&env, &agent);
        crate::storage::compute_agent_reputation(&stats)
    }

    pub fn finalize_remittance(
        env: Env,
        caller: Address,
        remittance_id: u64,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        let remittance = get_remittance(&env, remittance_id)?;

        // Verify remittance is in a valid state (Completed)
        if remittance.status != RemittanceStatus::Completed {
            return Err(ContractError::InvalidStateTransition);
        }

        // Remittance is already completed, no further action needed
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
        // Centralized validation before business logic (returns remittance to avoid re-read)
        let mut remittance = validate_cancel_remittance_request(&env, remittance_id)?;

        remittance.sender.require_auth();

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(
            &env.current_contract_address(),
            &remittance.sender,
            &remittance.amount,
        );

        // Transition to Cancelled state via validated transition
        crate::transitions::transition_status(&env, &mut remittance, RemittanceStatus::Cancelled)?;
        set_remittance(&env, remittance_id, &remittance);

        // Event: Remittance cancelled - Fires when sender cancels a pending remittance and receives full refund
        // Used by off-chain systems to track cancellations and update transaction status
        emit_remittance_cancelled(
            &env,
            remittance_id,
            remittance.sender,
            remittance.agent,
            usdc_token,
            remittance.amount,
        );

        log_cancel_remittance(&env, remittance_id);

        // Cleanup: remove idempotency record on terminal state (Cancelled)
        if let Some(idem_key) = storage::take_remittance_idempotency_key(&env, remittance_id) {
            storage::remove_idempotency_record(&env, &idem_key);
        }

        Ok(())
    }

    /// Refunds expired pending remittances in batch.
    ///
    /// Callable by anyone. Each provided remittance ID is processed independently:
    /// only remittances that are both Pending and expired are cancelled and refunded.
    /// Non-existent, non-pending, or non-expired remittances are skipped.
    pub fn process_expired_remittances(
        env: Env,
        remittance_ids: Vec<u64>,
    ) -> Result<Vec<u64>, ContractError> {
        if remittance_ids.len() > get_max_expired_batch_size(&env) {
            return Err(ContractError::InvalidBatchSize);
        }

        let now = env.ledger().timestamp();
        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);

        let mut processed_ids = Vec::new(&env);

        for i in 0..remittance_ids.len() {
            let remittance_id = remittance_ids.get_unchecked(i);
            let mut remittance = match get_remittance(&env, remittance_id) {
                Ok(value) => value,
                Err(_) => continue,
            };

            if remittance.status != RemittanceStatus::Pending {
                continue;
            }

            let is_expired = match remittance.expiry {
                Some(expiry) => now > expiry,
                None => false,
            };

            if !is_expired {
                continue;
            }

            token_client.transfer(
                &env.current_contract_address(),
                &remittance.sender,
                &remittance.amount,
            );

            crate::transitions::transition_status(
                &env,
                &mut remittance,
                RemittanceStatus::Cancelled,
            )?;
            set_remittance(&env, remittance_id, &remittance);

            emit_remittance_cancelled(
                &env,
                remittance_id,
                remittance.sender.clone(),
                remittance.agent.clone(),
                usdc_token.clone(),
                remittance.amount,
            );
            emit_remittance_cancelled_with_reason(
                &env,
                remittance_id,
                remittance.sender,
                remittance.agent,
                usdc_token.clone(),
                remittance.amount,
                String::from_str(&env, "expired"),
            );

            if let Some(idem_key) = storage::take_remittance_idempotency_key(&env, remittance_id) {
                storage::remove_idempotency_record(&env, &idem_key);
            }

            processed_ids.push_back(remittance_id);
        }

        Ok(processed_ids)
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
        // Centralized validation before business logic (returns fees to avoid re-read)
        let fees = validate_withdraw_fees_request(&env, &to)?;

        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &to, &fees);

        set_accumulated_fees(&env, 0);

        emit_fees_withdrawn(&env, caller, to.clone(), usdc_token, fees);

        log_withdraw_fees(&env, &to, fees);

        Ok(())
    }

    /// Withdraws accumulated integrator fees to a specified address.
    ///
    /// Transfers all accumulated integrator fees to the recipient and resets the
    /// counter to zero. Only the designated integrator can withdraw their own fees.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `integrator` - Address of the integrator requesting withdrawal (must authenticate)
    /// * `to` - Address to receive the withdrawn fees
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Fees successfully withdrawn
    /// * `Err(ContractError::NoFeesToWithdraw)` - No integrator fees available
    /// * `Err(ContractError::NotInitialized)` - Contract not initialized
    ///
    /// # Authorization
    ///
    /// Requires authentication from the integrator address.
    pub fn withdraw_integrator_fees(
        env: Env,
        integrator: Address,
        to: Address,
    ) -> Result<(), ContractError> {
        let fees = storage::get_accumulated_integrator_fees(&env);
        if fees <= 0 {
            return Err(ContractError::NoFeesToWithdraw);
        }

        integrator.require_auth();

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &to, &fees);

        storage::set_accumulated_integrator_fees(&env, 0);

        emit_integrator_fees_withdrawn(&env, integrator, to, usdc_token, fees);

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

    /// Returns a paginated list of remittance IDs for a given sender.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `sender` - Address of the sender to query
    /// * `offset` - Zero-based index of the first result to return
    /// * `limit` - Maximum number of IDs to return (capped at 100)
    ///
    /// # Returns
    ///
    /// * `Vec<u64>` - Slice of remittance IDs in creation order
    pub fn get_remittances_by_sender(
        env: Env,
        sender: Address,
        offset: u64,
        limit: u64,
    ) -> Vec<u64> {
        const MAX_PAGE_SIZE: u64 = 100;
        let limit = limit.min(MAX_PAGE_SIZE);

        let all_ids = storage::get_sender_remittances(&env, &sender);
        let total = all_ids.len() as u64;

        if offset >= total || limit == 0 {
            return Vec::new(&env);
        }

        let end = (offset + limit).min(total);
        let mut page = Vec::new(&env);
        for i in offset..end {
            page.push_back(all_ids.get_unchecked(i as u32));
        }
        page
    }

    pub fn get_accumulated_fees(env: Env) -> Result<i128, ContractError> {
        get_accumulated_fees(&env)
    }

    pub fn get_accumulated_integrator_fees(env: Env) -> i128 {
        storage::get_accumulated_integrator_fees(&env)
    }

    /// Returns the number of registered admins.
    pub fn get_admin_count(env: Env) -> u32 {
        storage::get_admin_count(&env)
    }

    /// Returns the total number of remittances ever created.
    pub fn get_remittance_count(env: Env) -> u64 {
        storage::get_total_remittance_count(&env)
    }

    /// Returns the cumulative volume of all completed remittances (original amounts).
    pub fn get_total_volume(env: Env) -> i128 {
        storage::get_total_completed_volume(&env)
    }

    /// Checks whether an address currently has admin privileges.
    pub fn is_admin(env: Env, address: Address) -> bool {
        crate::storage::is_admin(&env, &address)
    }

    /// Adds a new admin. Caller must already be an admin.
    pub fn add_admin(env: Env, caller: Address, new_admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;

        if crate::storage::is_admin(&env, &new_admin) {
            return Err(ContractError::AdminAlreadyExists);
        }

        crate::storage::set_admin_role(&env, &new_admin, true);
        assign_role(&env, &new_admin, &Role::Admin);

        let count = storage::get_admin_count(&env);
        let next = count.checked_add(1).ok_or(ContractError::Overflow)?;
        storage::set_admin_count(&env, next);

        emit_admin_added(&env, caller.clone(), new_admin.clone());
        log_add_admin(&env, &caller, &new_admin);

        Ok(())
    }

    /// Removes an admin. Caller must be an admin and at least one admin must remain.
    pub fn remove_admin(
        env: Env,
        caller: Address,
        admin_to_remove: Address,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;

        if !crate::storage::is_admin(&env, &admin_to_remove) {
            return Err(ContractError::AdminNotFound);
        }

        let count = storage::get_admin_count(&env);
        if count <= 1 {
            return Err(ContractError::CannotRemoveLastAdmin);
        }

        crate::storage::set_admin_role(&env, &admin_to_remove, false);
        remove_role(&env, &admin_to_remove, &Role::Admin);
        storage::set_admin_count(&env, count - 1);

        // Keep legacy single-admin storage aligned so legacy admin-gated paths remain operable.
        if get_admin(&env)? == admin_to_remove {
            set_admin(&env, &caller);
        }

        emit_admin_removed(&env, caller.clone(), admin_to_remove.clone());
        log_remove_admin(&env, &caller, &admin_to_remove);

        Ok(())
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

    /// Returns the KYC metadata hash stored for an agent, or `None` if not set.
    pub fn get_agent_kyc_hash(env: Env, agent: Address) -> Option<soroban_sdk::BytesN<32>> {
        get_agent_kyc_hash(&env, &agent)
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

    /// Returns a detailed fee breakdown for a given amount and optional corridor.
    ///
    /// This function allows callers to preview the exact fee split before creating
    /// a remittance. It supports both global fees and country-specific corridor fees.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `amount` - Transaction amount to calculate fees for (must be positive)
    /// * `from_country` - Optional source country code (ISO 3166-1 alpha-2)
    /// * `to_country` - Optional destination country code (ISO 3166-1 alpha-2)
    ///
    /// # Returns
    ///
    /// * `Ok(FeeBreakdown)` - Complete fee breakdown with:
    ///   - `amount`: Original transaction amount
    ///   - `platform_fee`: Platform fee deducted
    ///   - `protocol_fee`: Treasury/protocol fee deducted
    ///   - `net_amount`: Amount remaining after all fees
    ///   - `corridor`: Optional corridor identifier (populated if country params provided)
    /// * `Err(ContractError::InvalidAmount)` - Amount is zero or negative
    /// * `Err(ContractError::Overflow)` - Arithmetic overflow in calculation
    /// * `Err(ContractError::NotInitialized)` - Contract not initialized
    ///
    /// # Behavior
    ///
    /// - Callable without authorization (read-only query)
    /// - If both `from_country` and `to_country` are provided:
    ///   - Looks up corridor-specific fee configuration
    ///   - Uses corridor fees if corridor exists, otherwise uses global fees
    ///   - Sets `corridor` field in returned FeeBreakdown
    /// - If countries not provided, uses current global fee strategy
    /// - Fee calculations support Percentage, Flat, and Dynamic fee strategies
    ///
    /// # Examples
    ///
    /// ```ignore
    /// // Check global fees
    /// let breakdown = contract.get_fee_breakdown(&env, 1000_000, None, None)?;
    ///
    /// // Check corridor-specific fees
    /// let breakdown = contract.get_fee_breakdown(
    ///     &env,
    ///     1000_000,
    ///     Some(String::from_str(&env, "US")),
    ///     Some(String::from_str(&env, "MX")),
    /// )?;
    /// ```
    pub fn get_fee_breakdown(
        env: Env,
        amount: i128,
        from_country: Option<String>,
        to_country: Option<String>,
    ) -> Result<FeeBreakdown, ContractError> {
        // Validate amount
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        // Try to find corridor if both countries provided
        let corridor_opt = if from_country.is_some() && to_country.is_some() {
            let from = from_country.clone().unwrap();
            let to = to_country.clone().unwrap();
            get_fee_corridor(&env, &from, &to)
        } else {
            None
        };

        // Calculate fees with breakdown using corridor if available
        let mut breakdown =
            fee_service::calculate_fees_with_breakdown(&env, amount, None, corridor_opt.as_ref())?;

        // If countries were provided but no corridor exists in storage,
        // still set the corridor field for informational purposes
        if breakdown.corridor.is_none() && from_country.is_some() && to_country.is_some() {
            let from = from_country.unwrap();
            let to = to_country.unwrap();
            // Create corridor identifier string
            let mut corridor_id = from.clone();
            // For now, we'll use the from_country as the corridor ID
            // In a production system with better string handling, this would be "from-to"
            breakdown.corridor = Some(corridor_id);
        }

        Ok(breakdown)
    }

    /// Computes the deterministic settlement hash for a remittance.
    ///
    /// This function allows external systems (banks, anchors, APIs) to compute
    /// the same settlement hash that the contract uses internally. The hash is
    /// computed using the canonical ordering specified in DETERMINISTIC_HASHING_SPEC.md.
    ///
    /// External systems can use this to:
    /// - Pre-compute settlement IDs before submission
    /// - Verify on-chain settlement IDs match expected values
    /// - Enable cross-system reconciliation using deterministic IDs
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `remittance_id` - The remittance ID to compute hash for
    ///
    /// # Returns
    ///
    /// * `Ok(BytesN<32>)` - The 32-byte SHA-256 settlement hash
    /// * `Err(ContractError::RemittanceNotFound)` - Remittance ID does not exist
    ///
    /// # Hash Input Ordering (Canonical)
    ///
    /// 1. remittance_id (u64, big-endian)
    /// 2. sender (Address, XDR-encoded)
    /// 3. agent (Address, XDR-encoded)
    /// 4. amount (i128, big-endian)
    /// 5. fee (i128, big-endian)
    /// 6. expiry (u64, big-endian, 0 if None)
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let settlement_hash = contract.compute_settlement_hash(&env, remittance_id)?;
    /// // External system can verify this matches their computed hash
    /// ```
    pub fn compute_settlement_hash(
        env: Env,
        remittance_id: u64,
    ) -> Result<soroban_sdk::BytesN<32>, ContractError> {
        let remittance = get_remittance(&env, remittance_id)?;
        Ok(compute_settlement_id_from_remittance(&env, &remittance))
    }
    /// Retrieves the stored settlement hash for a given remittance ID.
    ///
    /// This function allows external systems to retrieve and verify the settlement hash
    /// that was stored on-chain when the remittance was settled. External systems that
    /// implement the same hashing algorithm can verify their computed hash against the
    /// stored one.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `remittance_id` - The remittance ID to retrieve the hash for
    ///
    /// # Returns
    ///
    /// * `Ok(BytesN<32>)` - The 32-byte SHA-256 settlement hash if the remittance is settled
    /// * `Err(ContractError::RemittanceNotFound)` - Remittance ID does not exist
    /// * `Err(ContractError::InvalidStatus)` - Remittance has not been settled yet
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let stored_hash = contract.get_settlement_hash(&env, remittance_id)?;
    /// let computed_hash = contract.compute_settlement_hash(&env, remittance_id)?;
    /// assert_eq!(stored_hash, computed_hash);
    /// ```
    pub fn get_settlement_hash(
        env: Env,
        remittance_id: u64,
    ) -> Result<soroban_sdk::BytesN<32>, ContractError> {
        // Check if remittance exists
        let remittance = get_remittance(&env, remittance_id)?;

        // Check if settlement has been executed
        if !has_settlement_hash(&env, remittance_id) {
            return Err(ContractError::InvalidStatus);
        }

        // Return the computed hash (which is deterministic and matches what was stored)
        Ok(compute_settlement_id_from_remittance(&env, &remittance))
    }

    pub fn pause(env: Env) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        // Delegate to circuit breaker with bypass_checks = true (legacy wrapper)
        circuit_breaker::do_emergency_pause(&env, &caller, PauseReason::MaintenanceWindow, true)
    }

    pub fn unpause(env: Env) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        // Delegate to circuit breaker with bypass_timelock_quorum = true (legacy wrapper)
        circuit_breaker::do_emergency_unpause(&env, &caller, true)
    }

    // ── Circuit Breaker Entry Points ───────────────────────────────────────────

    /// Pauses the contract with a structured reason. Requires Admin role.
    pub fn emergency_pause(
        env: Env,
        caller: Address,
        reason: PauseReason,
    ) -> Result<(), ContractError> {
        circuit_breaker::do_emergency_pause(&env, &caller, reason, false)
    }

    /// Unpauses the contract, enforcing timelock and quorum. Requires Admin role.
    pub fn emergency_unpause(env: Env, caller: Address) -> Result<(), ContractError> {
        circuit_breaker::do_emergency_unpause(&env, &caller, false)
    }

    /// Casts an admin vote to unpause; auto-unpauses when quorum is reached.
    pub fn vote_unpause(env: Env, caller: Address) -> Result<(), ContractError> {
        circuit_breaker::do_vote_unpause(&env, &caller)
    }

    /// Sets the timelock duration (0..=604800 seconds). Requires Admin role.
    pub fn set_pause_timelock(
        env: Env,
        caller: Address,
        seconds: u64,
    ) -> Result<(), ContractError> {
        if seconds > 604800 {
            return Err(ContractError::InvalidTimelockDuration);
        }
        caller.require_auth();
        require_role_admin(&env, &caller)?;
        circuit_breaker_storage::set_timelock_seconds(&env, seconds);
        Ok(())
    }

    /// Sets the unpause quorum (1..=admin_count). Requires Admin role.
    pub fn set_unpause_quorum(
        env: Env,
        caller: Address,
        quorum: u32,
    ) -> Result<(), ContractError> {
        let admin_count = storage::get_admin_count(&env);
        if quorum < 1 || quorum > admin_count {
            return Err(ContractError::InvalidQuorum);
        }
        caller.require_auth();
        require_role_admin(&env, &caller)?;
        circuit_breaker_storage::set_unpause_quorum(&env, quorum);
        Ok(())
    }

    // ── Circuit Breaker View Entry Points ──────────────────────────────────────

    /// Returns a snapshot of the full circuit-breaker state. No auth required.
    pub fn get_circuit_breaker_status(env: Env) -> CircuitBreakerStatus {
        circuit_breaker::build_status(&env)
    }

    /// Returns the pause record for the given sequence number.
    pub fn get_pause_record(env: Env, seq: u64) -> Result<PauseRecord, ContractError> {
        circuit_breaker_storage::get_pause_record_by_seq(&env, seq)
            .ok_or(ContractError::PauseRecordNotFound)
    }

    /// Returns the active pause record, or None when not paused.
    pub fn get_current_pause_record(env: Env) -> Option<PauseRecord> {
        let seq = circuit_breaker_storage::get_active_pause_seq(&env)?;
        circuit_breaker_storage::get_pause_record_by_seq(&env, seq)
    }

    /// Returns the total number of pause events ever recorded.
    pub fn get_pause_history_count(env: Env) -> u64 {
        circuit_breaker_storage::get_pause_sequence(&env)
    }

    // ── Escrow Functions ───────────────────────────────────────────

    pub fn create_escrow(
        env: Env,
        sender: Address,
        recipient: Address,
        amount: i128,
    ) -> Result<u64, ContractError> {
        sender.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        let counter = get_escrow_counter(&env)?;
        let transfer_id = counter.checked_add(1).ok_or(ContractError::Overflow)?;

        let ttl = crate::storage::get_escrow_ttl(&env)?;
        let expiry = if ttl == 0 {
            None
        } else {
            Some(
                env.ledger()
                    .timestamp()
                    .checked_add(ttl)
                    .ok_or(ContractError::Overflow)?,
            )
        };

        let escrow = Escrow {
            transfer_id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            amount,
            expiry,
            status: EscrowStatus::Pending,
        };

        set_escrow(&env, transfer_id, &escrow);
        set_escrow_counter(&env, transfer_id);

        emit_escrow_created(&env, transfer_id, sender, recipient, amount);

        Ok(transfer_id)
    }

    pub fn release_escrow(env: Env, transfer_id: u64) -> Result<(), ContractError> {
        let mut escrow = get_escrow(&env, transfer_id)?;

        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        if escrow.status != EscrowStatus::Pending {
            return Err(ContractError::InvalidEscrowStatus);
        }

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.recipient,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Released;
        set_escrow(&env, transfer_id, &escrow);

        emit_escrow_released(&env, transfer_id, escrow.recipient, escrow.amount);

        Ok(())
    }

    pub fn refund_escrow(env: Env, transfer_id: u64) -> Result<(), ContractError> {
        let mut escrow = get_escrow(&env, transfer_id)?;

        escrow.sender.require_auth();

        if escrow.status != EscrowStatus::Pending {
            return Err(ContractError::InvalidEscrowStatus);
        }

        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.sender,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Refunded;
        set_escrow(&env, transfer_id, &escrow);

        emit_escrow_refunded(&env, transfer_id, escrow.sender, escrow.amount);

        Ok(())
    }

    pub fn get_escrow(env: Env, transfer_id: u64) -> Result<Escrow, ContractError> {
        crate::storage::get_escrow(&env, transfer_id)
    }

    pub fn get_escrow_ttl(env: Env) -> Result<u64, ContractError> {
        crate::storage::get_escrow_ttl(&env)
    }

    pub fn update_escrow_ttl(env: Env, ttl: u64) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;
        validate_escrow_ttl(ttl)?;
        set_escrow_ttl(&env, ttl);
        Ok(())
    }

    pub fn process_expired_escrows(
        env: Env,
        transfer_ids: Vec<u64>,
    ) -> Result<Vec<u64>, ContractError> {
        if transfer_ids.len() > get_max_expired_batch_size(&env) {
            return Err(ContractError::InvalidBatchSize);
        }

        let now = env.ledger().timestamp();
        let usdc_token = get_usdc_token(&env)?;
        let token_client = token::Client::new(&env, &usdc_token);
        let mut processed_ids = Vec::new(&env);

        for i in 0..transfer_ids.len() {
            let transfer_id = transfer_ids.get_unchecked(i);
            let mut escrow = match crate::storage::get_escrow(&env, transfer_id) {
                Ok(value) => value,
                Err(_) => continue,
            };

            if escrow.status != EscrowStatus::Pending {
                continue;
            }

            let is_expired = match escrow.expiry {
                Some(expiry) => now > expiry,
                None => false,
            };

            if !is_expired {
                continue;
            }

            token_client.transfer(
                &env.current_contract_address(),
                &escrow.sender,
                &escrow.amount,
            );

            escrow.status = EscrowStatus::Refunded;
            set_escrow(&env, transfer_id, &escrow);

            emit_escrow_refunded(&env, transfer_id, escrow.sender, escrow.amount);
            processed_ids.push_back(transfer_id);
        }

        Ok(processed_ids)
    }

    pub fn is_paused(env: Env) -> bool {
        crate::storage::is_paused(&env)
    }

    pub fn update_rate_limit(env: Env, cooldown_seconds: u64) -> Result<(), ContractError> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        set_rate_limit_cooldown(&env, cooldown_seconds);

        Ok(())
    }

    pub fn get_rate_limit_cooldown(env: Env) -> Result<u64, ContractError> {
        get_rate_limit_cooldown(&env)
    }

    pub fn get_last_settlement_time(env: Env, sender: Address) -> Option<u64> {
        get_last_settlement_time(&env, &sender)
    }

    /// Set daily send limit for a currency/country pair (admin only).
    pub fn set_daily_limit(
        env: Env,
        currency: String,
        country: String,
        limit: i128,
    ) -> Result<(), ContractError> {
        if limit < 0 {
            return Err(ContractError::InvalidAmount);
        }

        let admin = get_admin(&env)?;
        admin.require_auth();

        let old_limit = crate::storage::get_daily_limit(&env, &currency, &country)
            .map(|cfg| cfg.limit);
        crate::storage::set_daily_limit(&env, &currency, &country, limit);
        crate::events::emit_daily_limit_updated(&env, currency, country, old_limit, limit, admin);
        Ok(())
    }

    /// Set the maximum batch size for process_expired_remittances (admin only).
    ///
    /// # Arguments
    /// * `size` - New batch size limit. Must be between 1 and 200.
    ///
    /// # Tradeoffs
    /// Larger batches process more remittances per call but consume more ledger
    /// resources (CPU instructions and memory). Keep below 200 to avoid hitting
    /// Soroban resource limits. The default (50) is a safe starting point.
    pub fn set_max_expired_batch_size(
        env: Env,
        size: u32,
    ) -> Result<(), ContractError> {
        if size < 1 || size > 200 {
            return Err(ContractError::InvalidBatchSize);
        }
        let admin = get_admin(&env)?;
        admin.require_auth();
        crate::storage::set_max_expired_batch_size(&env, size);
        Ok(())
    }

    /// Get daily send limit for a currency/country pair.
    pub fn get_daily_limit(env: Env, currency: String, country: String) -> Option<i128> {
        crate::storage::get_daily_limit(&env, &currency, &country).map(|cfg| cfg.limit)
    }

    pub fn get_version(env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    /// Returns the current health status of the contract.
    ///
    /// Reports initialization state, pause status, admin count, total remittances
    /// created, and accumulated platform fees. Safe to call at any time.
    pub fn health(env: Env) -> health::HealthStatus {
        health::health(&env)
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

            // Addresses are guaranteed valid by the Soroban host runtime.

            remittances.push_back(remittance);
        }

        // Compute net settlements.
        // Gas note: netting offsets opposing flows so fewer token transfer calls are executed.
        let net_transfers = compute_net_settlements(&env, &remittances);

        // Validate net settlement calculations
        validate_net_settlement(&remittances, &net_transfers)?;

        // Batch read storage values once
        let usdc_token = get_usdc_token(&env)?;
        let mut current_fees = get_accumulated_fees(&env)?;

        let token_client = token::Client::new(&env, &usdc_token);

        // Execute net transfers
        for i in 0..net_transfers.len() {
            let transfer = net_transfers.get_unchecked(i);

            // Determine actual sender and recipient based on net_amount sign
            let (from, to, amount) = if transfer.net_amount > 0 {
                // Positive: party_a -> party_b
                (
                    transfer.party_a.clone(),
                    transfer.party_b.clone(),
                    transfer.net_amount,
                )
            } else if transfer.net_amount < 0 {
                // Negative: party_b -> party_a
                (
                    transfer.party_b.clone(),
                    transfer.party_a.clone(),
                    -transfer.net_amount,
                )
            } else {
                // Zero: complete offset, no transfer needed
                continue;
            };

            // Calculate payout amount (net amount minus fees)
            let payout_amount = amount
                .checked_sub(transfer.total_fees)
                .ok_or(ContractError::Overflow)?;

            // Execute the net transfer from contract to recipient
            token_client.transfer(&env.current_contract_address(), &to, &payout_amount);

            // Accumulate fees in memory with overflow check
            current_fees = current_fees
                .checked_add(transfer.total_fees)
                .ok_or(ContractError::Overflow)?;

            // Emit settlement event (using remittance ID from the transfer)
            // Note: In batch processing, we use the first remittance ID as reference
            let remittance_id = if i < remittances.len() {
                remittances.get_unchecked(i).id
            } else {
                0
            };
            emit_settlement_completed(
                &env,
                remittance_id,
                from,
                to,
                usdc_token.clone(),
                payout_amount,
            );
        }

        // Write accumulated fees once at the end
        // For batch settlement, check if accumulation would exceed MAX_FEES
        if current_fees > MAX_FEES {
            // Flush current accumulated fees and write new total
            trigger_flush(&env, current_fees)?;
            set_accumulated_fees(&env, 0);
        } else {
            set_accumulated_fees(&env, current_fees);
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
            emit_remittance_completed(&env, remittance.id, remittance.sender, remittance.agent);
        }

        Ok(BatchSettlementResult { settled_ids })
    }

    /// Add a token to the whitelist. Only admins can call this.
    pub fn add_whitelisted_token(env: Env, token: Address) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        if is_token_whitelisted(&env, &token) {
            return Err(ContractError::TokenAlreadyWhitelisted);
        }

        set_token_whitelisted(&env, &token, true);

        emit_token_whitelisted(&env, token.clone(), caller);
        log_whitelist_token(&env, &token);

        Ok(())
    }

    /// Remove a token from the whitelist. Only admins can call this.
    pub fn remove_whitelisted_token(env: Env, token: Address) -> Result<(), ContractError> {
        let caller = get_admin(&env)?;
        require_admin(&env, &caller)?;

        if !is_token_whitelisted(&env, &token) {
            return Err(ContractError::TokenNotWhitelisted);
        }

        set_token_whitelisted(&env, &token, false);

        emit_token_removed_from_whitelist(&env, token.clone(), caller);
        log_remove_whitelisted_token(&env, &token);

        Ok(())
    }

    /// Check if a token is whitelisted.
    pub fn is_token_whitelisted(env: Env, token: Address) -> bool {
        crate::storage::is_token_whitelisted(&env, &token)
    }

    /// Get all whitelisted tokens.
    ///
    /// Returns a vector of all token addresses that are currently whitelisted.
    /// This is a public view function that can be called by anyone.
    pub fn get_whitelisted_tokens(env: Env) -> Vec<Address> {
        crate::storage::get_all_whitelisted_tokens(&env)
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
    /// contract.update_rate_limit_config(&admin, 50, 30, true)?;
    /// ```
    pub fn update_rate_limit_config(
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

        Ok(())
    }

    /// Get current rate limit configuration
    ///
    /// # Returns
    /// Tuple of (max_requests, window_seconds, enabled)
    pub fn get_rate_limit_config(env: Env) -> Result<(u32, u64, bool), ContractError> {
        let config = crate::rate_limit::get_rate_limit_config(&env)?;
        Ok((config.max_requests, config.window_seconds, config.enabled))
    }

    /// Get rate limit status for a specific address
    ///
    /// # Parameters
    /// - `address`: Address to check
    ///
    /// # Returns
    /// Tuple of (current_requests, max_requests, window_seconds)
    pub fn get_rate_limit_status(
        env: Env,
        address: Address,
    ) -> Result<(u32, u32, u64), ContractError> {
        crate::rate_limit::get_rate_limit_status(&env, &address)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Protocol Fee Management
    // ═══════════════════════════════════════════════════════════════════════════

    /// Updates the protocol fee (Admin only, max 200 bps)
    pub fn update_protocol_fee(
        env: Env,
        caller: Address,
        fee_bps: u32,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        set_protocol_fee_bps(&env, fee_bps)?;
        emit_protocol_fee_updated(&env, caller, fee_bps);
        Ok(())
    }

    /// Updates the platform fee for a whitelisted token (Admin only).
    pub fn update_token_fee(
        env: Env,
        caller: Address,
        token: Address,
        fee_bps: u32,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        if !is_token_whitelisted(&env, &token) {
            return Err(ContractError::TokenNotWhitelisted);
        }
        set_token_fee_bps(&env, &token, fee_bps)?;
        emit_token_fee_updated(&env, caller, token.clone(), fee_bps);
        Ok(())
    }

    /// Gets the configured platform fee for a whitelisted token.
    pub fn get_token_fee_bps(env: Env, token: Address) -> Option<u32> {
        get_token_fee_bps(&env, &token)
    }

    /// Updates the treasury address (Admin only)
    pub fn update_treasury(
        env: Env,
        caller: Address,
        treasury: Address,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        let old_treasury = get_treasury(&env).ok();
        set_treasury(&env, &treasury);
        emit_treasury_updated(&env, caller, old_treasury, treasury);
        Ok(())
    }

    /// Gets the current protocol fee in basis points
    pub fn get_protocol_fee_bps(env: Env) -> u32 {
        get_protocol_fee_bps(&env)
    }

    /// Gets the treasury address
    pub fn get_treasury(env: Env) -> Result<Address, ContractError> {
        get_treasury(&env)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Role-Based Authorization Functions
    // ═══════════════════════════════════════════════════════════════════════════

    /// Assigns a role to an address (Admin only)
    pub fn assign_role(
        env: Env,
        caller: Address,
        address: Address,
        role: Role,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        require_role_admin(&env, &caller)?;
        assign_role(&env, &address, &role);
        Ok(())
    }

    /// Removes a role from an address (Admin only)
    pub fn remove_role(
        env: Env,
        caller: Address,
        address: Address,
        role: Role,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        require_role_admin(&env, &caller)?;
        remove_role(&env, &address, &role);
        Ok(())
    }

    /// Checks if an address has a specific role
    pub fn has_role(env: Env, address: Address, role: Role) -> bool {
        has_role(&env, &address, &role)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Fee Strategy Management
    // ═══════════════════════════════════════════════════════════════════════════

    /// Updates the fee strategy (Admin only)
    ///
    /// Allows switching between different fee calculation methods:
    /// - Percentage: Fee based on basis points (e.g., 250 = 2.5%)
    /// - Flat: Fixed fee amount regardless of transaction size
    /// - Dynamic: Tiered fee that decreases for larger amounts
    ///
    /// # Arguments
    /// * `caller` - Admin address (must be authorized)
    /// * `strategy` - New fee strategy to apply
    ///
    /// # Examples
    /// ```ignore
    /// // Set 2.5% percentage fee
    /// contract.update_fee_strategy(&admin, FeeStrategy::Percentage(250))?;
    ///
    /// // Set flat 100 USDC fee
    /// contract.update_fee_strategy(&admin, FeeStrategy::Flat(100_0000000))?;
    ///
    /// // Set dynamic tiered fee starting at 4%
    /// contract.update_fee_strategy(&admin, FeeStrategy::Dynamic(400))?;
    /// ```
    pub fn update_fee_strategy(
        env: Env,
        caller: Address,
        strategy: FeeStrategy,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        set_fee_strategy(&env, &strategy);
        Ok(())
    }

    /// Gets the current fee strategy
    pub fn get_fee_strategy(env: Env) -> FeeStrategy {
        get_fee_strategy(&env)
    }

    /// Calculates fee breakdown for a given amount
    ///
    /// Returns detailed breakdown of all fees that would be applied to a transaction.
    /// Useful for displaying fee information to users before they commit to a transaction.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `amount` - Transaction amount to calculate fees for
    ///
    /// # Returns
    ///
    /// Complete fee breakdown including platform fee, protocol fee, and net amount
    pub fn calculate_fee_breakdown(env: Env, amount: i128) -> Result<FeeBreakdown, ContractError> {
        fee_service::calculate_fees_with_breakdown(&env, amount, None, None)
    }

    /// Calculates fee breakdown with corridor-specific configuration
    ///
    /// Applies country-to-country fee rules for cross-border transactions.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `amount` - Transaction amount
    /// * `corridor` - Corridor configuration with country codes and fee rules
    ///
    /// # Returns
    ///
    /// Fee breakdown using corridor-specific rates
    pub fn fee_breakdown_corridor(
        env: Env,
        amount: i128,
        corridor: FeeCorridor,
    ) -> Result<FeeBreakdown, ContractError> {
        fee_service::calculate_fees_with_breakdown(&env, amount, None, Some(&corridor))
    }

    /// Sets a fee corridor configuration for a country pair
    ///
    /// Allows admin to configure specific fee rules for cross-border corridors.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `corridor` - Corridor configuration with country codes and fee rules
    ///
    /// # Authorization
    ///
    /// Requires admin authentication
    pub fn set_fee_corridor(
        env: Env,
        caller: Address,
        corridor: FeeCorridor,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        storage::set_fee_corridor(&env, &corridor);
        Ok(())
    }

    /// Gets a fee corridor configuration for a country pair
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `from_country` - Source country code (ISO 3166-1 alpha-2)
    /// * `to_country` - Destination country code (ISO 3166-1 alpha-2)
    ///
    /// # Returns
    ///
    /// Corridor configuration if exists, None otherwise
    pub fn get_fee_corridor(
        env: Env,
        from_country: String,
        to_country: String,
    ) -> Option<FeeCorridor> {
        storage::get_fee_corridor(&env, &from_country, &to_country)
    }

    /// Removes a fee corridor configuration
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `from_country` - Source country code
    /// * `to_country` - Destination country code
    ///
    /// # Authorization
    ///
    /// Requires admin authentication
    pub fn remove_fee_corridor(
        env: Env,
        caller: Address,
        from_country: String,
        to_country: String,
    ) -> Result<(), ContractError> {
        require_admin(&env, &caller)?;
        storage::remove_fee_corridor(&env, &from_country, &to_country);
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Transfer State Registry (Read-Only for Indexers)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Gets the current state of a transfer (read-only for indexers)
    pub fn get_transfer_state(env: Env, transfer_id: u64) -> Option<RemittanceStatus> {
        get_remittance(&env, transfer_id).ok().map(|r| r.status)
    }

    // ========== Asset Verification Functions ==========

    /// Stores or updates asset verification data (admin only).
    ///
    /// This function is called by the off-chain verification service to store
    /// verification results on-chain. The backend service performs checks against
    /// Stellar Expert, stellar.toml, anchor registries, and transaction history.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `asset_code` - Asset code (e.g., "USDC")
    /// * `issuer` - Issuer address
    /// * `status` - Verification status (Verified, Unverified, Suspicious)
    /// * `reputation_score` - Score from 0-100
    /// * `trustline_count` - Number of trustlines
    /// * `has_toml` - Whether asset has valid stellar.toml
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Verification data stored successfully
    /// * `Err(ContractError::NotInitialized)` - Contract not initialized
    /// * `Err(ContractError::InvalidReputationScore)` - Score not in 0-100 range
    ///
    /// # Authorization
    ///
    /// Requires authentication from the contract admin.
    pub fn set_asset_verification(
        env: Env,
        asset_code: String,
        issuer: Address,
        status: VerificationStatus,
        reputation_score: u32,
        trustline_count: u64,
        has_toml: bool,
    ) -> Result<(), ContractError> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        if reputation_score > 100 {
            return Err(ContractError::InvalidReputationScore);
        }

        let verification = AssetVerification {
            asset_code: asset_code.clone(),
            issuer: issuer.clone(),
            status,
            reputation_score,
            last_verified: env.ledger().timestamp(),
            trustline_count,
            has_toml,
        };

        set_asset_verification(&env, &verification);

        Ok(())
    }

    /// Retrieves asset verification data.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `asset_code` - Asset code to look up
    /// * `issuer` - Issuer address
    ///
    /// # Returns
    ///
    /// * `Ok(AssetVerification)` - The verification record
    /// * `Err(ContractError::AssetNotFound)` - Asset not found in verification database
    pub fn get_asset_verification(
        env: Env,
        asset_code: String,
        issuer: Address,
    ) -> Result<AssetVerification, ContractError> {
        get_asset_verification(&env, &asset_code, &issuer)
    }

    /// Checks if an asset has verification data stored.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `asset_code` - Asset code to check
    /// * `issuer` - Issuer address
    ///
    /// # Returns
    ///
    /// * `true` - Asset has verification data
    /// * `false` - Asset not found in verification database
    pub fn has_asset_verification(env: Env, asset_code: String, issuer: Address) -> bool {
        has_asset_verification(&env, &asset_code, &issuer)
    }

    /// Validates that an asset is safe to use (not suspicious).
    ///
    /// This can be called before creating remittances to ensure the asset
    /// being used is not flagged as suspicious.
    ///
    /// # Arguments
    ///
    /// * `env` - The contract execution environment
    /// * `asset_code` - Asset code to validate
    /// * `issuer` - Issuer address
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Asset is safe to use
    /// * `Err(ContractError::SuspiciousAsset)` - Asset is flagged as suspicious
    /// * `Err(ContractError::AssetNotFound)` - Asset not in verification database
    pub fn validate_asset_safety(
        env: Env,
        asset_code: String,
        issuer: Address,
    ) -> Result<(), ContractError> {
        let verification = get_asset_verification(&env, &asset_code, &issuer)?;

        if verification.status == VerificationStatus::Suspicious {
            return Err(ContractError::SuspiciousAsset);
        }

        Ok(())
    }

    // === Transaction Controller Functions ===

    /// Execute a complete transaction with validation, KYC, contract call, and anchor operations
    pub fn execute_transaction(
        env: Env,
        user: Address,
        agent: Address,
        amount: i128,
        expiry: Option<u64>,
    ) -> Result<TransactionRecord, ContractError> {
        TransactionController::execute_transaction(&env, user, agent, amount, expiry)
    }

    /// Get transaction status and details
    pub fn get_transaction_status(
        env: Env,
        remittance_id: u64,
    ) -> Result<TransactionRecord, ContractError> {
        TransactionController::get_transaction_status(&env, remittance_id)
    }

    /// Retry a failed transaction
    pub fn retry_transaction(
        env: Env,
        remittance_id: u64,
    ) -> Result<TransactionRecord, ContractError> {
        TransactionController::retry_transaction(&env, remittance_id)
    }

    // === User Management Functions ===

    /// Adds a user to the blacklist.
    ///
    /// Requires authentication from the configured admin.
    pub fn blacklist_user(env: Env, user: Address) -> Result<(), ContractError> {
        Self::set_blacklist_status(&env, user, true)
    }

    /// Removes a user from the blacklist.
    ///
    /// Requires authentication from the configured admin.
    pub fn remove_from_blacklist(env: Env, user: Address) -> Result<(), ContractError> {
        Self::set_blacklist_status(&env, user, false)
    }

    /// Set user blacklist status (admin only)
    pub fn set_user_blacklisted(
        env: Env,
        user: Address,
        blacklisted: bool,
    ) -> Result<(), ContractError> {
        Self::set_blacklist_status(&env, user, blacklisted)
    }

    /// Check if user is blacklisted
    pub fn is_user_blacklisted(env: Env, user: Address) -> bool {
        is_user_blacklisted(&env, &user)
    }

    /// Set user KYC approval status (admin only)
    pub fn set_kyc_approved(
        env: Env,
        user: Address,
        approved: bool,
        expiry: u64,
    ) -> Result<(), ContractError> {
        let admin = get_admin(&env)?;
        admin.require_auth();

        set_kyc_approved(&env, &user, approved);
        if approved {
            set_kyc_expiry(&env, &user, expiry);
        }
        Ok(())
    }

    /// Check if user KYC is approved
    pub fn is_kyc_approved(env: Env, user: Address) -> bool {
        is_kyc_approved(&env, &user) && !is_kyc_expired(&env, &user)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Migration Functions
    // ═══════════════════════════════════════════════════════════════════════════

    /// Exports a complete snapshot of all contract state for migration purposes.
    ///
    /// Sets the `MigrationInProgress` flag, which blocks `create_remittance` and
    /// `confirm_payout` until the migration is complete. The returned snapshot
    /// includes a SHA-256 verification hash that must be supplied back to
    /// `import_migration_batch` for integrity verification.
    ///
    /// # Authorization
    /// Admin only — caller must authenticate.
    ///
    /// # Returns
    /// `MigrationSnapshot` containing all instance and persistent state.
    ///
    /// # Errors
    /// - `NotInitialized` — contract not yet initialized
    /// - `Unauthorized` — caller is not an admin
    /// - `MigrationInProgress` — a migration is already active
    pub fn export_migration_snapshot(
        env: Env,
        caller: Address,
    ) -> Result<MigrationSnapshot, ContractError> {
        // Require initialized contract
        get_admin(&env)?;

        // Admin auth
        require_admin(&env, &caller)?;

        // Prevent double-export
        if crate::storage::is_migration_in_progress(&env) {
            return Err(ContractError::MigrationInProgress);
        }

        // Lock normal operations
        crate::storage::set_migration_in_progress(&env, true);

        migration::export_state(&env)
    }

    /// Imports a single batch of remittances produced by `export_migration_snapshot`.
    ///
    /// Each batch carries its own `batch_hash` which is verified before any data is
    /// written. Batches must be imported in order (0, 1, 2, …). After the final batch
    /// (`batch_number == total_batches - 1`) the `MigrationInProgress` flag is cleared,
    /// re-enabling normal operations.
    ///
    /// # Authorization
    /// Admin only — caller must authenticate.
    ///
    /// # Parameters
    /// - `batch` — `MigrationBatch` produced by the off-chain export tooling.
    ///
    /// # Errors
    /// - `NotInitialized` — contract not yet initialized
    /// - `Unauthorized` — caller is not an admin
    /// - `InvalidMigrationHash` — batch hash verification failed
    /// - `InvalidMigrationBatch` — batch_number ≥ total_batches
    pub fn import_migration_batch(
        env: Env,
        caller: Address,
        batch: MigrationBatch,
    ) -> Result<(), ContractError> {
        // Require initialized contract
        get_admin(&env)?;

        // Admin auth
        require_admin(&env, &caller)?;

        // Validate batch metadata
        if batch.batch_number >= batch.total_batches {
            return Err(ContractError::InvalidMigrationBatch);
        }

        // Capture before move
        let batch_number = batch.batch_number;
        let total_batches = batch.total_batches;

        // Delegate to migration module (performs hash verification + import)
        migration::import_batch(&env, batch)?;

        // Clear the lock after the final batch
        if batch_number == total_batches.saturating_sub(1) {
            crate::storage::set_migration_in_progress(&env, false);
        }

        Ok(())
    }

    // ── Recipient Address Verification View Functions ──────────────────────

    /// Returns the stored recipient hash record for a remittance, or `None` if
    /// the remittance is verification-exempt (no hash was registered).
    ///
    /// Returns `ContractError::RemittanceNotFound` if the remittance_id does not exist.
    /// No authorization required — the hash itself does not reveal recipient details.
    pub fn get_recipient_hash(
        env: Env,
        remittance_id: u64,
    ) -> Result<Option<RecipientHashRecord>, ContractError> {
        recipient_verification::get_recipient_hash(&env, remittance_id)
    }

    /// Computes the canonical SHA-256 hash of `RecipientDetails`.
    ///
    /// This view function enables off-chain systems to verify their hash computation
    /// without submitting a transaction.
    pub fn compute_recipient_hash(env: Env, details: RecipientDetails) -> BytesN<32> {
        recipient_verification::compute_recipient_hash(&env, details)
    }

    /// Returns the current `RECIPIENT_HASH_SCHEMA_VERSION`.
    pub fn rcpt_hash_schema_version() -> u32 {
        recipient_verification::get_recipient_hash_schema_version()
    }

    /// Admin function: recompute recipient hashes for a batch of remittances
    /// under the current schema version (Issue #422).
    ///
    /// Use this after bumping `RECIPIENT_HASH_SCHEMA_VERSION` to restore
    /// verifiability for remittances created under the previous schema.
    ///
    /// # Authorization
    /// Requires admin authentication.
    pub fn migrate_recipient_hashes(
        env: Env,
        caller: Address,
        batch: Vec<recipient_verification::RecipientHashMigrationEntry>,
    ) -> Result<u32, ContractError> {
        require_admin(&env, &caller)?;
        recipient_verification::migrate_recipient_hashes(&env, batch)
    }

    // ── Governance Entry Points ────────────────────────────────────────────

    /// Creates a new governance proposal.
    ///
    /// The proposer must hold `Role::Admin`. Returns the new `proposal_id`.
    pub fn propose(
        env: Env,
        proposer: Address,
        action: ProposalAction,
    ) -> Result<u64, ContractError> {
        proposer.require_auth();
        governance::do_propose(&env, &proposer, action)
    }

    /// Casts an approval vote on a pending proposal.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
    ) -> Result<(), ContractError> {
        voter.require_auth();
        governance::do_vote(&env, &voter, proposal_id)
    }

    /// Executes an approved proposal after the timelock has elapsed.
    pub fn execute(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), ContractError> {
        executor.require_auth();
        governance::do_execute(&env, &executor, proposal_id)
    }

    /// Transitions an expired proposal to the Expired state.
    ///
    /// Can be called by any address once the proposal TTL has elapsed.
    pub fn expire_proposal(env: Env, proposal_id: u64) -> Result<(), ContractError> {
        governance::do_expire(&env, proposal_id)
    }

    /// One-time migration from single-admin to multi-sig governance.
    ///
    /// Must be called by the legacy admin address. Sets the initial quorum,
    /// timelock, and proposal TTL without requiring a proposal.
    pub fn migrate_to_governance(
        env: Env,
        caller: Address,
        quorum: u32,
        timelock_seconds: u64,
        proposal_ttl_seconds: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        governance::do_migrate(&env, &caller, quorum, timelock_seconds, proposal_ttl_seconds)
    }

    // ── Governance Read-Only Queries ───────────────────────────────────────

    /// Returns the full proposal record for the given `proposal_id`.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, ContractError> {
        storage::get_proposal(&env, proposal_id)
    }

    /// Returns the current list of admin addresses.
    pub fn get_admins(env: Env) -> soroban_sdk::Vec<Address> {
        storage::get_admin_list(&env)
    }

    /// Returns the current governance quorum threshold.
    pub fn get_quorum(env: Env) -> u32 {
        storage::get_governance_quorum(&env)
    }

    /// Returns the current governance execution timelock in seconds.
    pub fn get_timelock_seconds(env: Env) -> u64 {
        storage::get_governance_timelock(&env)
    }

    /// Returns quorum, timelock, and proposal TTL in a single call.
    ///
    /// Allows integrators and frontends to display current governance parameters
    /// without reading raw storage or making three separate queries.
    pub fn query_governance_config(env: Env) -> GovernanceConfig {
        GovernanceConfig {
            quorum: storage::get_governance_quorum(&env),
            timelock_seconds: storage::get_governance_timelock(&env),
            proposal_ttl_seconds: storage::get_proposal_ttl(&env),
        }
    }

    /// Deletes expired or executed proposals from persistent storage.
    ///
    /// Admin-only. Proposals in `Pending` or `Approved` state are skipped.
    /// Emits a `proposal_cleaned_up` event for each deleted proposal.
    pub fn cleanup_expired_proposals(
        env: Env,
        caller: Address,
        proposal_ids: soroban_sdk::Vec<u64>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        governance::cleanup_expired_proposals(&env, &caller, proposal_ids)
    }

    /// Aborts an in-progress cross-contract migration and resets the state machine to Idle.
    ///
    /// Clears the `MigrationInProgress` flag and the batch ordering counter, then emits
    /// a `migration_aborted` event. Admin only.
    ///
    /// # Errors
    /// - `NotFound` — no migration is currently in progress.
    /// - `Unauthorized` — caller is not an admin.
    pub fn abort_migration(env: Env, caller: Address) -> Result<(), ContractError> {
        get_admin(&env)?;
        require_admin(&env, &caller)?;
        migration::abort_migration(&env, &caller)
    }
}
