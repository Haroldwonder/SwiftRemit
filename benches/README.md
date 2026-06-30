# Benchmarks

## Settlement storage

This benchmark compares legacy scattered settlement keys with the packed flag layout.

### Run

```bash
cargo bench --features benchmarks --bench settlement_storage
```

If builds fail due to existing test compilation errors, fix the test module first or temporarily disable `#[cfg(test)] mod test;` in `src/lib.rs` for local benchmarking.
