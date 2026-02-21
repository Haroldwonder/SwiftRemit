use soroban_sdk::contracterror;

/// Contract error codes with descriptive meanings for debugging.
///
/// Each error provides specific context about what went wrong to help
/// developers quickly identify and fix integration issues.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// Contract has already been initialized. Cannot initialize twice.
    /// Cause: Calling initialize() on an already initialized contract.
    AlreadyInitialized = 1,

    /// Contract has not been initialized yet. Call initialize() first.
    /// Cause: Attempting operations before contract initialization.
    NotInitialized = 2,

    /// Amount must be greater than zero.
    /// Cause: Passing 0 or negative amount to create_remittance().
    InvalidAmount = 3,

    /// Fee basis points must be between 0-10000 (0%-100%).
    /// Cause: Setting fee_bps > 10000 in initialize() or update_fee().
    InvalidFeeBps = 4,

    /// Agent address is not registered in the system.
    /// Cause: Creating remittance with unregistered agent or agent was removed.
    AgentNotRegistered = 5,

    /// Remittance ID does not exist in storage.
    /// Cause: Querying or operating on non-existent remittance_id.
    RemittanceNotFound = 6,

    /// Operation not allowed in current remittance status.
    /// Cause: Confirming/cancelling already completed or cancelled remittance.
    InvalidStatus = 7,

    /// Invalid state transition attempted.
    /// Cause: Attempting to transition remittance to an invalid state.
    InvalidStateTransition = 24,

    /// Arithmetic operation resulted in overflow.
    /// Cause: Fee calculation or amount operations exceeded i128 limits.
    Overflow = 8,

    /// No accumulated fees available to withdraw.
    /// Cause: Calling withdraw_fees() when accumulated fees are zero.
    NoFeesToWithdraw = 9,

    /// Address validation failed.
    /// Cause: Invalid or malformed address provided.
    InvalidAddress = 10,

    /// Rate limit exceeded for this address.
    /// Cause: Too many requests within the configured time window.
    /// Action: Wait for the rate limit window to reset (default: 60 seconds).
    RateLimitExceeded = 23,

    /// Settlement window has expired.
    /// Cause: Attempting confirm_payout() after expiry timestamp.
    SettlementExpired = 11,

    /// Settlement already executed for this remittance.
    /// Cause: Attempting to settle the same remittance twice.
    DuplicateSettlement = 12,

    /// Contract is paused. Settlements are temporarily disabled.
    /// Cause: Attempting confirm_payout() while contract is in paused state.
    ContractPaused = 13,

    /// Caller is not authorized to perform admin operations.
    /// Cause: Non-admin attempting to perform admin-only operations.
    Unauthorized = 14,

    /// Admin address already exists in the system.
    /// Cause: Attempting to add an admin that is already registered.
    AdminAlreadyExists = 15,

    /// Admin address does not exist in the system.
    /// Cause: Attempting to remove an admin that is not registered.
    AdminNotFound = 16,

    /// Cannot remove the last admin from the system.
    /// Cause: Attempting to remove the only remaining admin.
    CannotRemoveLastAdmin = 17,
    
    /// Token is not whitelisted for use in the system.
    /// Cause: Attempting to initialize contract with non-whitelisted token.
    TokenNotWhitelisted = 18,
    
    /// Token is already whitelisted in the system.
    /// Cause: Attempting to add a token that is already whitelisted.
    TokenAlreadyWhitelisted = 19,
    
    /// Migration hash verification failed.
    /// Cause: Snapshot hash doesn't match computed hash (data tampering or corruption).
    InvalidMigrationHash = 20,
    
    /// Migration already in progress or completed.
    /// Cause: Attempting to start migration when one is already active.
    MigrationInProgress = 21,
    
    /// Migration batch out of order or invalid.
    /// Cause: Importing batches in wrong order or invalid batch number.
    InvalidMigrationBatch = 22,
    
    /// Daily send limit exceeded for this user.
    /// Cause: User's total transfers in the last 24 hours exceed the configured limit.
    DailySendLimitExceeded = 23,
}
