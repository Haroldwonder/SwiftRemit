//! Data structures and types for the remittance contract.

use soroban_sdk::{contracttype, Address, BytesN, String};

/// Status of a remittance transfer.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RemittanceStatus {
    Pending,
    Completed,
    Cancelled,
}

/// A remittance transfer between a sender and a recipient.
///
/// # Proof validation
///
/// `proof` carries the off-chain verification proof that must be validated
/// before a payout can be confirmed. It is the cryptographic evidence that the
/// off-chain/oracle conditions for the transfer were met, and is checked by
/// `confirm_payout` so that settlements are no longer authorized solely by the
/// agent. An empty/zero proof is treated as missing and rejected during
/// validation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Remittance {
    /// Unique identifier of the remittance.
    pub id: u64,
    /// Address of the sender funding the transfer.
    pub sender: Address,
    /// Address of the intended recipient.
    pub recipient: Address,
    /// Amount to be transferred, in the smallest unit of the asset.
    pub amount: i128,
    /// Address of the agent authorized to confirm the payout.
    pub agent: Address,
    /// Current status of the remittance.
    pub status: RemittanceStatus,
    /// Off-chain verification proof validated before the payout is confirmed.
    pub proof: BytesN<32>,
    /// Optional memo attached to the transfer.
    pub memo: Option<String>,
}
