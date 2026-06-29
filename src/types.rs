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
/// ```text
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
    ///
    /// `Failed` and `Disputed` are intentionally excluded — they are transient states
    /// from which further transitions are permitted (`Failed → Disputed`,
    /// `Disputed → Completed | Cancelled` via `resolve_dispute`).
    /// Only `Completed` and `Cancelled` are truly terminal.
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

/// Contracttype-compatible wrapper for Option<SettlementConfig>.
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

/// Contracttype-compatible Option wrapper for SettlementConfig.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MaybeSettlementConfig {
    None,
    Some(SettlementConfig),
}

impl From<Option<SettlementConfig>> for MaybeSettlementConfig {
    fn from(opt: Option<SettlementConfig>) -> Self {
        match opt {
            None => MaybeSettlementConfig::None,
            Some(v) => MaybeSettlementConfig::Some(v),
        }
    }
}

impl From<MaybeSettlementConfig> for Option<SettlementConfig> {
    fn from(m: MaybeSettlementConfig) -> Self {
        match m {
            MaybeSettlementConfig::None => None,
            MaybeSettlementConfig::Some(v) => Some(v),
        }
    }
}

/// Contracttype-compatible Option wrapper for BytesN<32>.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MaybeBytes32 {
    None,
    Some(soroban_sdk::BytesN<32>),
}

impl From<Option<soroban_sdk::BytesN<32>>> for MaybeBytes32 {
    fn from(opt: Option<soroban_sdk::BytesN<32>>) -> Self {
        match opt {
            None => MaybeBytes32::None,
            Some(v) => MaybeBytes32::Some(v),
        }
    }
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
    pub settlement_config: MaybeSettlementConfig,
    /// The specific token address used for this remittance
    pub token: Address,
    /// Ledger timestamp when the remittance was created
    pub created_at: u64,
    /// Ledger timestamp when the agent marked it as failed, if applicable
    pub failed_at: Option<u64>,
    /// Hash of evidence provided by the sender during a dispute
    pub dispute_evidence: MaybeBytes32,
    /// Ledger timestamp after which anyone can call expire_remittance to refund the sender
    pub expires_at: Option<u64>,
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

/// Volume history bucket for rolling sender discount calculations.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SenderVolumeEntry {
    pub bucket_start: u64,
    pub amount: i128,
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
// Multi-Signature Admin Operation Types
// ═══════════════════════════════════════════════════════════════════════════

/// Identifies which high-impact admin operation is being proposed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminOperationType {
    /// Update the platform fee (fee_bps field carries the new value).
    UpdateFee,
    /// Withdraw accumulated fees to an address (withdraw_to field carries the recipient).
    WithdrawFees,
    /// Pause the contract (emergency stop).
    Pause,
    /// Unpause the contract.
    Unpause,
}

/// A pending multi-sig admin operation awaiting sufficient approvals.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PendingOperation {
    /// Unique auto-incremented ID for this operation.
    pub id: u64,
    /// Which admin operation is being proposed.
    pub operation_type: AdminOperationType,
    /// Admin who proposed the operation (counted as first approval).
    pub proposer: Address,
    /// Addresses that have approved so far (includes proposer).
    pub approvers: Vec<Address>,
    /// Number of approvals required to auto-execute.
    pub threshold: u32,
    /// Ledger timestamp when the operation was proposed.
    pub proposed_at: u64,
    /// Seconds after proposed_at before this operation expires.
    pub ttl_seconds: u64,
    /// New fee in basis points — only used for UpdateFee operations.
    pub fee_bps: u32,
    /// Fee withdrawal recipient — only used for WithdrawFees operations.
    pub withdraw_to: Option<Address>,
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
    /// Ledger timestamp when this record was created
    pub created_at: u64,
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
    /// Update the post-unpause cooldown period in seconds (0 = disabled).
    UpdateCooldownPeriod(u64),
    /// Add the given token address to the asset allowlist (#832).
    /// Enables remittances denominated in that Stellar-native asset.
    WhitelistAsset(Address),
    /// Adjust the minimum agent reputation threshold (#833).
    /// Agents with a score below this value cannot accept new remittances.
    AdjustReputationThreshold(u32),
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
    /// Ledger timestamp before which the proposal cannot be executed (timelock enforced).
    pub execute_after: Option<u64>,
}

/// Record of a single partial payout disbursement for a remittance.
///
/// Stored per remittance to enable cumulative payout state reconstruction
/// without additional on-chain queries.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PartialPayoutRecord {
    /// Amount disbursed in this payout
    pub amount: i128,
    /// Cumulative total disbursed (including this payout)
    pub total_disbursed: i128,
    /// Remaining amount left to disburse (net_payout - total_disbursed)
    pub remaining_amount: i128,
    /// Ledger timestamp when this disbursement occurred
    pub timestamp: u64,
    /// Ledger sequence when this disbursement occurred
    pub ledger_sequence: u32,
}
