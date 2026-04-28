//! Governance module for SwiftRemit.
//!
//! Implements the multi-sig / DAO proposal lifecycle:
//! propose → vote → execute (with optional timelock) or expire.
//!
//! All privileged operations (fee updates, agent management, admin set changes)
//! are gated behind a configurable quorum of admin approvals.

use soroban_sdk::{Address, Env, Symbol};

use crate::{
    events::{
        emit_agent_management_proposed, emit_agent_registered, emit_agent_removed,
        emit_fee_update_proposed, emit_fee_updated, emit_governance_admin_added,
        emit_governance_admin_removed, emit_proposal_approved, emit_proposal_cleaned_up,
        emit_proposal_created, emit_proposal_executed, emit_proposal_expired, emit_proposal_voted,
    },
    storage::{
        self, add_admin_to_list, assign_role, delete_proposal, get_active_fee_proposal,
        get_governance_quorum, get_governance_timelock, get_proposal, get_proposal_ttl,
        has_governance_voted, is_agent_registered, is_governance_initialized,
        next_proposal_id, record_governance_vote, remove_admin_from_list, remove_role,
        set_active_fee_proposal, set_governance_initialized, set_governance_quorum,
        set_governance_timelock, set_proposal, set_proposal_ttl,
    },
    ContractError, Proposal, ProposalAction, ProposalState, Role,
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

fn require_admin_role(env: &Env, address: &Address) -> Result<(), ContractError> {
    if !storage::is_admin(env, address) {
        return Err(ContractError::Unauthorized);
    }
    Ok(())
}

fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    if storage::is_paused(env) {
        return Err(ContractError::ContractPaused);
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Public governance functions (called from lib.rs entry points)
// ─────────────────────────────────────────────────────────────────────────────

/// Creates a new governance proposal.
///
/// Validates action-specific preconditions at creation time, allocates a
/// monotonically increasing proposal ID, and emits the appropriate events.
pub fn do_propose(
    env: &Env,
    proposer: &Address,
    action: ProposalAction,
) -> Result<u64, ContractError> {
    require_admin_role(env, proposer)?;
    require_not_paused(env)?;

    // Action-specific validation at proposal creation time
    match &action {
        ProposalAction::UpdateFee(bps) => {
            if *bps > 10_000 {
                return Err(ContractError::InvalidFeeBps);
            }
            if get_active_fee_proposal(env).is_some() {
                return Err(ContractError::ProposalAlreadyPending);
            }
        }
        ProposalAction::RegisterAgent(agent) => {
            if is_agent_registered(env, agent) {
                return Err(ContractError::AgentAlreadyRegistered);
            }
        }
        ProposalAction::RemoveAgent(agent) => {
            if !is_agent_registered(env, agent) {
                return Err(ContractError::AgentNotRegistered);
            }
        }
        ProposalAction::AddAdmin(addr) => {
            if storage::is_admin(env, addr) {
                return Err(ContractError::AlreadyAdmin);
            }
        }
        ProposalAction::RemoveAdmin(addr) => {
            let count = storage::get_admin_count(env);
            let quorum = get_governance_quorum(env);
            // Must keep at least 1 admin and must not drop below quorum
            if count <= 1 || count.saturating_sub(1) < quorum {
                return Err(ContractError::InsufficientAdmins);
            }
            if !storage::is_admin(env, addr) {
                return Err(ContractError::AdminNotFound);
            }
        }
        ProposalAction::UpdateQuorum(q) => {
            let count = storage::get_admin_count(env);
            if *q == 0 || *q > count {
                return Err(ContractError::InvalidQuorum);
            }
        }
        ProposalAction::UpdateTimelock(_) => {}
    }

    let id = next_proposal_id(env);
    let now = env.ledger().timestamp();
    let ttl = get_proposal_ttl(env);

    let proposal = Proposal {
        id,
        proposer: proposer.clone(),
        action: action.clone(),
        state: ProposalState::Pending,
        created_at: now,
        expiry: now + ttl,
        approval_count: 0,
        approval_timestamp: None,
    };
    set_proposal(env, &proposal);

    // Set active fee proposal guard
    if let ProposalAction::UpdateFee(_) = &action {
        set_active_fee_proposal(env, Some(id));
    }

    // Emit action-specific creation events
    let action_sym = action_type_symbol(env, &action);
    emit_proposal_created(env, id, proposer.clone(), action_sym, proposal.expiry);

    match &action {
        ProposalAction::UpdateFee(bps) => {
            emit_fee_update_proposed(env, id, *bps);
        }
        ProposalAction::RegisterAgent(agent) => {
            emit_agent_management_proposed(
                env,
                id,
                agent.clone(),
                Symbol::new(env, "register"),
            );
        }
        ProposalAction::RemoveAgent(agent) => {
            emit_agent_management_proposed(
                env,
                id,
                agent.clone(),
                Symbol::new(env, "remove"),
            );
        }
        _ => {}
    }

    Ok(id)
}

/// Casts an approval vote on a pending proposal.
///
/// When the approval count reaches quorum the proposal transitions to Approved.
pub fn do_vote(
    env: &Env,
    voter: &Address,
    proposal_id: u64,
) -> Result<(), ContractError> {
    require_admin_role(env, voter)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    if proposal.state != ProposalState::Pending {
        return Err(ContractError::InvalidProposalState);
    }
    if has_governance_voted(env, proposal_id, voter) {
        return Err(ContractError::AlreadyVoted);
    }

    record_governance_vote(env, proposal_id, voter);
    proposal.approval_count += 1;

    emit_proposal_voted(env, proposal_id, voter.clone(), proposal.approval_count);

    let quorum = get_governance_quorum(env);
    if proposal.approval_count >= quorum {
        let now = env.ledger().timestamp();
        proposal.state = ProposalState::Approved;
        proposal.approval_timestamp = Some(now);
        emit_proposal_approved(env, proposal_id, now);
    }

    set_proposal(env, &proposal);
    Ok(())
}

/// Executes an approved proposal after the timelock has elapsed.
pub fn do_execute(
    env: &Env,
    executor: &Address,
    proposal_id: u64,
) -> Result<(), ContractError> {
    require_admin_role(env, executor)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    if proposal.state != ProposalState::Approved {
        return Err(ContractError::InvalidProposalState);
    }

    let timelock = get_governance_timelock(env);
    let approved_at = proposal.approval_timestamp.unwrap_or(0);
    let now = env.ledger().timestamp();
    if now < approved_at + timelock {
        return Err(ContractError::TimelockNotElapsed);
    }

    // Dispatch the action
    dispatch_action(env, executor, &proposal.action, proposal_id)?;

    proposal.state = ProposalState::Executed;
    set_proposal(env, &proposal);

    emit_proposal_executed(env, proposal_id, executor.clone());
    Ok(())
}

/// Transitions an expired proposal to the Expired state and deletes it from storage.
///
/// Can be called by any address once the proposal TTL has elapsed.
/// Automatically deletes the proposal to prevent unbounded storage growth.
pub fn do_expire(
    env: &Env,
    proposal_id: u64,
) -> Result<(), ContractError> {
    let proposal = get_proposal(env, proposal_id)?;

    if proposal.state != ProposalState::Pending && proposal.state != ProposalState::Approved {
        return Err(ContractError::InvalidProposalState);
    }

    let now = env.ledger().timestamp();
    if now < proposal.expiry {
        return Err(ContractError::InvalidProposalState);
    }

    // Clear active fee proposal guard if applicable
    if let ProposalAction::UpdateFee(_) = &proposal.action {
        if get_active_fee_proposal(env) == Some(proposal_id) {
            set_active_fee_proposal(env, None);
        }
    }

    // Auto-delete expired proposal to prevent storage bloat
    delete_proposal(env, proposal_id);
    emit_proposal_expired(env, proposal_id);
    Ok(())
}

/// One-time migration function callable only by the legacy admin.
///
/// Sets the initial governance quorum, timelock, and proposal TTL without
/// requiring a proposal, enabling upgrade from the existing single-admin deployment.
pub fn do_migrate(
    env: &Env,
    caller: &Address,
    quorum: u32,
    timelock_seconds: u64,
    proposal_ttl_seconds: u64,
) -> Result<(), ContractError> {
    // Only the legacy admin may call this
    let legacy_admin = storage::get_admin(env)?;
    if *caller != legacy_admin {
        return Err(ContractError::Unauthorized);
    }

    if is_governance_initialized(env) {
        return Err(ContractError::GovernanceAlreadyInitialized);
    }

    let admin_count = storage::get_admin_count(env);
    if quorum == 0 || quorum > admin_count {
        return Err(ContractError::InvalidQuorum);
    }

    set_governance_quorum(env, quorum);
    set_governance_timelock(env, timelock_seconds);
    set_proposal_ttl(env, proposal_ttl_seconds);

    // Seed the admin list with the legacy admin
    add_admin_to_list(env, &legacy_admin);

    set_governance_initialized(env);
    Ok(())
}

/// Deletes expired or executed proposals from persistent storage to reclaim on-chain space.
///
/// Admin-only. For each supplied `proposal_id`:
/// - If the proposal is in `Expired` or `Executed` state it is removed from storage
///   and a `proposal_cleaned_up` event is emitted.
/// - Proposals in `Pending` or `Approved` state are skipped (not an error).
/// - Non-existent proposal IDs are silently skipped.
///
/// # Authorization
/// Caller must hold `Role::Admin`.
pub fn cleanup_expired_proposals(
    env: &Env,
    caller: &Address,
    proposal_ids: soroban_sdk::Vec<u64>,
) -> Result<(), ContractError> {
    require_admin_role(env, caller)?;

    for i in 0..proposal_ids.len() {
        let id = proposal_ids.get_unchecked(i);
        if let Ok(proposal) = get_proposal(env, id) {
            if proposal.state == ProposalState::Expired
                || proposal.state == ProposalState::Executed
            {
                delete_proposal(env, id);
                emit_proposal_cleaned_up(env, id);
            }
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Action dispatch
// ─────────────────────────────────────────────────────────────────────────────

fn dispatch_action(
    env: &Env,
    executor: &Address,
    action: &ProposalAction,
    proposal_id: u64,
) -> Result<(), ContractError> {
    match action {
        ProposalAction::UpdateFee(bps) => {
            storage::set_platform_fee_bps(env, *bps);
            set_active_fee_proposal(env, None);
            emit_fee_updated(env, *bps);
        }
        ProposalAction::RegisterAgent(agent) => {
            storage::set_agent_registered(env, agent, true);
            assign_role(env, agent, &Role::Settler);
            emit_agent_registered(env, agent.clone(), executor.clone(), None);
        }
        ProposalAction::RemoveAgent(agent) => {
            storage::set_agent_registered(env, agent, false);
            remove_role(env, agent, &Role::Settler);
            emit_agent_removed(env, agent.clone(), executor.clone());
        }
        ProposalAction::AddAdmin(addr) => {
            if storage::is_admin(env, addr) {
                return Err(ContractError::AlreadyAdmin);
            }
            storage::set_admin_role(env, addr, true);
            assign_role(env, addr, &Role::Admin);
            let count = storage::get_admin_count(env);
            storage::set_admin_count(env, count + 1);
            add_admin_to_list(env, addr);
            emit_governance_admin_added(env, addr.clone(), proposal_id);
        }
        ProposalAction::RemoveAdmin(addr) => {
            let count = storage::get_admin_count(env);
            let quorum = get_governance_quorum(env);
            if count <= 1 || count.saturating_sub(1) < quorum {
                return Err(ContractError::InsufficientAdmins);
            }
            storage::set_admin_role(env, addr, false);
            remove_role(env, addr, &Role::Admin);
            storage::set_admin_count(env, count - 1);
            remove_admin_from_list(env, addr);
            // Keep legacy admin key aligned
            if let Ok(legacy) = storage::get_admin(env) {
                if legacy == *addr {
                    storage::set_admin(env, executor);
                }
            }
            emit_governance_admin_removed(env, addr.clone(), proposal_id);
        }
        ProposalAction::UpdateQuorum(q) => {
            let count = storage::get_admin_count(env);
            if *q == 0 || *q > count {
                return Err(ContractError::InvalidQuorum);
            }
            set_governance_quorum(env, *q);
        }
        ProposalAction::UpdateTimelock(s) => {
            set_governance_timelock(env, *s);
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn action_type_symbol(env: &Env, action: &ProposalAction) -> Symbol {
    match action {
        ProposalAction::UpdateFee(_) => Symbol::new(env, "update_fee"),
        ProposalAction::RegisterAgent(_) => Symbol::new(env, "reg_agent"),
        ProposalAction::RemoveAgent(_) => Symbol::new(env, "rem_agent"),
        ProposalAction::AddAdmin(_) => Symbol::new(env, "add_admin"),
        ProposalAction::RemoveAdmin(_) => Symbol::new(env, "rem_admin"),
        ProposalAction::UpdateQuorum(_) => Symbol::new(env, "upd_quorum"),
        ProposalAction::UpdateTimelock(_) => Symbol::new(env, "upd_tlock"),
    }
}
