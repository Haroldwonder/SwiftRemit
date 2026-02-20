use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RemittanceStatus {
    Pending,
    Completed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Remittance {
    pub id: u64,
    pub sender: Address,
    pub agent: Address,
    pub amount: i128,
    pub fee: i128,
    pub status: RemittanceStatus,
    pub expiry: Option<u64>,
}

/// Entry for batch settlement operation
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchSettleEntry {
    pub remittance_id: u64,
}

/// Result of a single settlement in a batch operation
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchSettleResult {
    pub remittance_id: u64,
    pub success: bool,
    pub payout_amount: i128,
}

/// Internal struct to hold validated settlement data during batch processing
#[contracttype]
#[derive(Clone)]
pub struct ValidatedSettlement {
    pub remittance_id: u64,
    pub agent: Address,
    pub payout_amount: i128,
    pub fee: i128,
    pub sender: Address,
}
