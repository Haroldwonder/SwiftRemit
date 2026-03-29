pub fn emit_dispute_raised(env: &Env, id: u64, sender: Address, evidence: BytesN<32>) {
    env.events().publish((Symbol::new(env, "dispute_raised"), id), (sender, evidence));
}

pub fn emit_dispute_resolved(env: &Env, id: u64, in_favour_of_sender: bool) {
    env.events().publish((Symbol::new(env, "dispute_resolved"), id), in_favour_of_sender);
}

pub fn emit_remittance_failed(env: &Env, id: u64, agent: Address) {
    env.events().publish((Symbol::new(env, "remittance_failed"), id), agent);
}