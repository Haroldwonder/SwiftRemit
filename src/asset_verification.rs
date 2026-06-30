//! Asset verification module for Stellar assets.
//!
//! This module provides on-chain storage and verification status tracking for Stellar assets.
//! The actual verification logic (checking Stellar Expert, TOML files, etc.) is performed
//! off-chain by the backend service, and results are stored here.

use soroban_sdk::{contracttype, Address, Env, String};

use crate::ContractError;

/// Verification status for a Stellar asset.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VerificationStatus {
    /// Asset has been verified through multiple trusted sources
    Verified,
    /// Asset has not been verified or verification is pending
    Unverified,
    /// Asset has been flagged as suspicious based on verification checks
    Suspicious,
}

/// Asset verification record stored on-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetVerification {
    /// Asset code (e.g., "USDC", "BTC")
    pub asset_code: String,
    /// Issuer address
    pub issuer: Address,
    /// Current verification status
    pub status: VerificationStatus,
    /// Reputation score (0-100)
    pub reputation_score: u32,
    /// Timestamp of last verification check
    pub last_verified: u64,
    /// Number of trustlines (cached from Horizon)
    pub trustline_count: u64,
    /// Whether the asset has a valid stellar.toml
    pub has_toml: bool,
}

/// Storage key for asset verification records.
#[contracttype]
#[derive(Clone)]
pub enum AssetVerificationKey {
    /// Asset verification indexed by (asset_code, issuer)
    Verification(String, Address),
}

/// Stores an asset verification record.
pub fn set_asset_verification(env: &Env, verification: &AssetVerification) {
    let key = AssetVerificationKey::Verification(
        verification.asset_code.clone(),
        verification.issuer.clone(),
    );
    env.storage().persistent().set(&key, verification);
}

/// Retrieves an asset verification record.
pub fn get_asset_verification(
    env: &Env,
    asset_code: &String,
    issuer: &Address,
) -> Result<AssetVerification, ContractError> {
    let key = AssetVerificationKey::Verification(asset_code.clone(), issuer.clone());
    env.storage()
        .persistent()
        .get(&key)
        .ok_or(ContractError::AssetNotFound)
}

/// Checks if an asset has been verified.
pub fn has_asset_verification(env: &Env, asset_code: &String, issuer: &Address) -> bool {
    let key = AssetVerificationKey::Verification(asset_code.clone(), issuer.clone());
    env.storage().persistent().has(&key)
}
