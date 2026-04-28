//! Event emission functions for the SwiftRemit contract.
//!
//! This module provides functions to emit structured events for all significant
//! contract operations. Events include schema versioning and ledger metadata
//! for comprehensive audit trails.

use soroban_sdk::{symbol_short, Address, Env};

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

// ── Settlement Events ──────────────────────────────────────────────

/// Emits a structured completion event when a settlement is finalized.
///
/// This event is emitted exactly once per completed settlement, after all state
/// transitions are successfully committed. It includes sufficient identifiers to
/// uniquely reference the finalized settlement.
///
/// # Guarantees
///
/// - **Exactly-Once Emission**: Event is emitted once and only once per settlement
/// - **Post-Finalization**: Only emitted after all state changes are committed
/// - **Unique Identification**: Includes remittance_id for unambiguous reference
/// - **Deterministic**: Same settlement always produces same event
/// - **No Re-entry**: Protected against duplicate emission on retries
///
/// # Arguments
///
/// * `env` - The contract execution environment
/// * `remittance_id` - Unique ID of the finalized settlement
/// * `sender` - Address of the sender
/// * `receiver` - Address of the receiver (agent)
/// * `asset` - Address of the token contract (e.g., USDC)
/// * `amount` - Settlement amount transferred
///
/// # Event Structure
///
/// Topic: `("settle", "complete")`
/// Data: `(schema_version, ledger_sequence, timestamp, remittance_id, sender, receiver, asset, amount)`
///
/// # Usage
///
/// This function should only be called from `confirm_payout` after:
/// 1. All validations pass
/// 2. Token transfer completes
/// 3. Fee accumulation succeeds
/// 4. Status updated to Settled
/// 5. Settlement hash set
/// 6. Event emission flag checked
pub fn emit_settlement_completed(
    env: &Env,
    remittance_id: u64,
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
            remittance_id,
            sender,
            receiver,
            asset,
            amount,
        ),
    );
}


// ── Escrow Events ──────────────────────────────────────────────────

/// Emits an event when escrow is created
pub fn emit_escrow_created(env: &Env, transfer_id: u64, sender: Address, recipient: Address, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("created")),
        (SCHEMA_VERSION, env.ledger().sequence(), env.ledger().timestamp(), transfer_id, sender, recipient, amount),
    );
}

/// Emits an event when escrow funds are released
pub fn emit_escrow_released(env: &Env, transfer_id: u64, recipient: Address, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("released")),
        (SCHEMA_VERSION, env.ledger().sequence(), env.ledger().timestamp(), transfer_id, recipient, amount),
    );
}

/// Emits an event when escrow funds are refunded
pub fn emit_escrow_refunded(env: &Env, transfer_id: u64, sender: Address, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("refunded")),
        (SCHEMA_VERSION, env.ledger().sequence(), env.ledger().timestamp(), transfer_id, sender, amount),
    );
}

// ── Admin Transfer Events (#365) ───────────────────────────────────

/// Emits an event when an admin proposes a new admin (step 1 of 2-step transfer).
pub fn emit_admin_transfer_proposed(env: &Env, current_admin: Address, proposed_admin: Address) {
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("proposed")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            current_admin,
            proposed_admin,
        ),
    );
}

/// Emits an event when the proposed admin accepts and becomes the new admin (step 2).
pub fn emit_admin_transfer_accepted(env: &Env, old_admin: Address, new_admin: Address) {
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("accepted")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            old_admin,
            new_admin,
        ),
    );
}
