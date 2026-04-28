//! Fee strategy module for flexible fee calculation.
//!
//! Supports multiple fee strategies that can be configured at runtime without
//! a WASM upgrade. The active strategy is stored in instance storage and can
//! be changed by an admin via `set_fee_strategy` / `update_fee_strategy`.
//!
//! Variants:
//! - Percentage (PercentageBps): Fee based on percentage of amount (basis points)
//! - Flat: Fixed fee regardless of amount
//! - Dynamic (Tiered): Fee varies based on amount tiers
//! - Corridor: Delegates to a per-corridor fee configuration

use soroban_sdk::contracttype;

/// On-chain fee strategy selector.
///
/// Stored in instance storage under `DataKey::FeeStrategy`. Changing this value
/// takes effect immediately for all subsequent remittances — no contract upgrade
/// is required.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FeeStrategy {
    /// Percentage-based fee in basis points (e.g. 250 = 2.5%)
    Percentage(u32),
    /// Flat fee amount in token stroops, regardless of transaction size
    Flat(i128),
    /// Dynamic tiered fee: base rate in bps, discounted for larger amounts
    Dynamic(u32),
    /// Corridor-based fee: delegates to the per-corridor `FeeCorridor` config.
    /// Falls back to `Percentage` with the stored `PlatformFeeBps` when no
    /// corridor is configured for the given country pair.
    Corridor,
}
