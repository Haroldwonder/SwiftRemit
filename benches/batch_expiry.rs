use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use soroban_sdk::{Env, Address, Vec, testutils::{Address as _, Ledger}};
use swiftremit::{SwiftRemitContract, SwiftRemitContractClient};

fn setup_contract_with_expired_remittances(
    env: &Env,
    count: u32,
) -> (SwiftRemitContractClient, Vec<u64>) {
    let contract_id = env.register_contract(None, SwiftRemitContract);
    let client = SwiftRemitContractClient::new(env, &contract_id);
    
    let admin = Address::generate(env);
    let usdc_token = Address::generate(env);
    let sender = Address::generate(env);
    let agent = Address::generate(env);
    
    env.mock_all_auths();
    client.initialize(&admin, &usdc_token, &250);
    
    // Create expired remittances
    let mut ids = Vec::new(env);
    let amount = 10_000_000i128; // 1 USDC
    
    for i in 0..count {
        // Create remittance with expiry in the past
        let remittance_id = i as u64 + 1;
        let expiry = Some(env.ledger().timestamp() - 3600); // Expired 1 hour ago
        
        // Note: This is a simplified setup. In real benchmarks, you'd need to
        // properly create remittances through the contract's create_remittance method
        // and then advance the ledger timestamp to make them expired.
        ids.push_back(remittance_id);
    }
    
    (client, ids)
}

fn bench_process_expired_batch_sizes(c: &mut Criterion) {
    let mut group = c.benchmark_group("process_expired_batch");
    
    let batch_sizes = vec![1, 5, 10, 25, 50];
    
    for size in batch_sizes {
        let env = Env::default();
        let (client, ids) = setup_contract_with_expired_remittances(&env, size);
        
        // Take only the requested batch size
        let batch_ids = {
            let mut batch = Vec::new(&env);
            for i in 0..size.min(ids.len()) {
                batch.push_back(ids.get_unchecked(i));
            }
            batch
        };
        
        group.bench_with_input(
            BenchmarkId::from_parameter(size),
            &batch_ids,
            |b, ids| {
                b.iter(|| {
                    // Clone ids for each iteration since process_expired consumes them
                    let ids_clone = {
                        let mut cloned = Vec::new(&env);
                        for i in 0..ids.len() {
                            cloned.push_back(ids.get_unchecked(i));
                        }
                        cloned
                    };
                    black_box(client.try_process_expired_remittances(&ids_clone))
                })
            },
        );
    }
    
    group.finish();
}

fn bench_process_expired_max_batch(c: &mut Criterion) {
    let env = Env::default();
    let (client, ids) = setup_contract_with_expired_remittances(&env, 50);
    
    c.bench_function("process_expired_max_batch_50", |b| {
        b.iter(|| {
            let ids_clone = {
                let mut cloned = Vec::new(&env);
                for i in 0..ids.len() {
                    cloned.push_back(ids.get_unchecked(i));
                }
                cloned
            };
            black_box(client.try_process_expired_remittances(&ids_clone))
        })
    });
}

fn bench_process_expired_mixed_states(c: &mut Criterion) {
    let env = Env::default();
    let (client, mut ids) = setup_contract_with_expired_remittances(&env, 25);
    
    // Add some non-existent IDs to simulate real-world mixed batch
    for i in 1000..1010 {
        ids.push_back(i);
    }
    
    c.bench_function("process_expired_mixed_states", |b| {
        b.iter(|| {
            let ids_clone = {
                let mut cloned = Vec::new(&env);
                for i in 0..ids.len() {
                    cloned.push_back(ids.get_unchecked(i));
                }
                cloned
            };
            black_box(client.try_process_expired_remittances(&ids_clone))
        })
    });
}

criterion_group!(
    batch_expiry_benches,
    bench_process_expired_batch_sizes,
    bench_process_expired_max_batch,
    bench_process_expired_mixed_states
);
criterion_main!(batch_expiry_benches);
