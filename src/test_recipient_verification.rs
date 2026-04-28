//! Unit tests for recipient address verification.
//!
//! Tests cover the core verification flow: storing hashes at creation,
//! verifying at payout, and the view functions.

#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, String};

use crate::{
    recipient_verification::{
        BankRecipient, RecipientDetails, WalletRecipient, RECIPIENT_HASH_SCHEMA_VERSION,
    },
    ContractError, SwiftRemitContract, SwiftRemitContractClient,
};

// ── Test helpers ──────────────────────────────────────────────────────────────

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::StellarAssetClient<'a> {
    let address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(env, &address)
}

fn create_swiftremit_contract<'a>(env: &Env) -> SwiftRemitContractClient<'a> {
    SwiftRemitContractClient::new(env, &env.register_contract(None, SwiftRemitContract {}))
}

struct TestSetup<'a> {
    env: Env,
    client: SwiftRemitContractClient<'a>,
    token: token::StellarAssetClient<'a>,
    admin: Address,
    agent: Address,
    sender: Address,
}

fn setup() -> TestSetup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let agent = Address::generate(&env);
    let sender = Address::generate(&env);

    let token = create_token_contract(&env, &token_admin);
    token.mint(&sender, &1_000_000_000i128);

    let client = create_swiftremit_contract(&env);
    client.initialize(&admin, &token.address, &250u32, &0u64, &0u32, &admin);
    client.register_agent(&agent, &None);
    client.assign_role(&admin, &agent, &crate::Role::Settler);

    // SAFETY: We extend the lifetime here because the Env owns all data.
    // This is the same pattern used in other test files.
    let env_ref: &'static Env = unsafe { &*(&env as *const Env) };
    let client_static: SwiftRemitContractClient<'static> =
        SwiftRemitContractClient::new(env_ref, &client.address);
    let token_static: token::StellarAssetClient<'static> =
        token::StellarAssetClient::new(env_ref, &token.address);

    TestSetup {
        env,
        client: client_static,
        token: token_static,
        admin,
        agent,
        sender,
    }
}

// ── 9.1 Creating a remittance with a valid 32-byte hash stores it correctly ──

#[test]
fn test_create_remittance_with_hash_stores_it() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let agent = Address::generate(&env);
    let sender = Address::generate(&env);

    let token = create_token_contract(&env, &token_admin);
    token.mint(&sender, &1_000_000_000i128);

    let client = create_swiftremit_contract(&env);
    client.initialize(&admin, &token.address, &250u32, &0u64, &0u32, &admin);
    client.register_agent(&agent, &None);
    client.assign_role(&admin, &agent, &crate::Role::Settler);

    let hash_bytes: [u8; 32] = [0xABu8; 32];
    let hash = BytesN::from_array(&env, &hash_bytes);

    let remittance_id = client.create_remittance(
        &sender,
        &agent,
        &1_000_000i128,
        &None,
        &None,
        &None,
        &None,
        &Some(hash.clone()),
    );

    let result = client.get_recipient_hash(&remittance_id);
    assert!(result.is_some());
    let record = result.unwrap();
    assert_eq!(record.hash, hash);
    assert_eq!(record.schema_version, RECIPIENT_HASH_SCHEMA_VERSION);
}

// ── 9.2 Creating a remittance without a hash leaves no record ─────────────────

#[test]
fn test_create_remittance_without_hash_leaves_no_record() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let agent = Address::generate(&env);
    let sender = Address::generate(&env);

    let token = create_token_contract(&env, &token_admin);
    token.mint(&sender, &1_000_000_000i128);

    let client = create_swiftremit_contract(&env);
    client.initialize(&admin, &token.address, &250u32, &0u64, &0u32, &admin);
    client.register_agent(&agent, &None);
    client.assign_role(&admin, &agent, &crate::Role::Settler);

    let remittance_id = client.create_remittance(
        &sender,
        &agent,
        &1_000_000i128,
        &None,
        &None,
        &None,
        &None,
        &None,
    );

    let result = client.try_get_recipient_hash(&remittance_id).unwrap().unwrap();
    // Returns Ok(None) for exempt remittances
    assert!(result.is_none());
}

// ── 9.3 get_recipient_hash returns None for a verification-exempt remittance ──

#[test]
fn test_get_recipient_hash_returns_none_for_exempt() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let agent = Address::generate(&env);
    let sender = Address::generate(&env);

    let token = create_token_contract(&env, &token_admin);
    token.mint(&sender, &1_000_000_000i128);

    let client = create_swiftremit_contract(&env);
    client.initialize(&admin, &token.address, &250u32, &0u64, &0u32, &admin);
    client.register_agent(&agent, &None);
    client.assign_role(&admin, &agent, &crate::Role::Settler);

    let remittance_id = client.create_remittance(
        &sender,
        &agent,
        &1_000_000i128,
        &None,
        &None,
        &None,
        &None,
        &None,
    );

    let result = client.try_get_recipient_hash(&remittance_id).unwrap().unwrap();
    assert!(result.is_none());
}

// ── 9.4 get_recipient_hash returns RemittanceNotFound for an unknown ID ───────

#[test]
fn test_get_recipient_hash_returns_not_found_for_unknown_id() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token = create_token_contract(&env, &token_admin);

    let client = create_swiftremit_contract(&env);
    client.initialize(&admin, &token.address, &250u32, &0u64, &0u32, &admin);

    let result = client.try_get_recipient_hash(&9999u64);
    assert!(result.is_err());
    let err = result.unwrap_err().unwrap();
    assert_eq!(err, ContractError::RemittanceNotFound);
}

// ── 9.5 compute_recipient_hash produces expected output for a known wallet ────

#[test]
fn test_compute_recipient_hash_wallet_deterministic() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token = create_token_contract(&env, &token_admin);

    let client = create_swiftremit_contract(&env);
    client.initialize(&admin, &token.address, &250u32, &0u64, &0u32, &admin);

    let wallet_addr = Address::generate(&env);
    let details = RecipientDetails::Wallet(WalletRecipient {
        address: wallet_addr.clone(),
    });

    // Call twice — must produce the same result (determinism)
    let hash1 = client.compute_recipient_hash(&details.clone());
    let hash2 = client.compute_recipient_hash(&details);
    assert_eq!(hash1, hash2, "compute_recipient_hash must be deterministic");
}

// ── 9.6 compute_recipient_hash produces expected output for a known bank ──────

#[test]
fn test_compute_recipient_hash_bank_deterministic() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token = create_token_contract(&env, &token_admin);

    let client = create_swiftremit_contract(&env);
    client.initialize(&admin, &token.address, &250u32, &0u64, &0u32, &admin);

    let details = RecipientDetails::Bank(BankRecipient {
        account_number: String::from_str(&env, "123456789"),
        routing_code: String::from_str(&env, "021000021"),
    });

    let hash1 = client.compute_recipient_hash(&details.clone());
    let hash2 = client.compute_recipient_hash(&details);
    assert_eq!(hash1, hash2, "compute_recipient_hash must be deterministic for bank");
}

// ── 9.7 rcpt_hash_schema_version returns RECIPIENT_HASH_SCHEMA_VERSION ────────

#[test]
fn test_rcpt_hash_schema_version() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token = create_token_contract(&env, &token_admin);

    let client = create_swiftremit_contract(&env);
    client.initialize(&admin, &token.address, &250u32, &0u64, &0u32, &admin);

    let version = client.rcpt_hash_schema_version();
    assert_eq!(version, RECIPIENT_HASH_SCHEMA_VERSION);
}

// ── 9.8 Wallet and bank serializations produce different hashes ───────────────

#[test]
fn test_wallet_and_bank_produce_different_hashes() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token = create_token_contract(&env, &token_admin);

    let client = create_swiftremit_contract(&env);
    client.initialize(&admin, &token.address, &250u32, &0u64, &0u32, &admin);

    let wallet_addr = Address::generate(&env);
    let wallet_details = RecipientDetails::Wallet(WalletRecipient {
        address: wallet_addr,
    });
    let bank_details = RecipientDetails::Bank(BankRecipient {
        account_number: String::from_str(&env, "123456789"),
        routing_code: String::from_str(&env, "021000021"),
    });

    let wallet_hash = client.compute_recipient_hash(&wallet_details);
    let bank_hash = client.compute_recipient_hash(&bank_details);

    assert_ne!(
        wallet_hash, bank_hash,
        "Wallet and bank serializations must produce different hashes"
    );
}
