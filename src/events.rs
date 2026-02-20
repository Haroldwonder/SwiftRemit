use soroban_sdk::{symbol_short, Address, Env};

const SCHEMA_VERSION: u32 = 1;

// ── Remittance Events ──────────────────────────────────────────────

pub fn emit_remittance_created(
    env: &Env,
    remittance_id: u64,
    sender: Address,
    agent: Address,
    token: Address,
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
            token,
            amount,
            fee,
        ),
    );
}

pub fn emit_remittance_completed(
    env: &Env,
    remittance_id: u64,
    sender: Address,
    agent: Address,
    token: Address,
    amount: i128,
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
            token,
            amount,
        ),
    );
}

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

// ── Batch Settlement Events ─────────────────────────────────────────

pub fn emit_batch_settlement_started(env: &Env, batch_size: u32) {
    env.events().publish(
        (symbol_short!("batch"), symbol_short!("start")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            batch_size,
        ),
    );
}

pub fn emit_batch_settlement_completed(
    env: &Env,
    total_count: u32,
    success_count: u32,
    total_payout: i128,
) {
    env.events().publish(
        (symbol_short!("batch"), symbol_short!("complete")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            total_count,
            success_count,
            total_payout,
        ),
    );
}

pub fn emit_batch_settlement_failed(
    env: &Env,
    failed_at_index: u32,
    remittance_id: u64,
    reason: u32,
) {
    env.events().publish(
        (symbol_short!("batch"), symbol_short!("failed")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            failed_at_index,
            remittance_id,
            reason,
        ),
    );
}

// ── Agent Events ───────────────────────────────────────────────────

pub fn emit_agent_registered(env: &Env, agent: Address, admin: Address) {
    env.events().publish(
        (symbol_short!("agent"), symbol_short!("register")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            agent,
            admin,
        ),
    );
}

pub fn emit_agent_removed(env: &Env, agent: Address, admin: Address) {
    env.events().publish(
        (symbol_short!("agent"), symbol_short!("removed")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            agent,
            admin,
        ),
    );
}

// ── Fee Events ─────────────────────────────────────────────────────

pub fn emit_fee_updated(env: &Env, admin: Address, old_fee_bps: u32, new_fee_bps: u32) {
    env.events().publish(
        (symbol_short!("fee"), symbol_short!("updated")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            admin,
            old_fee_bps,
            new_fee_bps,
        ),
    );
}

pub fn emit_fees_withdrawn(
    env: &Env,
    admin: Address,
    recipient: Address,
    token: Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("fee"), symbol_short!("withdraw")),
        (
            SCHEMA_VERSION,
            env.ledger().sequence(),
            env.ledger().timestamp(),
            admin,
            recipient,
            token,
            amount,
        ),
    );
}
