#![no_main]

//! Fuzz target for `netting::compute_net_settlements` (Issue #1861).
//!
//! Builds random remittance sets from the fuzzer input and checks that:
//! 1. The function never panics (it may only return `Ok` or `ContractError`).
//! 2. Net transfer sums equal the gross flow per agent pair.
//! 3. Results are order-independent (shuffling the input yields the same set).

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{Address, Env, Vec};
use swiftremit::{
    compute_net_settlements, MaybeBytes32, MaybeSettlementConfig, NetTransfer, Remittance,
    RemittanceStatus,
};

/// Maximum number of remittances generated per fuzz iteration.
const MAX_REMITTANCES: usize = 12;
/// Number of distinct parties remittances are drawn from.
const PARTY_COUNT: usize = 4;
/// Bytes consumed per generated remittance.
const RECORD_LEN: usize = 24;

/// Reads a little-endian i128 from `bytes`, reduced to a bounded magnitude so
/// that arithmetic overflow is exercised only occasionally.
fn read_amount(bytes: &[u8]) -> i128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&bytes[..16]);
    let raw = i128::from_le_bytes(buf);
    // Keep magnitudes small enough that sums rarely overflow, but still allow
    // large values to reach the checked arithmetic paths.
    raw % 1_000_000_000_000_000_000
}

fn status_from(byte: u8) -> RemittanceStatus {
    match byte % 6 {
        0 => RemittanceStatus::Pending,
        1 => RemittanceStatus::Processing,
        2 => RemittanceStatus::Completed,
        3 => RemittanceStatus::Cancelled,
        4 => RemittanceStatus::Failed,
        _ => RemittanceStatus::Disputed,
    }
}

fn build_remittances(env: &Env, data: &[u8]) -> Vec<Remittance> {
    let parties: [Address; PARTY_COUNT] = [
        Address::generate(env),
        Address::generate(env),
        Address::generate(env),
        Address::generate(env),
    ];

    let mut remittances = Vec::new(env);
    let count = (data.len() / RECORD_LEN).min(MAX_REMITTANCES);

    for i in 0..count {
        let record = &data[i * RECORD_LEN..(i + 1) * RECORD_LEN];
        let sender = parties[(record[16] as usize) % PARTY_COUNT].clone();
        let agent = parties[(record[17] as usize) % PARTY_COUNT].clone();
        let amount = read_amount(&record[..16]);
        let fee = (record[18] as i128) * 1_000;
        let status = status_from(record[19]);

        remittances.push_back(Remittance {
            id: i as u64,
            sender,
            agent,
            amount,
            fee,
            protocol_fee: 0,
            status,
            expiry: None,
            settlement_config: MaybeSettlementConfig::None,
            token: parties[0].clone(),
            created_at: 0,
            failed_at: None,
            dispute_evidence: MaybeBytes32::None,
            expires_at: None,
        });
    }

    remittances
}

/// Deterministic Fisher-Yates shuffle driven by the fuzzer bytes.
fn shuffled(env: &Env, remittances: &Vec<Remittance>, seed: &[u8]) -> Vec<Remittance> {
    let mut items: std::vec::Vec<Remittance> = std::vec::Vec::new();
    for i in 0..remittances.len() {
        items.push(remittances.get_unchecked(i));
    }

    let mut state = 0x9E37_79B9_7F4A_7C15u64;
    for byte in seed {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(*byte as u64);
    }

    for i in (1..items.len()).rev() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let j = (state % (i as u64 + 1)) as usize;
        items.swap(i, j);
    }

    let mut out = Vec::new(env);
    for item in items {
        out.push_back(item);
    }
    out
}

/// Gross flow per normalized pair: (party_a, party_b) -> (net amount, total fees).
fn gross_flows(remittances: &Vec<Remittance>) -> std::vec::Vec<(Address, Address, i128, i128)> {
    let mut pairs: std::vec::Vec<(Address, Address, i128, i128)> = std::vec::Vec::new();

    for i in 0..remittances.len() {
        let r = remittances.get_unchecked(i);
        if r.status != RemittanceStatus::Pending {
            continue;
        }

        let (a, b, direction) = if r.sender.to_string() < r.agent.to_string() {
            (r.sender.clone(), r.agent.clone(), 1i128)
        } else {
            (r.agent.clone(), r.sender.clone(), -1i128)
        };

        let contribution = r.amount.saturating_mul(direction);
        match pairs
            .iter_mut()
            .find(|(pa, pb, _, _)| *pa == a && *pb == b)
        {
            Some(entry) => {
                entry.2 = entry.2.saturating_add(contribution);
                entry.3 = entry.3.saturating_add(r.fee);
            }
            None => pairs.push((a, b, contribution, r.fee)),
        }
    }

    pairs
}

fn find_transfer<'a>(
    transfers: &'a [NetTransfer],
    a: &Address,
    b: &Address,
) -> Option<&'a NetTransfer> {
    transfers.iter().find(|t| t.party_a == *a && t.party_b == *b)
}

fuzz_target!(|data: &[u8]| {
    let env = Env::default();
    let remittances = build_remittances(&env, data);

    // 1. Must never panic.
    let result = match compute_net_settlements(&env, &remittances) {
        Ok(result) => result,
        // Overflow is a documented, non-panicking outcome; nothing to verify.
        Err(_) => return,
    };

    // 2. Net transfer sums must equal the gross flow per agent pair.
    let expected = gross_flows(&remittances);
    let mut transfers: std::vec::Vec<NetTransfer> = std::vec::Vec::new();
    for i in 0..result.net_transfers.len() {
        let t = result.net_transfers.get_unchecked(i);
        assert_ne!(t.net_amount, 0, "zero-value net transfer emitted");
        assert!(
            expected
                .iter()
                .any(|(a, b, _, _)| *a == t.party_a && *b == t.party_b),
            "net transfer for unknown pair"
        );
        transfers.push(t);
    }

    for (a, b, net_amount, total_fees) in expected.iter() {
        match find_transfer(&transfers, a, b) {
            Some(t) => {
                assert_eq!(t.net_amount, *net_amount, "net amount mismatch for pair");
                assert_eq!(t.total_fees, *total_fees, "fee sum mismatch for pair");
            }
            None => assert_eq!(*net_amount, 0, "missing net transfer for non-zero flow"),
        }
    }

    // 3. Results must be order-independent.
    let reordered = shuffled(&env, &remittances, data);
    if let Ok(other) = compute_net_settlements(&env, &reordered) {
        assert_eq!(
            other.net_transfers.len(),
            result.net_transfers.len(),
            "order-dependent transfer count"
        );
        for i in 0..other.net_transfers.len() {
            let t = other.net_transfers.get_unchecked(i);
            let original = find_transfer(&transfers, &t.party_a, &t.party_b)
                .expect("order-dependent pair set");
            assert_eq!(original.net_amount, t.net_amount, "order-dependent net amount");
            assert_eq!(original.total_fees, t.total_fees, "order-dependent fees");
        }
    }
});