# Load-test environment — SR-105

This document describes the environment on which load-test baselines were measured,
and how to run the suite locally or update the baselines.

---

## Reference environment

All committed threshold values in `tests/load/baselines/thresholds.json` were
captured under the following conditions:

| Dimension | Value |
|-----------|-------|
| Runner | GitHub Actions `ubuntu-latest` (x86_64) |
| Runner RAM | 7 GB |
| k6 version | ≥ 0.50.0 |
| Target service: API | 2 vCPU · 2 GB container (staging) |
| Target service: Backend | 2 vCPU · 2 GB container (staging) |
| Target service: DB | PostgreSQL 15, single node |
| Network | GitHub Actions runner → staging public HTTPS |
| Baseline captured | 2026-07 |
| Baseline git SHA | update after first reference run |

> **Important:** Thresholds measured on a faster environment (more CPU/RAM) must not
> be committed unless the staging environment is also upgraded. Otherwise CI will
> pass locally but fail in the reference environment.

---

## Running load tests locally

### Prerequisites

- k6 ≥ 0.50.0 — [install guide](https://k6.io/docs/get-started/installation/)
- Access to a running API and Backend service (staging or local docker-compose)

### Standard performance run

```bash
k6 run tests/load/main.js \
  -e API_URL=https://api.staging.swiftremit.io \
  -e BACKEND_URL=https://backend.staging.swiftremit.io
```

Results are written to `tests/load/results/`:
- `summary.txt` — human-readable summary
- `summary.json` — machine-readable metrics
- `report.html` — visual HTML report
- `standard-metrics.json` — raw k6 JSON stream

### Soak test (35-min, memory leak detection)

```bash
k6 run tests/load/main.js \
  -e API_URL=https://api.staging.swiftremit.io \
  -e BACKEND_URL=https://backend.staging.swiftremit.io \
  -e RUN_SOAK=true \
  --out json=tests/load/results/soak-metrics.json
```

Expect this to run for ~40 minutes. Watch memory metrics in your observability stack.

### Spike test (burst + graceful degradation)

```bash
k6 run tests/load/main.js \
  -e API_URL=https://api.staging.swiftremit.io \
  -e BACKEND_URL=https://backend.staging.swiftremit.io \
  -e RUN_SPIKE=true \
  --out json=tests/load/results/spike-metrics.json
```

The spike peaks at 500 VUs for 90 seconds. Verify:
1. Error rate stays < 5% (rate-limited 429s count as OK)
2. After the spike drops, p95 returns to baseline within 2 minutes.

### Override VU counts

```bash
k6 run tests/load/main.js \
  -e API_URL=http://localhost:3000 \
  -e BACKEND_URL=http://localhost:3001 \
  -e CREATE_VUS=10 \
  -e LIST_VUS=20 \
  -e WS_VUS=5
```

---

## Updating baselines after a deliberate performance change

1. Deploy the performance improvement to staging.
2. Run the full standard suite at least **three consecutive times** and confirm
   stable results across all runs.
3. Record the median p95/p99 values from `summary.txt`.
4. Update `tests/load/baselines/thresholds.json` with the new values.
5. Update the `_environment.captured` field with today's date.
6. Open a PR with the description explaining why the baseline changed.
   The PR review should confirm the change is intentional, not a regression.

### What counts as a regression

A regression is any run where:
- p95 latency increases by > 20% vs the committed baseline
- error rate exceeds the committed threshold
- throughput (RPS) drops below the minimum floor

CI will automatically fail on threshold breaches. Do not raise thresholds to make
CI green — investigate and fix the root cause first.

---

## Trend tracking

`tests/load/baselines/trend.csv` is appended automatically by CI on every main-branch
load-test run. Format:

```
date,git_sha,scenario,p95_ms,p99_ms,rps,error_rate
```

To visualise trends locally:
```bash
# Print the last 20 entries
tail -20 tests/load/baselines/trend.csv

# Plot with gnuplot (optional)
gnuplot -e "
  set datafile separator ',';
  set term png; set output '/tmp/trend.png';
  plot 'tests/load/baselines/trend.csv' using 0:4 with lines title 'p95 ms'
"
```
