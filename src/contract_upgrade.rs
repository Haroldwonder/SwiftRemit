//! Contract Upgrade Module with Multi-Sig and Timelock
//! 
//! This module provides secure contract upgrade authorization using:
//! - M-of-N multi-signature approval from admins
//! - 48-hour timelock delay before execution
//! - Security events for all state changes
//!
//! # Usage
//! 
//! ```rust
//! use crate::contract_upgrade::{ContractUpgrade, UpgradeProposal};
//! 
//! // Create upgrade proposal (requires admin auth)
//! let proposal_id = contract.propose_upgrade(&admin, &new_wasm_hash);
//! 
//! // Approve (requires M admins, M = admin_count / 2 + 1)
//! contract.approve_upgrade(&admin2, &proposal_id);
//! 
//! // Execute after 48h timelock
//! contract.execute_upgrade(&admin, &proposal_id);
//! ```

use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};
use crate::ContractError;

// ============================================================================
// Constants
// ============================================================================

/// Minimum timelock period in seconds (48 hours)
pub const TIMELOCK_SECONDS: u64 = 48 * 60 * 60;

/// Minimum number of admins required for multi-sig
pub const MIN_ADMINS_FOR_UPGRADE: u32 = 3;

/// Maximum number of pending proposals to prevent storage bloat
pub const MAX_PENDING_UPGRADES: u32 = 5;

// ============================================================================
// Data Types
// ============================================================================

/// Status of an upgrade proposal
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum UpgradeStatus {
    /// Proposed, pending approvals
    Pending,
    /// Approved by enough admins, awaiting timelock
    Approved,
    /// Timelock expired, ready for execution
    Ready,
    /// Successfully executed
    Executed,
    /// Rejected or expired
    Rejected,
}

/// A single upgrade proposal with approval tracking
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UpgradeProposal {
    /// Unique proposal ID (hash of wasm_hash + timestamp)
    pub id: BytesN<32>,
    
    /// New WASM code hash
    pub wasm_hash: BytesN<32>,
    
    /// Current status
    pub status: UpgradeStatus,
    
    /// Timestamp when proposal was created
    pub created_at: u64,
    
    /// Timestamp when timelock expires (set after approval)
    pub timelock_expires_at: u64,
    
    /// Admin addresses that have approved (Vec of Address)
    pub approvals: Vec<Address>,
    
    /// Admin who created the proposal
    pub proposer: Address,
}

/// Storage key for upgrade proposals
#[contracttype]
#[derive(Clone, Debug)]
pub enum UpgradeKey {
    /// Key for pending proposals (index -> proposal)
    Proposal(u32),
    /// Next proposal ID counter
    NextId,
    /// Number of pending proposals
    PendingCount,
}

// ============================================================================
// Storage Functions
// ============================================================================

/// Get proposal by index
pub fn get_proposal(env: &Env, index: u32) -> Option<UpgradeProposal> {
    env.storage()
        .persistent()
        .get(&UpgradeKey::Proposal(index))
}

/// Store a proposal
pub fn store_proposal(env: &Env, index: u32, proposal: &UpgradeProposal) {
    env.storage()
        .persistent()
        .set(&UpgradeKey::Proposal(index), proposal);
}

/// Get next proposal ID
pub fn get_next_id(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&UpgradeKey::NextId)
        .unwrap_or(0)
}

/// Increment and return next proposal ID
pub fn bump_next_id(env: &Env) -> u32 {
    let next = get_next_id(env);
    env.storage()
        .instance()
        .set(&UpgradeKey::NextId, &(next + 1));
    next
}

// ============================================================================
// Validation Functions
// ============================================================================

/// Validate that caller is a registered admin (part of the admin-role set, not just
/// the legacy single `Admin` address) and require their signature.
pub fn require_upgrade_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
    crate::storage::require_admin(env, caller)
}

/// Check if enough approvals for execution
fn has_quorum(approvals: &Vec<Address>, admin_count: u32) -> bool {
    let required = (admin_count / 2) + 1;
    approvals.len() >= required
}

// ============================================================================
// Main Functions
// ============================================================================

/// Propose a contract upgrade
/// 
/// Requires admin authentication. Creates a new proposal that will require:
/// - M-of-N admin approvals (M = admin_count / 2 + 1)
/// - 48-hour timelock after approval
/// 
/// # Arguments
/// * `caller` - Admin address proposing the upgrade
/// * `wasm_hash` - Hash of new WASM code
/// 
/// # Returns
/// * `Ok(proposal_id)` - ID to track this proposal
/// * `Err(ContractError)` - If not authorized or too many pending
pub fn propose_upgrade(
    env: &Env,
    caller: Address,
    wasm_hash: BytesN<32>,
) -> Result<BytesN<32>, ContractError> {
    // Require admin auth
    require_upgrade_admin(env, &caller)?;

    // Upgrade governance only makes sense once enough independent admins exist
    // to form a real M-of-N quorum; otherwise a single admin could rubber-stamp
    // their own upgrade.
    if crate::storage::get_admin_count(env) < MIN_ADMINS_FOR_UPGRADE {
        return Err(ContractError::InsufficientAdmins);
    }

    // Check pending count limit
    let pending_count: u32 = env
        .storage()
        .instance()
        .get(&UpgradeKey::PendingCount)
        .unwrap_or(0);

    if pending_count >= MAX_PENDING_UPGRADES {
        return Err(ContractError::InvalidAmount);
    }

    // Generate proposal ID from wasm_hash + timestamp
    let timestamp = env.ledger().timestamp();
    let mut id_input = soroban_sdk::Bytes::new(env);
    id_input.append(&soroban_sdk::Bytes::from_array(env, &wasm_hash.to_array()));
    id_input.extend_from_array(&timestamp.to_be_bytes());
    let id: BytesN<32> = env.crypto().sha256(&id_input).into();
    
    // Create proposal
    let mut approvals: Vec<Address> = Vec::new(env);
    approvals.push_back(caller.clone());
    
    let proposal = UpgradeProposal {
        id: id.clone(),
        wasm_hash: wasm_hash.clone(),
        status: UpgradeStatus::Pending,
        created_at: timestamp,
        timelock_expires_at: 0,
        approvals,
        proposer: caller,
    };
    
    // Store proposal
    let index = bump_next_id(env);
    store_proposal(env, index, &proposal);
    
    // Increment pending count
    env.storage()
        .instance()
        .set(&UpgradeKey::PendingCount, &(pending_count + 1));
    
    // Emit event
    emit_upgrade_proposed(env, id.clone(), wasm_hash);

    Ok(id)
}

/// Approve an upgrade proposal
/// 
/// Each admin can approve once. When M-of-N (M = admin_count/2+1)
/// approvals received, timelock starts.
/// 
/// # Arguments
/// * `caller` - Admin approving
/// * `proposal_id` - ID of proposal to approve
/// 
/// # Returns
/// * `Ok(())` - Approval recorded
/// * `Err(ContractError)` - If not authorized or invalid proposal
pub fn approve_upgrade(
    env: &Env,
    caller: Address,
    proposal_id: BytesN<32>,
) -> Result<(), ContractError> {
    require_upgrade_admin(env, &caller)?;
    
    // Find proposal
    let mut found: Option<(u32, UpgradeProposal)> = None;
    let next_id = get_next_id(env);
    for i in 0..next_id {
        if let Some(p) = get_proposal(env, i) {
            if p.id == proposal_id {
                found = Some((i, p));
                break;
            }
        }
    }
    
    let (index, mut proposal) = found
        .ok_or(ContractError::NotFound)?;
    
    // Check status
    if proposal.status != UpgradeStatus::Pending 
       && proposal.status != UpgradeStatus::Approved 
    {
        return Err(ContractError::InvalidStateTransition);
    }
    
    // Check if already approved by this admin
    let mut already_approved = false;
    for a in proposal.approvals.iter() {
        if a == caller {
            already_approved = true;
            break;
        }
    }
    if already_approved {
        return Err(ContractError::AlreadyInitialized);
    }
    
    // Add approval
    proposal.approvals.push_back(caller.clone());
    
    // Check if quorum reached (need majority of the *actual* registered admins,
    // not a hardcoded stand-in — otherwise quorum could be satisfied well below
    // the real admin set size).
    let admin_count = crate::storage::get_admin_count(env);
    if has_quorum(&proposal.approvals, admin_count) {
        // Set timelock
        let timelock_expires = env.ledger().timestamp() + TIMELOCK_SECONDS;
        proposal.timelock_expires_at = timelock_expires;
        proposal.status = UpgradeStatus::Approved;
    }
    
    // Store updated proposal
    store_proposal(env, index, &proposal);
    
    // Emit event
    emit_upgrade_approved(env, proposal_id, proposal.approvals.len());
    
    Ok(())
}

/// Execute an upgrade after timelock
/// 
/// Only callable after:
/// - Enough admins approved (M-of-N)
/// - 48 hours passed since approval
/// 
/// # Arguments
/// * `caller` - Admin executing
/// * `proposal_id` - ID of proposal to execute
/// 
/// # Returns
/// * `Ok(())` - Upgrade executed
/// * `Err(ContractError)` - If timelock not expired or invalid
pub fn execute_upgrade(
    env: &Env,
    caller: Address,
    proposal_id: BytesN<32>,
) -> Result<(), ContractError> {
    require_upgrade_admin(env, &caller)?;
    
    // Find proposal
    let mut found: Option<(u32, UpgradeProposal)> = None;
    let next_id = get_next_id(env);
    for i in 0..next_id {
        if let Some(p) = get_proposal(env, i) {
            if p.id == proposal_id {
                found = Some((i, p));
                break;
            }
        }
    }
    
    let (index, mut proposal) = found
        .ok_or(ContractError::NotFound)?;
    
    // Check status
    if proposal.status != UpgradeStatus::Approved {
        return Err(ContractError::InvalidStateTransition);
    }
    
    // Check timelock
    let now = env.ledger().timestamp();
    if now < proposal.timelock_expires_at {
        return Err(ContractError::CooldownActive);
    }
    
    // Perform the actual on-chain WASM upgrade. This is the step that was
    // previously missing entirely: the proposal used to just flip to
    // `Executed` without ever replacing the contract's code, so this module's
    // governance had no real effect on-chain.
    env.deployer()
        .update_current_contract_wasm(proposal.wasm_hash.clone());

    proposal.status = UpgradeStatus::Executed;
    store_proposal(env, index, &proposal);

    // Decrement pending count
    let pending_count: u32 = env
        .storage()
        .instance()
        .get(&UpgradeKey::PendingCount)
        .unwrap_or(0);
    if pending_count > 0 {
        env.storage()
            .instance()
            .set(&UpgradeKey::PendingCount, &(pending_count - 1));
    }

    // Emit event
    emit_upgrade_executed(env, proposal_id);
    
    Ok(())
}

/// Cancel a pending upgrade proposal
pub fn cancel_upgrade(
    env: &Env,
    caller: Address,
    proposal_id: BytesN<32>,
) -> Result<(), ContractError> {
    require_upgrade_admin(env, &caller)?;
    
    // Find proposal
    let mut found: Option<(u32, UpgradeProposal)> = None;
    let next_id = get_next_id(env);
    for i in 0..next_id {
        if let Some(p) = get_proposal(env, i) {
            if p.id == proposal_id {
                found = Some((i, p));
                break;
            }
        }
    }
    
    let (index, mut proposal) = found
        .ok_or(ContractError::NotFound)?;
    
    // Only proposer or any admin can cancel pending proposals
    if proposal.status != UpgradeStatus::Pending 
       && proposal.status != UpgradeStatus::Approved 
    {
        return Err(ContractError::InvalidStateTransition);
    }
    
    proposal.status = UpgradeStatus::Rejected;
    store_proposal(env, index, &proposal);

    // Decrement pending
    let pending_count: u32 = env
        .storage()
        .instance()
        .get(&UpgradeKey::PendingCount)
        .unwrap_or(0);
    if pending_count > 0 {
        env.storage()
            .instance()
            .set(&UpgradeKey::PendingCount, &(pending_count - 1));
    }

    Ok(())
}

// ============================================================================
// Simulation (read-only)
// ============================================================================

/// Result returned by simulate_upgrade — no state is modified.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UpgradeSimulationResult {
    /// Current schema version stored on-chain (0 if unset)
    pub current_schema_version: u32,
    /// Schema version encoded in the new WASM hash (derived heuristically)
    pub new_schema_version: u32,
    /// Delta between new and current schema versions
    pub schema_version_delta: i32,
    /// Estimated number of migration steps required
    pub estimated_migration_steps: u32,
    /// Storage keys that would be touched during migration
    pub affected_storage_keys: Vec<soroban_sdk::String>,
    /// Whether the upgrade would require a data migration
    pub requires_migration: bool,
}

/// Simulate an upgrade without applying any state changes.
///
/// This is a read-only function: it inspects the current on-chain state and
/// the supplied `new_wasm_hash` to produce a preview of what a real upgrade
/// would do.  No storage is written.
///
/// # Arguments
/// * `new_wasm_hash` - Hash of the candidate WASM binary
///
/// # Returns
/// * `Ok(UpgradeSimulationResult)` with migration preview
/// * `Err(ContractError::InvalidInput)` if the hash is the null (all-zero) hash,
///   which cannot correspond to any uploaded WASM blob
pub fn simulate_upgrade(
    env: &Env,
    new_wasm_hash: BytesN<32>,
) -> Result<UpgradeSimulationResult, ContractError> {
    // Reject the null/all-zero hash — it cannot correspond to any uploaded WASM.
    if new_wasm_hash.iter().all(|b| b == 0) {
        return Err(ContractError::InvalidAmount);
    }

    // Read current schema version (stored by previous migrations, default 0)
    let current_schema_version: u32 = env
        .storage()
        .instance()
        .get(&soroban_sdk::symbol_short!("schema_v"))
        .unwrap_or(0u32);

    // Derive a candidate schema version from the first byte of the wasm hash.
    // In production this would be read from a version manifest embedded in the
    // WASM metadata; here we use a deterministic heuristic so the function is
    // always meaningful without off-chain tooling.
    let first_byte = new_wasm_hash.get(0).unwrap_or(0) as u32;
    let new_schema_version = current_schema_version + 1 + (first_byte % 3);

    let schema_version_delta = new_schema_version as i32 - current_schema_version as i32;
    let requires_migration = schema_version_delta > 0;

    // Estimate migration steps: one step per schema version bump, plus one
    // extra step if there are pending upgrade proposals to clean up.
    let pending_count: u32 = env
        .storage()
        .instance()
        .get(&UpgradeKey::PendingCount)
        .unwrap_or(0u32);
    let estimated_migration_steps =
        schema_version_delta.unsigned_abs() + if pending_count > 0 { 1 } else { 0 };

    // List storage keys that would be affected.  These are the well-known keys
    // managed by this module; a real implementation would enumerate all keys
    // that the migration script touches.
    let mut affected_keys: Vec<soroban_sdk::String> = Vec::new(env);
    if requires_migration {
        affected_keys.push_back(soroban_sdk::String::from_str(env, "schema_v"));
        affected_keys.push_back(soroban_sdk::String::from_str(env, "UpgradeKey::NextId"));
        affected_keys.push_back(soroban_sdk::String::from_str(env, "UpgradeKey::PendingCount"));
    }

    Ok(UpgradeSimulationResult {
        current_schema_version,
        new_schema_version,
        schema_version_delta,
        estimated_migration_steps,
        affected_storage_keys: affected_keys,
        requires_migration,
    })
}

// ============================================================================
// Events
// ============================================================================

use soroban_sdk::symbol_short;

/// Emit event when upgrade is proposed
fn emit_upgrade_proposed(env: &Env, id: BytesN<32>, wasm_hash: BytesN<32>) {
    env.events()
        .publish((symbol_short!("upg_prop"), id), wasm_hash);
}

/// Emit event when upgrade is approved
fn emit_upgrade_approved(env: &Env, id: BytesN<32>, approval_count: u32) {
    env.events()
        .publish((symbol_short!("upg_appr"), id), approval_count);
}

/// Emit event when upgrade is executed
fn emit_upgrade_executed(env: &Env, id: BytesN<32>) {
    env.events()
        .publish((symbol_short!("upg_exec"), id), ());
}