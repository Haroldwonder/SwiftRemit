//! Event emission functions for the SwiftRemit contract.
//!
//! This module provides functions to emit structured events for all significant
//! contract operations. Events include schema versioning and ledger metadata
//! for comprehensive audit trails.

use soroban_sdk::{symbol_short, Address, Env, String, Symbol};

// ============================================================================
// Event Schema Version
// ============================================================================
//
// SCHEMA_VERSION: Event schema version for tracking event format changes
// - This constant is included in all emitted events to help indexers and
//   off-chain systems understand the event structure
// - Current value: 1 (initial schema)
// - When to increment: Increment this value whenever the structure of any
//   event changes (e.g., adding/removing fields, changing field types)
// - This allows event consumers to handle different schema versions gracefully
//   and perform migrations when the event format evolves
// ============================================================================

use crate::config::SCHEMA_VERSION;

// ── Admin Events ───────────────────────────────────────────────────

/// Emits an event when the contract is paused by an admin.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `admin` - Address of the admin who paused the contract
pub fn emit_paused(env: &Env, admin: Address) {
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("paused")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            admin,
        ),
    );
}

/// Emits an event when the contract is unpaused by an admin.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `admin` - Address of the admin who unpaused the contract
pub fn emit_unpaused(env: &Env, admin: Address) {
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("unpaused")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            admin,
        ),
    );
}

/// Emits an event when a new admin is added.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `caller` - Address of the admin who added the new admin
/// * `new_admin` - Address of the newly added admin
pub fn emit_admin_added(env: &Env, caller: Address, new_admin: Address) {
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("added")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            caller,
            new_admin,
        ),
    );
}

/// Emits an event when an admin is removed.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `caller` - Address of the admin who removed the admin
/// * `removed_admin` - Address of the removed admin
pub fn emit_admin_removed(env: &Env, caller: Address, removed_admin: Address) {
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("removed")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            caller,
            removed_admin,
        ),
    );
}

// ── Remittance Events ──────────────────────────────────────────────

/// Emits an event when a new remittance is created.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - Unique ID of the created remittance
/// * `sender` - Address of the sender
/// * `agent` - Address of the assigned agent
/// * `amount` - Total remittance amount
/// * `fee` - Platform fee deducted
pub fn emit_remittance_created(
    env: &Env,
    remittance_id: u64,
    sender: Address,
    agent: Address,
    amount: i128,
    fee: i128,
    integrator_fee: i128,
) {
    env.events().publish(
        (symbol_short!("remit"), symbol_short!("created")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            remittance_id,
            sender,
            agent,
            amount,
            fee,
            integrator_fee,
        ),
    );
}

/// Emits an event when a remittance payout is completed.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - ID of the completed remittance
/// * `sender` - Address of the sender
/// * `agent` - Address of the agent who received the payout
pub fn emit_remittance_completed(
    env: &Env,
    remittance_id: u64,
    sender: Address,
    agent: Address,
) {
    env.events().publish(
        (symbol_short!("remit"), symbol_short!("complete")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            remittance_id,
            sender,
            agent,
        ),
    );
}

/// Emits an event when a remittance is cancelled.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - ID of the cancelled remittance
/// * `sender` - Address of the sender who received the refund
/// * `agent` - Address of the agent
/// * `token` - Token address
/// * `amount` - Refunded amount
pub fn emit_remittance_cancelled(
    env: &Env,
    remittance_id: u64,
    sender: Address,
    agent: Address,
    token: Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("remit"), symbol_short!("cancel")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            remittance_id,
            sender,
            agent,
            token,
            amount,
        ),
    );
}

/// Emits an event when a remittance is cancelled with a structured reason.
pub fn emit_remittance_cancelled_with_reason(
    env: &Env,
    remittance_id: u64,
    sender: Address,
    agent: Address,
    token: Address,
    amount: i128,
    reason: String,
) {
    env.events().publish(
        (symbol_short!("remit"), symbol_short!("cancel_r")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            remittance_id,
            sender,
            agent,
            token,
            amount,
            reason,
        ),
    );
}

// ── Agent Events ───────────────────────────────────────────────────

/// Emits an event when a new agent is registered.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `agent` - Address of the registered agent
/// * `caller` - Address of the admin who registered the agent
pub fn emit_agent_registered(env: &Env, agent: Address, caller: Address, kyc_hash: Option<soroban_sdk::BytesN<32>>) {
    env.events().publish(
        (symbol_short!("agent"), symbol_short!("register")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            agent,
            caller,
            kyc_hash,
        ),
    );
}

/// Emits an event when an agent is removed.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `agent` - Address of the removed agent
/// * `caller` - Address of the admin who removed the agent
pub fn emit_agent_removed(env: &Env, agent: Address, caller: Address) {
    env.events().publish(
        (symbol_short!("agent"), symbol_short!("removed")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            agent,
            caller,
        ),
    );
}

/// Emits an event when a user is added to the blacklist.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `user` - Address of the blacklisted user
/// * `caller` - Address of the admin who updated the blacklist
pub fn emit_user_blacklisted(env: &Env, user: Address, caller: Address) {
    env.events().publish(
        (symbol_short!("blacklist"), symbol_short!("added")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            user,
            caller,
        ),
    );
}

/// Emits an event when a user is removed from the blacklist.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `user` - Address of the user removed from the blacklist
/// * `caller` - Address of the admin who updated the blacklist
pub fn emit_user_removed_from_blacklist(env: &Env, user: Address, caller: Address) {
    env.events().publish(
        (symbol_short!("blacklist"), symbol_short!("removed")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            user,
            caller,
        ),
    );
}

// ── Token Whitelist Events ─────────────────────────────────────────

/// Emits an event when a token is added to the whitelist.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `token` - Address of the token added to whitelist
/// * `caller` - Address of the admin who added the token
pub fn emit_token_whitelisted(env: &Env, token: Address, caller: Address) {
    env.events().publish(
        (symbol_short!("token"), symbol_short!("whitelist")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            token,
            caller,
        ),
    );
}

/// Emits an event when a token is removed from the whitelist.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `token` - Address of the token removed from whitelist
/// * `caller` - Address of the admin who removed the token
pub fn emit_token_removed_from_whitelist(env: &Env, token: Address, caller: Address) {
    env.events().publish(
        (symbol_short!("token"), symbol_short!("rm_white")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            token,
            caller,
        ),
    );
}

/// Emits an event when a token-specific fee configuration is updated.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `caller` - The admin who updated the fee
/// * `token` - The token address whose fee was updated
/// * `fee_bps` - New platform fee in basis points
pub fn emit_token_fee_updated(env: &Env, caller: Address, token: Address, fee_bps: u32) {
    env.events().publish(
        (symbol_short!("token"), symbol_short!("fee_upd")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            caller,
            token,
            fee_bps,
        ),
    );
}

// ── Fee Events ─────────────────────────────────────────────────────

/// Emits an event when the platform fee is updated.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `fee_bps` - New fee rate in basis points
pub fn emit_fee_updated(env: &Env, fee_bps: u32) {
    env.events().publish(
        (symbol_short!("fee"), symbol_short!("updated")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            fee_bps,
        ),
    );
}

/// Emits an event when accumulated fees are withdrawn.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `caller` - Address of the admin who withdrew fees
/// * `to` - Address that received the withdrawn fees
/// * `token` - Token address
/// * `amount` - Amount of fees withdrawn
pub fn emit_fees_withdrawn(env: &Env, caller: Address, to: Address, token: Address, amount: i128) {
    env.events().publish(
        (symbol_short!("fee"), symbol_short!("withdraw")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            caller,
            to,
            token,
            amount,
        ),
    );
}

/// Emits an event when the protocol fee is updated.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `caller` - Address of the admin who updated the protocol fee
/// * `fee_bps` - New protocol fee rate in basis points
pub fn emit_protocol_fee_updated(env: &Env, caller: Address, fee_bps: u32) {
    env.events().publish(
        (symbol_short!("fee"), symbol_short!("proto_upd")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            caller,
            fee_bps,
        ),
    );
}

pub fn emit_dispute_resolved(env: &Env, id: u64, in_favour_of_sender: bool) {
    env.events().publish((Symbol::new(env, "dispute_resolved"), id), in_favour_of_sender);
}

pub fn emit_remittance_failed(env: &Env, id: u64, agent: Address) {
    env.events().publish((Symbol::new(env, "remittance_failed"), id), agent);
}

pub fn emit_dispute_raised(env: &Env, id: u64, sender: Address, evidence_hash: soroban_sdk::BytesN<32>) {
    env.events().publish(
        (Symbol::new(env, "dispute_raised"), id),
        (sender, evidence_hash),
    );
}

pub fn emit_partial_payout(env: &Env, remittance_id: u64, agent: Address, amount: i128, disbursed_total: i128) {
    env.events().publish(
        (Symbol::new(env, "partial_payout"), remittance_id),
        (agent, amount, disbursed_total),
    );
}

pub fn emit_agent_cap_set(env: &Env, agent: Address, cap: i128, caller: Address) {
    env.events().publish(
        (Symbol::new(env, "agent_cap_set"),),
        (agent, cap, caller),
    );
}

// ── Circuit Breaker Events ─────────────────────────────────────────

/// Emits an event when the contract is emergency-paused.
///
/// # Arguments
///
/// * `env`       - The contract execution environment
/// * `caller`    - Address that triggered the pause
/// * `timestamp` - Ledger timestamp of the pause
/// * `reason`    - Structured [`crate::PauseReason`] for the pause
pub fn emit_circuit_breaker_paused(
    env: &Env,
    caller: Address,
    timestamp: u64,
    reason: crate::PauseReason,
) {
    env.events().publish(
        (symbol_short!("cb"), symbol_short!("paused")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            timestamp,
            caller,
            reason,
        ),
    );
}

/// Emits an event when the contract is emergency-unpaused.
///
/// # Arguments
///
/// * `env`       - The contract execution environment
/// * `caller`    - Address that triggered the unpause
/// * `timestamp` - Ledger timestamp of the unpause
pub fn emit_circuit_breaker_unpaused(env: &Env, caller: Address, timestamp: u64) {
    env.events().publish(
        (symbol_short!("cb"), symbol_short!("unpaused")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            timestamp,
            caller,
        ),
// ── Recipient Address Verification Events ─────────────────────────

/// Emits an event when a recipient hash is registered for a remittance.
///
/// Emitted before returning (emit-before-return convention).
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - ID of the remittance
/// * `recipient_hash` - The 32-byte hash that was registered
/// * `hash_schema_version` - The schema version used to produce the hash
pub fn emit_recipient_hash_registered(
    env: &Env,
    remittance_id: u64,
    recipient_hash: soroban_sdk::BytesN<32>,
    hash_schema_version: u32,
) {
    env.events().publish(
        (Symbol::new(env, "rcpt_hash_reg"), remittance_id),
        (recipient_hash, hash_schema_version),
    );
}

/// Emits an event when a recipient hash verification succeeds at payout time.
///
/// Emitted before returning (emit-before-return convention).
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - ID of the remittance
/// * `agent` - Address of the agent who confirmed the payout
pub fn emit_recipient_verified(env: &Env, remittance_id: u64, agent: Address) {
    env.events().publish(
        (Symbol::new(env, "rcpt_verified"), remittance_id),
        agent,
    );
}

/// Emits an event when a recipient hash verification fails at payout time.
///
/// Emitted before returning (emit-before-return convention).
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - ID of the remittance
/// * `agent` - Address of the agent who attempted the payout
pub fn emit_recipient_verification_failed(env: &Env, remittance_id: u64, agent: Address) {
    env.events().publish(
        (Symbol::new(env, "rcpt_vfy_fail"), remittance_id),
        agent,
    );
}

// ── Settlement / Escrow / Treasury Events (stubs for backward compatibility) ──

/// Emits an event when a settlement is completed (alias for emit_remittance_completed with extra fields).
pub fn emit_settlement_completed(
    env: &Env,
    remittance_id: u64,
    sender: Address,
    agent: Address,
    token: Address,
    payout_amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "settlement_done"), remittance_id),
        (sender, agent, token, payout_amount),
    );
}

/// Emits an event when integrator fees are withdrawn.
pub fn emit_integrator_fees_withdrawn(
    env: &Env,
    integrator: Address,
    to: Address,
    token: Address,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "intg_fee_wdrw"),),
        (integrator, to, token, amount),
    );
}

/// Emits an event when an escrow transfer is created.
pub fn emit_escrow_created(
    env: &Env,
    transfer_id: u64,
    sender: Address,
    recipient: Address,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "escrow_created"), transfer_id),
        (sender, recipient, amount),
    );
}

/// Emits an event when an escrow transfer is released to the recipient.
pub fn emit_escrow_released(
    env: &Env,
    transfer_id: u64,
    recipient: Address,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "escrow_released"), transfer_id),
        (recipient, amount),
    );
}

/// Emits an event when an escrow transfer is refunded to the sender.
pub fn emit_escrow_refunded(
    env: &Env,
    transfer_id: u64,
    sender: Address,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "escrow_refunded"), transfer_id),
        (sender, amount),
    );
}

/// Emits an event when the treasury address is updated.
pub fn emit_treasury_updated(
    env: &Env,
    caller: Address,
    old_treasury: Option<Address>,
    new_treasury: Address,
) {
    env.events().publish(
        (Symbol::new(env, "treasury_upd"),),
        (caller, old_treasury, new_treasury),
    );
}
