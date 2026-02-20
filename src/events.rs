use soroban_sdk::{symbol_short, Address, Env};

pub fn emit_remittance_created(
    env: &Env,
    remittance_id: u64,
    sender: Address,
    agent: Address,
    amount: i128,
    fee: i128,
) {
    env.events().publish(
        (symbol_short!("created"),),
        (remittance_id, sender, agent, amount, fee),
    );
}

pub fn emit_remittance_completed(
    env: &Env,
    remittance_id: u64,
    agent: Address,
    payout_amount: i128,
) {
    env.events().publish(
        (symbol_short!("completed"),),
        (remittance_id, agent, payout_amount),
    );
}

pub fn emit_remittance_cancelled(
    env: &Env,
    remittance_id: u64,
    sender: Address,
    refund_amount: i128,
) {
    env.events().publish(
        (symbol_short!("cancelled"),),
        (remittance_id, sender, refund_amount),
    );
}

pub fn emit_agent_registered(env: &Env, agent: Address) {
    env.events()
        .publish((symbol_short!("agent_reg"),), agent);
}

pub fn emit_agent_removed(env: &Env, agent: Address) {
    env.events()
        .publish((symbol_short!("agent_rem"),), agent);
}

pub fn emit_fee_updated(env: &Env, fee_bps: u32) {
    env.events()
        .publish((symbol_short!("fee_upd"),), fee_bps);
}

pub fn emit_fees_withdrawn(env: &Env, to: Address, amount: i128) {
    env.events()
        .publish((symbol_short!("fees_with"),), (to, amount));
}

/// Emits a settlement completed event with full transaction details.
/// This event includes sender, recipient (agent), token address, and payout amount.
pub fn emit_settlement_completed(
    env: &Env,
    sender: Address,
    recipient: Address,
    token: Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("settled"),),
        (sender, recipient, token, amount),
    );
}
