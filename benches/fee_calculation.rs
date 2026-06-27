use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use soroban_sdk::{Env, Address, testutils::Address as _};
use swiftremit::{SwiftRemitContract, SwiftRemitContractClient};

fn setup_contract(env: &Env) -> (SwiftRemitContractClient, Address, Address) {
    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(env, &contract_id);
    
    let admin = Address::generate(env);
    let usdc_token = Address::generate(env);
    
    env.mock_all_auths();
    client.initialize(&admin, &usdc_token, &250); // 2.5% default fee
    
    (client, admin, usdc_token)
}

fn bench_fee_calculation_range(c: &mut Criterion) {
    let mut group = c.benchmark_group("fee_calculation_by_amount");
    
    // Test amounts from 1 stroop to 1B USDC (7 decimals)
    let amounts = vec![
        1i128,              // 1 stroop
        100i128,            // 100 stroops
        10_000i128,         // 0.001 USDC
        1_000_000i128,      // 0.1 USDC
        10_000_000i128,     // 1 USDC
        100_000_000i128,    // 10 USDC
        1_000_000_000i128,  // 100 USDC
        10_000_000_000i128, // 1,000 USDC
        1_000_000_000_000_000i128, // 1B USDC
    ];
    
    for amount in amounts {
        let env = Env::default();
        let (client, _, _) = setup_contract(&env);
        
        group.bench_with_input(
            BenchmarkId::from_parameter(amount),
            &amount,
            |b, &amt| {
                b.iter(|| black_box(client.calculate_fee_breakdown(&amt)))
            },
        );
    }
    
    group.finish();
}

fn bench_fee_calculation_by_bps(c: &mut Criterion) {
    let mut group = c.benchmark_group("fee_calculation_by_bps");
    
    let amount = 10_000_000_000i128; // 1,000 USDC
    let fee_bps_values = vec![0u32, 50, 100, 250, 500, 1000]; // 0% to 10%
    
    for fee_bps in fee_bps_values {
        let env = Env::default();
        let (client, admin, usdc_token) = setup_contract(&env);
        
        // Reinitialize with different fee_bps
        client.initialize(&admin, &usdc_token, &fee_bps);
        
        group.bench_with_input(
            BenchmarkId::from_parameter(fee_bps),
            &fee_bps,
            |b, _| {
                b.iter(|| black_box(client.calculate_fee_breakdown(&amount)))
            },
        );
    }
    
    group.finish();
}

fn bench_fee_calculation_worst_case(c: &mut Criterion) {
    let env = Env::default();
    let (client, _, _) = setup_contract(&env);
    
    // Worst case: maximum amount with maximum fee
    let max_amount = i128::MAX / 10000; // Avoid overflow in fee calculation
    
    c.bench_function("fee_calculation_worst_case", |b| {
        b.iter(|| black_box(client.calculate_fee_breakdown(&max_amount)))
    });
}

/// Benchmark O(1) corridor lookup via map key.
///
/// Verifies that looking up a fee corridor is constant-time regardless of how
/// many corridors are configured, because each corridor is stored under a
/// dedicated `DataKey::FeeCorridor(from, to)` key rather than iterated from a
/// list.
fn bench_corridor_lookup(c: &mut Criterion) {
    use soroban_sdk::String as SorobanString;
    use swiftremit::{FeeCorridor, FeeStrategy};

    let country_codes: &[&str] = &[
        "US", "MX", "GB", "NG", "IN", "KE", "PH", "BR", "DE", "FR",
        "JP", "AU", "CA", "ZA", "EG", "GH", "SN", "ET", "TZ", "UG",
        "RW", "CM", "CI", "SL", "GM", "LR", "TG", "BJ", "BF", "ML",
        "NE", "MR", "GN", "GW", "CV", "ST", "KM", "DJ", "SO", "ER",
        "SD", "SS", "CF", "TD", "CG", "CD", "GA", "GQ", "AO", "MZ",
        "ZM", "ZW", "BW", "NA", "LS", "SZ", "MW", "MG", "MU", "SC",
        "RE", "YT", "TN", "DZ", "LY", "MA", "EH", "GT", "BZ", "HN",
        "SV", "NI", "CR", "PA", "CU", "JM", "HT", "DO", "TT", "BB",
        "LC", "VC", "GD", "AG", "DM", "KN", "BS", "TC", "KY", "VG",
        "VI", "PR", "AR", "CL", "PE", "EC", "BO", "PY", "UY", "VE",
    ];

    let mut group = c.benchmark_group("corridor_lookup");

    // Vary the total number of configured corridors to show O(1) scaling.
    for &n_corridors in &[1usize, 10, 50, 100] {
        let env = Env::default();
        let (client, admin, _) = setup_contract(&env);

        env.mock_all_auths();
        for i in 0..n_corridors.min(country_codes.len()) {
            let corridor = FeeCorridor {
                from_country: SorobanString::from_str(&env, country_codes[i]),
                to_country: SorobanString::from_str(&env, country_codes[(i + 1) % country_codes.len()]),
                strategy: FeeStrategy::Percentage(250),
                protocol_fee_bps: None,
            };
            client.set_fee_corridor(&admin, &corridor);
        }

        // Always look up the last-inserted corridor.
        let idx = (n_corridors - 1).min(country_codes.len() - 1);
        let target_from = SorobanString::from_str(&env, country_codes[idx]);
        let target_to   = SorobanString::from_str(&env, country_codes[(idx + 1) % country_codes.len()]);

        group.bench_with_input(
            BenchmarkId::new("n_corridors", n_corridors),
            &n_corridors,
            |b, _| {
                b.iter(|| black_box(client.get_fee_corridor(&target_from, &target_to)))
            },
        );
    }

    group.finish();
}

criterion_group!(
    fee_calculation_benches,
    bench_fee_calculation_range,
    bench_fee_calculation_by_bps,
    bench_fee_calculation_worst_case,
    bench_corridor_lookup,
);
criterion_main!(fee_calculation_benches);
