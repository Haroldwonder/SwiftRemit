use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidFeeBps = 4,
    AgentNotRegistered = 5,
    RemittanceNotFound = 6,
    InvalidStatus = 7,
    Overflow = 8,
    NoFeesToWithdraw = 9,
    InvalidAddress = 10,
    SettlementExpired = 11,
    DuplicateSettlement = 12,
    BatchEmpty = 13,
    BatchValidationFailed = 14,
    BatchPartialFailure = 15,
}
