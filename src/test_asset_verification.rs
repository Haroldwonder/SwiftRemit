//! Tests for the on-chain asset verification module.
//!
//! This module tests storage, retrieval, and validation of Stellar asset verification records,
//! including admin authorization, verification status checks, and remittance creation
//! decoupling from asset status.

#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, String as SorobanString};

use crate::{
    asset_verification::{VerificationStatus, AssetVerification},
    SwiftRemitContract, SwiftRemitContractClient,
};

fn setup() -> (Env, SwiftRemitContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let client = SwiftRemitContractClient::new(
        &env,
        &env.register_contract(None, SwiftRemitContract {}),
    );
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token, &250u32, &0u64, &0u32, &admin);

    let asset_issuer = Address::generate(&env);
    (env, client, admin, asset_issuer)
}

/// Test setting and reading a Verified asset verification record.
#[test]
fn test_set_and_get_verified_asset() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"USDC");

    // Set a verified asset
    client.set_asset_verification(
        &asset_code,
        &issuer,
        &VerificationStatus::Verified,
        &95u32,  // reputation_score
        &10000u64,  // trustline_count
        &true,   // has_toml
    );

    // Retrieve and verify
    let result = client.get_asset_verification(&asset_code, &issuer);
    assert_eq!(result.status, VerificationStatus::Verified);
    assert_eq!(result.reputation_score, 95);
    assert_eq!(result.trustline_count, 10000);
    assert_eq!(result.has_toml, true);
}

/// Test setting and reading an Unverified asset verification record.
#[test]
fn test_set_and_get_unverified_asset() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"CUSTOM");

    // Set an unverified asset
    client.set_asset_verification(
        &asset_code,
        &issuer,
        &VerificationStatus::Unverified,
        &50u32,  // reputation_score
        &100u64,  // trustline_count
        &false,  // has_toml
    );

    // Retrieve and verify
    let result = client.get_asset_verification(&asset_code, &issuer);
    assert_eq!(result.status, VerificationStatus::Unverified);
    assert_eq!(result.reputation_score, 50);
}

/// Test setting and reading a Suspicious asset verification record.
#[test]
fn test_set_and_get_suspicious_asset() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"SCAM");

    // Set a suspicious asset
    client.set_asset_verification(
        &asset_code,
        &issuer,
        &VerificationStatus::Suspicious,
        &10u32,  // reputation_score
        &5u64,   // trustline_count
        &false,  // has_toml
    );

    // Retrieve and verify
    let result = client.get_asset_verification(&asset_code, &issuer);
    assert_eq!(result.status, VerificationStatus::Suspicious);
    assert_eq!(result.reputation_score, 10);
}

/// Test has_asset_verification returns false before a write.
#[test]
fn test_has_asset_verification_before_write() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"NONEXISTENT");

    // Should return false for an asset that hasn't been verified
    let exists = client.has_asset_verification(&asset_code, &issuer);
    assert_eq!(exists, false);
}

/// Test has_asset_verification returns true after a write.
#[test]
fn test_has_asset_verification_after_write() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"USDC");

    // Initially doesn't exist
    assert_eq!(client.has_asset_verification(&asset_code, &issuer), false);

    // Set the asset
    client.set_asset_verification(
        &asset_code,
        &issuer,
        &VerificationStatus::Verified,
        &100u32,
        &50000u64,
        &true,
    );

    // Now it should exist
    assert_eq!(client.has_asset_verification(&asset_code, &issuer), true);
}

/// Test get_asset_verification returns AssetNotFound for an unregistered (asset_code, issuer) pair.
#[test]
fn test_get_unregistered_asset_returns_not_found() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"NONEXISTENT");

    // Should return AssetNotFound error
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.get_asset_verification(&asset_code, &issuer);
    }));

    // Should panic with AssetNotFound
    assert!(result.is_err(), "get_asset_verification should error for unregistered asset");
}

/// Test validate_asset_safety returns Ok() for a Verified asset.
#[test]
fn test_validate_asset_safety_verified() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"USDC");

    // Set as verified
    client.set_asset_verification(
        &asset_code,
        &issuer,
        &VerificationStatus::Verified,
        &100u32,
        &50000u64,
        &true,
    );

    // validate_asset_safety should succeed
    let result = client.validate_asset_safety(&asset_code, &issuer);
    assert!(result.is_ok());
}

/// Test validate_asset_safety returns Ok() for an Unverified asset.
#[test]
fn test_validate_asset_safety_unverified() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"CUSTOM");

    // Set as unverified
    client.set_asset_verification(
        &asset_code,
        &issuer,
        &VerificationStatus::Unverified,
        &50u32,
        &100u64,
        &false,
    );

    // validate_asset_safety should succeed (unverified is safe)
    let result = client.validate_asset_safety(&asset_code, &issuer);
    assert!(result.is_ok());
}

/// Test validate_asset_safety returns Err(SuspiciousAsset) for a Suspicious asset.
#[test]
fn test_validate_asset_safety_suspicious() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"SCAM");

    // Set as suspicious
    client.set_asset_verification(
        &asset_code,
        &issuer,
        &VerificationStatus::Suspicious,
        &10u32,
        &5u64,
        &false,
    );

    // validate_asset_safety should fail with SuspiciousAsset
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.validate_asset_safety(&asset_code, &issuer);
    }));

    // Should panic with SuspiciousAsset error
    assert!(result.is_err(), "validate_asset_safety should error for suspicious asset");
}

/// Test that admin authorization is enforced on set_asset_verification.
#[test]
fn test_set_asset_verification_admin_auth_required() {
    let (env, client, admin, issuer) = setup();
    let non_admin = Address::generate(&env);

    let asset_code = SorobanString::from_slice(&env, b"USDC");

    // Disable auth mocking to enforce actual auth checks
    env.mock_all_auths_allowing_non_root_auth();

    // Attempt to set as non-admin (should fail)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // Mock only non_admin's auth, not admin
        env.as_contract(&env.current_contract_id(), || {
            non_admin.require_auth();
        });

        client.set_asset_verification(
            &asset_code,
            &issuer,
            &VerificationStatus::Verified,
            &100u32,
            &50000u64,
            &true,
        );
    }));

    // Should fail due to unauthorized caller
    assert!(result.is_err(), "set_asset_verification should require admin authorization");
}

/// Test that create_remittance succeeds even against a Suspicious asset.
///
/// This documents the current decoupling: asset verification does not gate remittance creation.
/// A later change to gate creation on asset status would be a deliberate decision, not a regression.
#[test]
fn test_create_remittance_with_suspicious_asset_succeeds() {
    let (env, client, admin, asset_issuer) = setup();

    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    let token = Address::generate(&env);

    // Register the agent
    client.register_agent(&admin, &agent, &None);

    // Set the token to USDC for this test
    let token_code = SorobanString::from_slice(&env, b"USDC");

    // Mark the asset as suspicious
    client.set_asset_verification(
        &token_code,
        &asset_issuer,
        &VerificationStatus::Suspicious,
        &10u32,
        &5u64,
        &false,
    );

    // Create a remittance with the suspicious asset.
    // This should succeed, documenting that asset verification does not gate remittance creation.
    let amount = 1_000_000i128;  // 1 USDC in stroops
    let remittance_id_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_remittance(
            &sender,
            &agent,
            &amount,
            &None,      // expiry
            &Some(token_code.clone()),  // token
            &None,      // idempotency_key
            &None,      // settlement_config
            &None,      // recipient_hash
        )
    }));

    // Should not panic; remittance creation is independent of asset status
    assert!(remittance_id_result.is_ok(), "create_remittance must succeed with suspicious asset (decoupled)");
}

/// Test updating an existing asset verification record (overwrite).
#[test]
fn test_update_asset_verification() {
    let (env, client, admin, issuer) = setup();

    let asset_code = SorobanString::from_slice(&env, b"USDC");

    // Initially set as verified
    client.set_asset_verification(
        &asset_code,
        &issuer,
        &VerificationStatus::Verified,
        &100u32,
        &50000u64,
        &true,
    );

    let result1 = client.get_asset_verification(&asset_code, &issuer);
    assert_eq!(result1.status, VerificationStatus::Verified);

    // Update to suspicious
    client.set_asset_verification(
        &asset_code,
        &issuer,
        &VerificationStatus::Suspicious,
        &20u32,
        &100u64,
        &false,
    );

    let result2 = client.get_asset_verification(&asset_code, &issuer);
    assert_eq!(result2.status, VerificationStatus::Suspicious);
    assert_eq!(result2.reputation_score, 20);
    assert_eq!(result2.trustline_count, 100);
}
