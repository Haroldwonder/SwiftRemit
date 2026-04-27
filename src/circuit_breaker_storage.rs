//! Storage helpers for the circuit-breaker / emergency-pause module.
//!
//! All functions in this module read and write the circuit-breaker-specific
//! `DataKey` variants that were added to `src/storage.rs`.  The helpers follow
//! the same conventions used throughout the rest of the storage layer:
//!
//! - Instance storage for counters and configuration (fast, contract-scoped).
//! - Persistent storage for per-event records and per-voter flags.
//! - Sensible defaults are returned when a key has never been written
//!   (timelock = 0, quorum = 1, sequence = 0, vote count = 0).

use soroban_sdk::{Address, Env};

use crate::{PauseRecord, UnpauseRecord};

// ─── Re-export the DataKey enum via the storage module ───────────────────────
// DataKey is private to storage.rs, so we call the public storage functions
// that already exist there for the Paused flag, and we add new public helpers
// here that mirror the same pattern but use the new circuit-breaker keys.
//
// Because DataKey is not pub, we cannot reference it directly from this module.
// Instead we use the `storage` module's internal access by placing this module
// inside the same crate and calling `env.storage()` with the keys via a thin
// wrapper approach: we define a local shadow enum that is only used inside this
// file.  This is the same pattern used by every other module in this crate.

use soroban_sdk::contracttype;

/// Local mirror of the circuit-breaker subset of DataKey.
/// Must stay in sync with the variants in `storage.rs`.
#[contracttype]
#[derive(Clone)]
enum CbKey {
    PauseSequence,
    ActivePauseSeq,
    PauseRecord(u64),
    UnpauseRecord(u64),
    UnpauseVote(u64, Address),
    UnpauseVoteCountForSeq(u64),
    PauseTimelockSeconds,
    UnpauseQuorum,
}

// ─── Pause Sequence Counter ───────────────────────────────────────────────────

/// Returns the current pause sequence counter (number of pause events ever recorded).
/// Defaults to 0 if never set.
pub fn get_pause_sequence(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&CbKey::PauseSequence)
        .unwrap_or(0)
}

/// Persists the pause sequence counter.
pub fn set_pause_sequence(env: &Env, seq: u64) {
    env.storage()
        .instance()
        .set(&CbKey::PauseSequence, &seq);
}

// ─── Active Pause Sequence ────────────────────────────────────────────────────

/// Returns the sequence number of the currently active pause, if any.
pub fn get_active_pause_seq(env: &Env) -> Option<u64> {
    env.storage().instance().get(&CbKey::ActivePauseSeq)
}

/// Sets the active pause sequence number (called when a pause begins).
pub fn set_active_pause_seq(env: &Env, seq: u64) {
    env.storage()
        .instance()
        .set(&CbKey::ActivePauseSeq, &seq);
}

/// Clears the active pause sequence number (called when an unpause completes).
pub fn clear_active_pause_seq(env: &Env) {
    env.storage().instance().remove(&CbKey::ActivePauseSeq);
}

// ─── Pause Records ────────────────────────────────────────────────────────────

/// Persists a `PauseRecord` keyed by its sequence number.
pub fn save_pause_record(env: &Env, record: &PauseRecord) {
    env.storage()
        .persistent()
        .set(&CbKey::PauseRecord(record.seq), record);
}

/// Retrieves a `PauseRecord` by sequence number, or `None` if not found.
pub fn get_pause_record_by_seq(env: &Env, seq: u64) -> Option<PauseRecord> {
    env.storage()
        .persistent()
        .get(&CbKey::PauseRecord(seq))
}

// ─── Unpause Records ──────────────────────────────────────────────────────────

/// Persists an `UnpauseRecord` keyed by the pause sequence it resolved.
pub fn save_unpause_record(env: &Env, record: &UnpauseRecord) {
    env.storage()
        .persistent()
        .set(&CbKey::UnpauseRecord(record.pause_seq), record);
}

/// Retrieves an `UnpauseRecord` by the pause sequence it resolved, or `None`.
pub fn get_unpause_record_by_seq(env: &Env, pause_seq: u64) -> Option<UnpauseRecord> {
    env.storage()
        .persistent()
        .get(&CbKey::UnpauseRecord(pause_seq))
}

// ─── Timelock Configuration ───────────────────────────────────────────────────

/// Returns the configured timelock duration in seconds.
/// Defaults to **0** (no timelock) if never set.
pub fn get_timelock_seconds(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&CbKey::PauseTimelockSeconds)
        .unwrap_or(0)
}

/// Persists the timelock duration in seconds.
pub fn set_timelock_seconds(env: &Env, seconds: u64) {
    env.storage()
        .instance()
        .set(&CbKey::PauseTimelockSeconds, &seconds);
}

// ─── Unpause Quorum Configuration ────────────────────────────────────────────

/// Returns the minimum number of admin votes required to unpause.
/// Defaults to **1** if never set.
pub fn get_unpause_quorum(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&CbKey::UnpauseQuorum)
        .unwrap_or(1)
}

/// Persists the unpause quorum value.
pub fn set_unpause_quorum(env: &Env, quorum: u32) {
    env.storage()
        .instance()
        .set(&CbKey::UnpauseQuorum, &quorum);
}

// ─── Per-Sequence Vote Count ──────────────────────────────────────────────────

/// Returns the number of votes cast for the pause identified by `seq`.
/// Defaults to 0 if never set.
pub fn get_vote_count_for_seq(env: &Env, seq: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&CbKey::UnpauseVoteCountForSeq(seq))
        .unwrap_or(0)
}

/// Persists the vote count for the pause identified by `seq`.
pub fn set_vote_count_for_seq(env: &Env, seq: u64, count: u32) {
    env.storage()
        .persistent()
        .set(&CbKey::UnpauseVoteCountForSeq(seq), &count);
}

// ─── Per-Voter Flags ──────────────────────────────────────────────────────────

/// Returns `true` if `voter` has already voted for the pause identified by `pause_seq`.
pub fn has_voted(env: &Env, pause_seq: u64, voter: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&CbKey::UnpauseVote(pause_seq, voter.clone()))
        .unwrap_or(false)
}

/// Records that `voter` has voted for the pause identified by `pause_seq`.
pub fn record_vote(env: &Env, pause_seq: u64, voter: &Address) {
    env.storage()
        .persistent()
        .set(&CbKey::UnpauseVote(pause_seq, voter.clone()), &true);
}
