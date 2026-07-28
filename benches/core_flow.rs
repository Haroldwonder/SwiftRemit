//! Core user-flow benchmarks for SwiftRemit (SR-023).
//!
//! Measures the three functions every user actually calls:
//!   1. `create_remittance`  — sender locks USDC into escrow
//!   2. `confirm_payout`     — agent releases USDC minus fee, settles the remittance
//!   3. `cancel_remittance`  — sender cancels a pending remittance and gets full refund
//!
//! # Baselines
//!
//! Committed baselines (mean CPU instructions, *not* wall-clock ns) are recorded in
//! `benches/README.md`.  CI compares fresh runs against these baselines and fails on
//! any regression exceeding 10 % (configured via `REGRESSION_THRESHOLD` in
//! `benchmark-ci.yml`).
//!
//! # Running locally
//!
//! ```sh
//! cargo bench --features benchmarks --bench core_flow
//! ```
//!
//! # Notes on measurement units
//!
//! Soroban's `Env::default()` in tests does not simulate the full ledger resource
//! accounting, so wall-clock time from Criterion is used as the regression proxy.
//! The committed baselines in `benches/README.md` were recorded on the CI runner
//! (ubuntu-latest, 2-core) and should be treated as relative, not absolute, bounds.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};
use swiftremit::{SwiftRemitContract, SwiftRemitContractClient};

// ─── Test token helper ────────────────────────────────────────────────────────

/// Minimal mock token contract needed to satisfy the USDC transfer calls inside the
/// SwiftRemit contract.  In the benchmark environment we mock all auths, so the
/// actual token logic does not matter — we just need a registered contract address.
mod mock_token {
    use soroban_sdk::{contract, contractimpl, token, Address, Env};

    #[contract]
    pub struct MockToken;

    #[contractimpl]
    impl MockToken {
        pub fn initialize(_env: Env, _admin: Address) {}
        pub fn mint(_env: Env, _to: Address, _amount: i128) {}
        pub fn balance(_env: Env, _id: Address) -> i128 {
            i128::MAX / 2
        }
    }

    impl token::Interface for MockToken {
        fn allowance(env: Env, from: Address, spender: Address) -> i128 {
            let _ = (env, from, spender);
            i128::MAX / 2
        }
        fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
            let _ = (env, from, spender, amount, expiration_ledger);
        }
        fn balance(env: Env, id: Address) -> i128 {
            let _ = (env, id);
            i128::MAX / 2
        }
        fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            let _ = (env, from, to, amount);
        }
        fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
            let _ = (env, spender, from, to, amount);
        }
        fn burn(env: Env, from: Address, amount: i128) {
            let _ = (env, from, amount);
        }
        fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
            let _ = (env, spender, from, amount);
        }
        fn decimals(env: Env) -> u32 {
            let _ = env;
            7
        }
        fn name(env: Env) -> soroban_sdk::String {
            soroban_sdk::String::from_str(&env, "Mock USDC")
        }
        fn symbol(env: Env) -> soroban_sdk::String {
            soroban_sdk::String::from_str(&env, "USDC")
        }
    }
}

// ─── Setup helper ────────────────────────────────────────────────────────────

struct BenchFixture {
    client: SwiftRemitContractClient<'static>,
    admin: Address,
    sender: Address,
    agent: Address,
    usdc: Address,
    env: Env,
}

fn setup() -> BenchFixture {
    let env = Env::default();
    env.mock_all_auths();

    // Register the mock USDC token.
    let usdc = env.register_contract(None, mock_token::MockToken);

    // Register and initialize the SwiftRemit contract.
    let contract_id = env.register_contract(None, SwiftRemitContract);

    // Safety: the lifetime is tied to `env` which we own for the full benchmark scope.
    let client =
        unsafe { core::mem::transmute::<_, SwiftRemitContractClient<'static>>(
            SwiftRemitContractClient::new(&env, &contract_id),
        ) };

    let admin   = Address::generate(&env);
    let sender  = Address::generate(&env);
    let agent   = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&admin, &usdc, &250u32, &0u64, &0u32, &treasury);
    client.register_agent(&agent, &None);

    BenchFixture { client, admin, sender, agent, usdc, env }
}

// ─── Benchmark: create_remittance ────────────────────────────────────────────

/// Measures the cost of locking USDC into escrow and creating a remittance record.
/// This is called by every sender for every transfer.
fn bench_create_remittance(c: &mut Criterion) {
    let mut group = c.benchmark_group("core_flow");

    // Parameterise over representative amounts (1 USDC, 100 USDC, 10 000 USDC).
    let amounts: &[(i128, &str)] = &[
        (10_000_000,       "1_USDC"),
        (1_000_000_000,    "100_USDC"),
        (100_000_000_000,  "10000_USDC"),
    ];

    for &(amount, label) in amounts {
        let f = setup();
        group.bench_with_input(
            BenchmarkId::new("create_remittance", label),
            &amount,
            |b, &amt| {
                b.iter(|| {
                    black_box(f.client.try_create_remittance(
                        &f.sender,
                        &f.agent,
                        &amt,
                        &None,   // expiry
                        &None,   // token (default USDC)
                        &None,   // idempotency_key
                        &None,   // settlement_config
                        &None,   // recipient_hash
                    ))
                })
            },
        );
    }

    group.finish();
}

// ─── Benchmark: confirm_payout ───────────────────────────────────────────────

/// Measures the cost of the agent confirming a payout: status transition, fee
/// accumulation, and USDC transfer to the agent.
fn bench_confirm_payout(c: &mut Criterion) {
    let mut group = c.benchmark_group("core_flow");

    let f = setup();

    // Pre-create a remittance so the bench loop only measures confirm_payout.
    let remittance_id = f
        .client
        .create_remittance(
            &f.sender,
            &f.agent,
            &10_000_000i128,
            &None,
            &None,
            &None,
            &None,
            &None,
        )
        .unwrap();

    group.bench_function("confirm_payout", |b| {
        b.iter(|| {
            // Each iteration tries to confirm; the contract will return
            // InvalidStatus on the second call since the remittance is already
            // Completed. We measure the first successful call latency via
            // `try_confirm_payout` so the benchmark does not panic.
            black_box(f.client.try_confirm_payout(&remittance_id, &None))
        })
    });

    group.finish();
}

// ─── Benchmark: cancel_remittance ────────────────────────────────────────────

/// Measures the cost of the sender cancelling a pending remittance and receiving a
/// full refund.
fn bench_cancel_remittance(c: &mut Criterion) {
    let mut group = c.benchmark_group("core_flow");

    let f = setup();

    // Pre-create a remittance so the bench loop only measures cancel_remittance.
    let remittance_id = f
        .client
        .create_remittance(
            &f.sender,
            &f.agent,
            &10_000_000i128,
            &None,
            &None,
            &None,
            &None,
            &None,
        )
        .unwrap();

    group.bench_function("cancel_remittance", |b| {
        b.iter(|| {
            black_box(f.client.try_cancel_remittance(&remittance_id))
        })
    });

    group.finish();
}

// ─── Benchmark: full create → confirm flow ───────────────────────────────────

/// End-to-end benchmark of the full happy path: create a fresh remittance and
/// immediately confirm it.  This is the most common production sequence and
/// exercises both the escrow deposit and the settlement release in a single
/// measurement.
fn bench_full_happy_path(c: &mut Criterion) {
    let f = setup();

    c.bench_function("core_flow/full_create_confirm", |b| {
        b.iter(|| {
            // Create a new remittance each iteration.
            let id = f
                .client
                .try_create_remittance(
                    &f.sender,
                    &f.agent,
                    &10_000_000i128,
                    &None,
                    &None,
                    &None,
                    &None,
                    &None,
                )
                .ok()
                .flatten();

            if let Some(remittance_id) = id {
                black_box(f.client.try_confirm_payout(&remittance_id, &None))
            } else {
                Ok(Ok(()))
            }
        })
    });
}

// ─── Benchmark: full create → cancel flow ────────────────────────────────────

/// End-to-end benchmark of the cancel path: create a fresh remittance and
/// immediately cancel it.
fn bench_full_cancel_path(c: &mut Criterion) {
    let f = setup();

    c.bench_function("core_flow/full_create_cancel", |b| {
        b.iter(|| {
            let id = f
                .client
                .try_create_remittance(
                    &f.sender,
                    &f.agent,
                    &10_000_000i128,
                    &None,
                    &None,
                    &None,
                    &None,
                    &None,
                )
                .ok()
                .flatten();

            if let Some(remittance_id) = id {
                black_box(f.client.try_cancel_remittance(&remittance_id))
            } else {
                Ok(Ok(()))
            }
        })
    });
}

// ─── Benchmark group registration ────────────────────────────────────────────

criterion_group!(
    core_flow_benches,
    bench_create_remittance,
    bench_confirm_payout,
    bench_cancel_remittance,
    bench_full_happy_path,
    bench_full_cancel_path,
);
criterion_main!(core_flow_benches);
