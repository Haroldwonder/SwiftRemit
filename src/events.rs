//! Event emission functions for the SwiftRemit contract.
//!
//! This module provides functions to emit structured events for all significant
//! contract operations. Events include schema versioning and ledger metadata
//! for comprehensive audit trails.

use soroban_sdk::{symbol_short, Address, Env};

/// Schema version for event structure compatibility
const SCHEMA_VERSION: u32 = 1;

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

/// Event emission functions for the SwiftRemit contract.
///
/// This module provides functions to emit structured events for all significant
/// contract operations. Events include schema versioning and ledger metadata
/// for comprehensive audit trails.

use soroban_sdk::{symbol_short, Address, Env};

/// Schema version for event structure compatibility
const SCHEMA_VERSION: u32 = 1;

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
        ),
    );
}

/// Emits an event when a remittance payout is completed.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - ID of the completed remittance
/// * `agent` - Address of the agent who received the payout
/// * `amount` - Payout amount (after fee deduction)
pub fn emit_remittance_completed(
    env: &Env,
    remittance_id: u64,
    agent: Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("remit"), symbol_short!("complete")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            remittance_id,
            agent,
            amount,
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
/// * `amount` - Refunded amount
pub fn emit_remittance_cancelled(
    env: &Env,
    remittance_id: u64,
    sender: Address,
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
            amount,
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
pub fn emit_agent_registered(env: &Env, agent: Address) {
    env.events().publish(
        (symbol_short!("agent"), symbol_short!("register")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            agent,
        ),
    );
}

/// Emits an event when an agent is removed.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `agent` - Address of the removed agent
pub fn emit_agent_removed(env: &Env, agent: Address) {
    env.events().publish(
        (symbol_short!("agent"), symbol_short!("removed")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            agent,
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
/// * `to` - Address that received the withdrawn fees
/// * `amount` - Amount of fees withdrawn
pub fn emit_fees_withdrawn(env: &Env, to: Address, amount: i128) {
    env.events().publish(
        (symbol_short!("fee"), symbol_short!("withdraw")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            to,
            amount,
        ),
    );
}

// ── Settlement Events ──────────────────────────────────────────────

/// Emits an event when a settlement is created and executed.
///
/// This event is fired when a settlement transaction is completed, allowing
/// off-chain services to track settlement activity without scanning storage.
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `sender` - Address of the sender
/// * `receiver` - Address of the receiver (agent)
/// * `asset` - Address of the token contract (e.g., USDC)
/// * `amount` - Settlement amount transferred
pub fn emit_settlement_completed(
    env: &Env,
    sender: Address,
    receiver: Address,
    asset: Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("settle"), symbol_short!("complete")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            sender,
            receiver,
            asset,
            amount,
        ),
    );
}

