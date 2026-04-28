//! Type definitions for the SwiftRemit contract.
//!
//! This module defines the core data structures used throughout the contract,
//! including remittance records and status enums.

use soroban_sdk::{contracttype, Address, String, Vec};

/// Role types for authorization
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Role {
    Admin,
    Settler,
}

/// Canonical state enum representing the full remittance lifecycle.
///
/// This single enum replaces the previously separate `RemittanceStatus` and
/// `TransferState` enums, which modelled the same entity with overlapping states.
///
/// # State Machine
///
/// ```
/// Pending → Processing → Completed
///         ↘            ↘
///           Cancelled    Cancelled
/// ```
///
/// # State Descriptions
///
/// - `Pending`:    Initial state — remittance created, funds locked in escrow
/// - `Processing`: Agent has accepted and is executing the fiat payout off-chain
/// - `Completed`:  Terminal — payout confirmed, USDC released to agent
/// - `Cancelled`:  Terminal — cancelled by sender or failed payout, funds refunded
///
/// # Terminal States
///
/// `Completed` and `Cancelled` are terminal. No further transitions are allowed
/// once either is reached, ensuring data integrity.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RemittanceStatus {
    /// Initial state: remittance created, funds locked in contract
    Pending,
    /// In-flight state: agent is processing the fiat payout
    Processing,
    /// Terminal state: successfully completed, agent received payout
    Completed,
    /// Terminal state: cancelled by sender or failed, funds refunded
    Cancelled,
    /// The agent marked the payout as failed
    Failed,
    /// The sender has challenged a failed payout
    Disputed,
}

impl RemittanceStatus {
    /// Returns `true` if this is a terminal state (no further transitions allowed).
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            RemittanceStatus::Completed | RemittanceStatus::Cancelled
        )
    }

    /// Returns `true` if transitioning to `to` is a valid state machine step.
    pub fn can_transition_to(&self, to: &RemittanceStatus) -> bool {
        match (self, to) {
            // From Pending
            (RemittanceStatus::Pending, RemittanceStatus::Processing) => true,
            (RemittanceStatus::Pending, RemittanceStatus::Cancelled) => true,
            // From Processing
            (RemittanceStatus::Processing, RemittanceStatus::Completed) => true,
            (RemittanceStatus::Processing, RemittanceStatus::Cancelled) => true,
            (RemittanceStatus::Pending, RemittanceStatus::Failed) => true,
            (RemittanceStatus::Processing, RemittanceStatus::Failed) => true,
            (RemittanceStatus::Failed, RemittanceStatus::Disputed) => true,
            // Terminal states cannot transition
            (RemittanceStatus::Completed, _) => false,
            (RemittanceStatus::Cancelled, _) => false,
            // Same state is allowed (idempotent)
            (a, b) if a == b => true,
            // All other transitions are invalid
            _ => false,
        }
    }
}

/// Type alias kept for storage layer backward-compatibility.
/// All new code should use `RemittanceStatus` directly.
pub type TransferState = RemittanceStatus;

/// Cryptographic proof for off-chain settlement verification.
///
/// Contains a signed payload that proves off-chain conditions have been met
/// (e.g., fiat payment confirmation, oracle attestation).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofData {
    /// Ed25519 signature (64 bytes)
    pub signature: soroban_sdk::BytesN<64>,
    /// Signed payload containing settlement details
    pub payload: soroban_sdk::Bytes,
    /// Address of the signer (oracle or agent)
    pub signer: Address,
}

/// Configuration for settlement proof validation.
///
/// Determines whether a settlement requires cryptographic proof validation
/// and specifies the oracle address that must sign the proof.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementConfig {
    /// Whether proof validation is required for this settlement
    pub require_proof: bool,
    /// Oracle/signer address for proof validation (required if require_proof is true)
    pub oracle_address: Option<Address>,
}

/// Escrow status for locked funds
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Pending,
    Released,
    Refunded,
}

/// Escrow record for locked funds
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    pub transfer_id: u64,
    pub sender: Address,
    pub recipient: Address,
    pub amount: i128,
    pub expiry: Option<u64>,
    pub status: EscrowStatus,
}

/// A remittance transaction record.
///
/// Contains all information about a cross-border remittance including
/// parties involved, amounts, fees, status, and optional expiry.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Remittance {
    /// Unique identifier for this remittance
    pub id: u64,
    /// Address of the sender who initiated the remittance
    pub sender: Address,
    /// Address of the agent who will receive the payout
    pub agent: Address,
    /// Total amount sent by the sender (in USDC)
    pub amount: i128,
    /// Platform fee deducted from the amount (in USDC)
    pub fee: i128,
    /// Current status of the remittance
    pub status: RemittanceStatus,
    /// Optional expiry timestamp (seconds since epoch) for settlement
    pub expiry: Option<u64>,
    /// Optional settlement configuration for proof validation
    pub settlement_config: Option<SettlementConfig>,
    /// The specific token address used for this remittance
    pub token: Address,
    /// Ledger timestamp when the remittance was created
    pub created_at: u64,
    /// Ledger timestamp when the agent marked it as failed, if applicable
    pub failed_at: Option<u64>,
    /// Hash of evidence provided by the sender during a dispute
    pub dispute_evidence: Option<soroban_sdk::BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentStats {
    pub total_settlements: u32,
    pub failed_settlements: u32,
    pub total_settlement_time: u64,
    pub dispute_count: u32,
    /// Successful payouts / total * 10000 (basis points). Updated on each payout.
    pub success_rate_bps: u32,
    /// Ledger timestamp of the most recent confirm_payout or mark_failed call.
    pub last_active_timestamp: u64,
}

/// Entry for batch settlement processing.
/// Each entry represents a single remittance to be settled.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchSettlementEntry {
    /// The unique ID of the remittance to settle
    pub remittance_id: u64,
}

/// Entry for batch remittance creation.
/// Each entry represents a single remittance to be created in a batch.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchCreateEntry {
    /// Address of the agent who will receive the payout
    pub agent: Address,
    /// Amount to send (in USDC)
    pub amount: i128,
    /// Optional expiry timestamp (seconds since epoch) for settlement
    pub expiry: Option<u64>,
}

/// Result of a batch settlement operation.
/// Contains the IDs of successfully settled remittances.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchSettlementResult {
    /// List of successfully settled remittance IDs
    pub settled_ids: Vec<u64>,
}

/// Result of a settlement simulation.
/// Predicts the outcome without executing state changes.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementSimulation {
    /// Whether the settlement would succeed
    pub would_succeed: bool,
    /// The payout amount the agent would receive (amount - fee)
    pub payout_amount: i128,
    /// The platform fee that would be collected
    pub fee: i128,
    /// Error message if would_succeed is false
    pub error_message: Option<u32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DailyLimit {
    pub currency: String,
    pub country: String,
    pub limit: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferRecord {
    pub timestamp: u64,
    pub amount: i128,
    pub currency: String,
    pub country: String,
}

// ═══════════════════════════════════════════════════════════════════════════
// Circuit Breaker Types
// ═══════════════════════════════════════════════════════════════════════════

/// Structured reason for an emergency pause.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PauseReason {
    SecurityIncident,
    SuspiciousActivity,
    MaintenanceWindow,
    ExternalThreat,
}

/// Persistent record of a pause event.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseRecord {
    /// Monotonically increasing sequence number for this pause event.
    pub seq: u64,
    /// Address that triggered the pause.
    pub caller: Address,
    /// Ledger timestamp when the pause was initiated.
    pub timestamp: u64,
    /// Structured reason for the pause.
    pub reason: PauseReason,
}

/// Persistent record of an unpause event.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnpauseRecord {
    /// Address that triggered the unpause.
    pub caller: Address,
    /// Ledger timestamp when the unpause occurred.
    pub timestamp: u64,
    /// Sequence number of the pause event this unpause corresponds to.
    pub pause_seq: u64,
}

/// Snapshot of the full circuit-breaker state returned by `get_circuit_breaker_status`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircuitBreakerStatus {
    /// Whether the contract is currently paused.
    pub is_paused: bool,
    /// Active pause reason, or `None` when not paused.
    pub pause_reason: Option<PauseReason>,
    /// Ledger timestamp of the active pause, or `None` when not paused.
    pub pause_timestamp: Option<u64>,
    /// Configured timelock duration in seconds (0 = no timelock).
    pub timelock_seconds: u64,
    /// Minimum number of admin votes required to unpause.
    pub unpause_quorum: u32,
    /// Number of votes cast for the current pause instance.
    pub current_vote_count: u32,
}

/// Idempotency record for duplicate remittance prevention.
///
/// Stores the result of a remittance creation request to enable safe retries.
/// If a client retries with the same idempotency key and identical payload,
/// the contract returns the same remittance_id without creating a duplicate.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdempotencyRecord {
    /// The client-provided idempotency key
    pub key: String,
    /// SHA-256 hash of the request payload (sender, agent, amount, expiry)
    pub request_hash: soroban_sdk::BytesN<32>,
    /// The remittance ID returned from the original request
    pub remittance_id: u64,
    /// Timestamp when this record expires (ledger timestamp)
    pub expires_at: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Governance Types
// ─────────────────────────────────────────────────────────────────────────────

/// The action a governance proposal will execute if approved.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalAction {
    /// Update the platform fee to the given basis points value.
    UpdateFee(u32),
    /// Register the given address as a payout agent.
    RegisterAgent(Address),
    /// Remove the given address from the payout agent set.
    RemoveAgent(Address),
    /// Grant Admin role to the given address.
    AddAdmin(Address),
    /// Revoke Admin role from the given address.
    RemoveAdmin(Address),
    /// Update the governance quorum threshold.
    UpdateQuorum(u32),
    /// Update the governance execution timelock in seconds.
    UpdateTimelock(u64),
}

/// Lifecycle state of a governance proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalState {
    Pending,
    Approved,
    Executed,
    Expired,
}

/// Governance configuration returned by `query_governance_config`.
///
/// Bundles quorum, timelock, and proposal TTL into a single queryable struct
/// so integrators and frontends can inspect all governance parameters in one call.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceConfig {
    /// Minimum number of admin approvals required to pass a proposal.
    pub quorum: u32,
    /// Seconds that must elapse between approval and execution.
    pub timelock_seconds: u64,
    /// Seconds after creation before a proposal expires.
    pub proposal_ttl_seconds: u64,
}

/// A governance proposal record stored on-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    /// Unique monotonically increasing proposal identifier.
    pub id: u64,
    /// Address that created this proposal.
    pub proposer: Address,
    /// The action to execute when approved.
    pub action: ProposalAction,
    /// Current lifecycle state.
    pub state: ProposalState,
    /// Ledger timestamp when the proposal was created.
    pub created_at: u64,
    /// Ledger timestamp after which the proposal expires if not executed.
    pub expiry: u64,
    /// Number of distinct admin approvals received.
    pub approval_count: u32,
    /// Ledger timestamp when quorum was reached (set on Approved transition).
    pub approval_timestamp: Option<u64>,
}
