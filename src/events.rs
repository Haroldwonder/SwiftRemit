//! Event emission functions for the SwiftRemit contract.
//!
//! This module provides functions to emit structured events for all significant
//! contract operations. Events include schema versioning and ledger metadata
//! for comprehensive audit trails.

use soroban_sdk::{symbol_short, Address, Env, String};

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
pub fn emit_agent_registered(env: &Env, agent: Address, caller: Address) {
    env.events().publish(
        (symbol_short!("agent"), symbol_short!("register")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            agent,
            caller,
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