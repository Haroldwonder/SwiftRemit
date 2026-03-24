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

/// Transfer state for on-chain registry
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransferState {
    Initiated,
    Processing,
    Completed,
    Refunded,
}

impl TransferState {
    /// Validates if transition to new state is allowed
    pub fn can_transition_to(&self, new_state: &TransferState) -> bool {
        match (self, new_state) {
            // From Initiated
            (TransferState::Initiated, TransferState::Processing) => true,
            (TransferState::Initiated, TransferState::Refunded) => true,
            // From Processing
            (TransferState::Processing, TransferState::Completed) => true,
            (TransferState::Processing, TransferState::Refunded) => true,
            // Terminal states cannot transition
            (TransferState::Completed, _) => false,
            (TransferState::Refunded, _) => false,
            // Same state is allowed (idempotent)
            (a, b) if a == b => true,
            // All other transitions invalid
            _ => false,
        }
    }
}


/// Status of a remittance transaction following a structured state machine.
///
/// State Transitions:
/// ```
/// Pending → Completed
///         ↘ Cancelled
/// ```
///
/// Terminal States: Completed, Cancelled
/// - Once a remittance reaches a terminal state, no further transitions are allowed
/// - This ensures data integrity and prevents inconsistent transfer statuses
///
/// State Descriptions:
/// - `Pending`: Initial state when remittance is created, funds locked
/// - `Completed`: Successfully completed, agent received payout
/// - `Cancelled`: Cancelled by sender, funds refunded
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RemittanceStatus {
    /// Initial state: Remittance created, funds locked in contract
    Pending,
    /// Terminal state: Successfully completed
    Completed,
    /// Terminal state: Cancelled, funds refunded
    Cancelled,
}

impl RemittanceStatus {
    /// Checks if this status is a terminal state.
    ///
    /// Terminal states (Completed, Cancelled) cannot transition to any other state.
    ///
    /// # Returns
    ///
    /// * `true` - Status is terminal (Completed or Cancelled)
    /// * `false` - Status is non-terminal and can transition
    pub fn is_terminal(&self) -> bool {
        matches!(self, RemittanceStatus::Completed | RemittanceStatus::Cancelled)
    }

    /// Checks if a transition to the target status is valid from this status.
    ///
    /// # Arguments
    ///
    /// * `to` - The target status to transition to
    ///
    /// # Returns
    ///
    /// * `true` - Transition is valid
    /// * `false` - Transition is invalid
    pub fn can_transition_to(&self, to: &RemittanceStatus) -> bool {
        match (self, to) {
            // From Pending
            (RemittanceStatus::Pending, RemittanceStatus::Completed) => true,
            (RemittanceStatus::Pending, RemittanceStatus::Cancelled) => true,
            
            // Terminal states cannot transition
            (RemittanceStatus::Completed, _) => false,
            (RemittanceStatus::Cancelled, _) => false,
            
            // All other transitions are invalid
            _ => false,
        }
    }
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
}

/// Entry for batch settlement processing.
/// Each entry represents a single remittance to be settled.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchSettlementEntry {
    /// The unique ID of the remittance to settle
    pub remittance_id: u64,
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
}
