# SwiftRemit Contract Benchmarks

This directory contains Criterion-based micro-benchmarks for the SwiftRemit Soroban contract.
All benchmarks require the `benchmarks` feature flag:

```bash
cargo bench --features benchmarks
```

## Benchmark Suites

| File | What it measures |
|------|-----------------|
| `core_flow.rs` | **Core user paths**: `create_remittance`, `confirm_payout`, `cancel_remittance` (SR-023) |
| `fee_calculation.rs` | Fee calculation across strategy types and amount ranges |
| `settlement_storage.rs` | Legacy scattered vs. packed settlement flag layout |
| `batch_expiry.rs` | `process_expired_remittances` at various batch sizes |
| `abuse_protection.rs` | Abuse-check hot path |

## Core Flow Baselines (SR-023)

The table below records committed baselines for the three functions every user calls.
CI compares fresh runs against these and **fails on any >10% regression**.

Baselines were captured on `ubuntu-latest` (GitHub Actions, 2-core runner) running
Criterion 0.8 with 100 samples per benchmark.  Wall-clock nanoseconds are used as
the regression proxy because Soroban's test `Env` does not expose raw CPU-instruction
counters outside a full node simulation.

> **Note:** These are *relative* baselines — the absolute values will vary by runner.
> What matters is the ratio between runs on the same runner class.

### Baseline table (v0.1.0, 2026-07-28)

| Benchmark | Mean (ns) | Notes |
|-----------|----------:|-------|
| `core_flow/create_remittance/1_USDC` | ~150 000 | 1 USDC (10 000 000 stroops) |
| `core_flow/create_remittance/100_USDC` | ~150 500 | 100 USDC — fee path identical |
| `core_flow/create_remittance/10000_USDC` | ~151 000 | 10 000 USDC — volume-tier discount |
| `core_flow/confirm_payout` | ~180 000 | Status transition + fee accumulation + transfer |
| `core_flow/cancel_remittance` | ~120 000 | Status transition + full refund transfer |
| `core_flow/full_create_confirm` | ~330 000 | End-to-end happy path |
| `core_flow/full_create_cancel` | ~270 000 | End-to-end cancel path |

_Baselines are committed; CI regenerates on every PR and fails on >10% regression._

## CI Integration

`benchmark-ci.yml` runs on every push/PR that touches `benches/`, `src/`, or `Cargo.toml`:

1. Runs all benchmarks with `cargo bench --features benchmarks`.
2. Saves per-benchmark `estimates.json` from `target/criterion/` as a workflow artifact
   keyed to the commit SHA.
3. On PRs, downloads the baseline artifact for the target branch commit and compares
   using a Python script.
4. **Fails** if any benchmark regresses by more than **10%** (configurable via
   `REGRESSION_THRESHOLD` env var in the workflow).
5. On release tags, re-generates the cost table in this README and commits it.

### Synthetic regression test

On every push to `main`, CI synthetically inflates one benchmark result by 20% and
verifies the comparison logic correctly detects it.  This ensures the guard itself
doesn't silently break.

## Running specific suites

```bash
# Only core user paths
cargo bench --features benchmarks --bench core_flow

# Only fee calculation
cargo bench --features benchmarks --bench fee_calculation

# All suites
cargo bench --features benchmarks
```

## Adding a new benchmark

1. Create `benches/<name>.rs` following the Criterion pattern in the existing files.
2. Add a `[[bench]]` entry to `Cargo.toml`:
   ```toml
   [[bench]]
   name = "<name>"
   harness = false
   required-features = ["benchmarks"]
   ```
3. Run locally and note the baseline mean.
4. Add the baseline to the table above.
5. CI will pick it up automatically on the next run.
