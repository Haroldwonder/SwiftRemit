use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use soroban_sdk::{Env, Address, testutils::Address as _};
use swiftremit::{check_rate_limit, record_action, ActionType};

fn bench_abuse_check_empty_storage(c: &mut Criterion) {
    let env = Env::default();
    let address = Address::generate(&env);
    
    c.bench_function("abuse_check_empty_storage", |b| {
        b.iter(|| {
            black_box(check_rate_limit(
                &env,
                &address,
                ActionType::CreateRemittance,
            ))
        })
    });
}

fn bench_abuse_check_with_history(c: &mut Criterion) {
    let mut group = c.benchmark_group("abuse_check_with_history");
    
    let history_sizes = vec![1, 5, 10, 20, 50];
    
    for size in history_sizes {
        let env = Env::default();
        let address = Address::generate(&env);
        
        // Pre-populate with history
        for _ in 0..size {
            record_action(&env, &address, ActionType::CreateRemittance);
        }
        
        group.bench_with_input(
            BenchmarkId::from_parameter(size),
            &size,
            |b, _| {
                b.iter(|| {
                    black_box(check_rate_limit(
                        &env,
                        &address,
                        ActionType::CreateRemittance,
                    ))
                })
            },
        );
    }
    
    group.finish();
}

fn bench_abuse_check_high_entry_storage(c: &mut Criterion) {
    let mut group = c.benchmark_group("abuse_check_high_entry_storage");
    
    let entry_counts = vec![10, 50, 100, 500];
    
    for count in entry_counts {
        let env = Env::default();
        
        // Create many different addresses with rate limit history
        for i in 0..count {
            let addr = Address::generate(&env);
            for _ in 0..5 {
                record_action(&env, &addr, ActionType::CreateRemittance);
            }
        }
        
        // Now benchmark checking a new address
        let test_address = Address::generate(&env);
        
        group.bench_with_input(
            BenchmarkId::from_parameter(count),
            &count,
            |b, _| {
                b.iter(|| {
                    black_box(check_rate_limit(
                        &env,
                        &test_address,
                        ActionType::CreateRemittance,
                    ))
                })
            },
        );
    }
    
    group.finish();
}

fn bench_abuse_record_action(c: &mut Criterion) {
    let env = Env::default();
    let address = Address::generate(&env);
    
    c.bench_function("abuse_record_action", |b| {
        b.iter(|| {
            black_box(record_action(
                &env,
                &address,
                ActionType::CreateRemittance,
            ))
        })
    });
}

fn bench_abuse_different_action_types(c: &mut Criterion) {
    let mut group = c.benchmark_group("abuse_check_by_action_type");
    
    let action_types = vec![
        ActionType::CreateRemittance,
        ActionType::CancelRemittance,
        ActionType::CompleteRemittance,
        ActionType::DisputeRemittance,
    ];
    
    for action_type in action_types {
        let env = Env::default();
        let address = Address::generate(&env);
        
        // Pre-populate with some history
        for _ in 0..10 {
            record_action(&env, &address, action_type.clone());
        }
        
        let action_name = format!("{:?}", action_type);
        
        group.bench_with_input(
            BenchmarkId::new("action", &action_name),
            &action_type,
            |b, at| {
                b.iter(|| {
                    black_box(check_rate_limit(&env, &address, at.clone()))
                })
            },
        );
    }
    
    group.finish();
}

criterion_group!(
    abuse_protection_benches,
    bench_abuse_check_empty_storage,
    bench_abuse_check_with_history,
    bench_abuse_check_high_entry_storage,
    bench_abuse_record_action,
    bench_abuse_different_action_types
);
criterion_main!(abuse_protection_benches);
