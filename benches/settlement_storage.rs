use criterion::{black_box, criterion_group, criterion_main, Criterion};
use soroban_sdk::Env;
use swiftremit::{
    bench_settlement_packed_read,
    bench_settlement_packed_write,
    bench_settlement_scattered_read,
    bench_settlement_scattered_write,
};

fn bench_settlement_scattered(c: &mut Criterion) {
    let env = Env::default();
    let remittance_id = 42;

    bench_settlement_scattered_write(&env, remittance_id, true, true);

    c.bench_function("settlement_scattered_read", |b| {
        b.iter(|| black_box(bench_settlement_scattered_read(&env, remittance_id)))
    });

    c.bench_function("settlement_scattered_write", |b| {
        b.iter(|| bench_settlement_scattered_write(&env, remittance_id, true, true))
    });
}

fn bench_settlement_packed(c: &mut Criterion) {
    let env = Env::default();
    let remittance_id = 42;

    bench_settlement_packed_write(&env, remittance_id, true, true);

    c.bench_function("settlement_packed_read", |b| {
        b.iter(|| black_box(bench_settlement_packed_read(&env, remittance_id)))
    });

    c.bench_function("settlement_packed_write", |b| {
        b.iter(|| bench_settlement_packed_write(&env, remittance_id, true, true))
    });
}

criterion_group!(settlement_storage_benches, bench_settlement_scattered, bench_settlement_packed);
criterion_main!(settlement_storage_benches);
