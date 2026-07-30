# Load-test baselines — SR-105

This directory holds the committed thresholds that every k6 run is measured against,
a machine-readable config file consumed by CI, and a trend log that tracks results
across releases.

---

## Measurement environment

All baselines were captured in a **GitHub Actions `ubuntu-latest` runner against the
staging environment** with the following approximate spec:

| Dimension | Value |
|-----------|-------|
| Runner OS | Ubuntu 22.04 (GitHub-hosted) |
| Runner CPU | 2 vCPU (x86_64) |
| Runner RAM | 7 GB |
| Target: API service | 2 vCPU · 2 GB container (staging VM) |
| Target: Backend service | 2 vCPU · 2 GB container (staging VM) |
| Network | GitHub → staging public HTTPS |
| k6 version | ≥ 0.50.0 |
| Baseline captured | 2026-07 |

> **Re-capture procedure:** run the full suite against a freshly deployed staging build,
> note the p95/p99 values from `summary.txt`, then update `thresholds.json` accordingly.
> Commit the updated file on a dedicated PR so the change is reviewed.

---

## Thresholds rationale

| Scenario | p95 | Error rate | Notes |
|----------|-----|------------|-------|
| `remittance_create` | < 800 ms | < 1 % | POST writes to DB + optional on-chain check |
| `remittance_list` | < 400 ms | < 1 % | Indexed read with cursor pagination |
| `websocket` (connect) | < 200 ms | < 5 % | Socket.IO upgrade; 5 % allows ephemeral failures |
| `soak` | < 1 000 ms | < 2 % | 35 min sustained; slightly relaxed to absorb GC pauses |
| `spike` | < 2 000 ms | < 5 % | Burst to 10× baseline; 429s counted as OK |

The throughput gate (`http_reqs rate > 450`) in `main.js` verifies the system actually
reaches the 500 RPS target rather than silently shedding load.

---

## Re-capturing baselines

```bash
# 1. Deploy a clean staging build
# 2. Run the full suite
k6 run tests/load/main.js \
  -e API_URL=https://api.staging.swiftremit.io \
  -e BACKEND_URL=https://backend.staging.swiftremit.io \
  --out json=tests/load/results/metrics.json

# 3. Inspect p95 / p99 values in the printed summary
# 4. If stable across 3 consecutive runs, update thresholds.json
# 5. Commit: git add tests/load/baselines/ && git commit -m "chore: update load-test baselines"
```

---

## trend.csv

`trend.csv` is appended by CI after every main-branch load-test run.  It lets you spot
performance regressions across releases at a glance.

```
date,git_sha,scenario,p95_ms,p99_ms,rps,error_rate
```

Do **not** manually edit `trend.csv`; it is written by the workflow step
`Append trend data` in `.github/workflows/load-test.yml`.
