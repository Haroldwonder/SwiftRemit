# SwiftRemit Load Tests (k6)

Performance load tests targeting 500 RPS sustained for 5 minutes with p99 < 500 ms.

## Prerequisites

Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/):

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
  sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Running the tests

### Full suite (all scenarios in parallel)

```bash
k6 run tests/load/main.js \
  -e API_URL=https://api.staging.swiftremit.io \
  -e BACKEND_URL=https://backend.staging.swiftremit.io
```

### Individual scenarios

```bash
# Remittance creation only
k6 run tests/load/scenarios/remittance-create.js \
  -e BACKEND_URL=https://backend.staging.swiftremit.io \
  --vus 150 --duration 5m

# Remittance listing only
k6 run tests/load/scenarios/remittance-list.js \
  -e API_URL=https://api.staging.swiftremit.io \
  --vus 300 --duration 5m

# WebSocket connections only
k6 run tests/load/scenarios/websocket.js \
  -e API_URL=https://api.staging.swiftremit.io \
  --vus 50 --duration 5m
```

### Local quick smoke (lower load)

```bash
k6 run tests/load/main.js \
  -e API_URL=http://localhost:3000 \
  -e BACKEND_URL=http://localhost:3001 \
  -e CREATE_VUS=5 \
  -e LIST_VUS=10 \
  -e WS_VUS=2
```

## Scenarios

| Scenario | Endpoint | Default VUs | Threshold |
|----------|----------|-------------|-----------|
| `remittance_create` | `POST /api/remittance` (backend :3001) | 150 | p99 < 500 ms, errors < 1 % |
| `remittance_list` | `GET /api/remittances` (api :3000) | 300 | p99 < 500 ms, errors < 1 % |
| `websocket_connections` | Socket.IO ws (api :3000) | 50 | p95 connect < 200 ms, errors < 5 % |

## Load profile

Each scenario ramps up over **1 minute**, sustains for **5 minutes**, then ramps down over **1 minute**.

```
VUs
 ▲
 │         ┌────────────────────────┐
 │        /                          \
 │       /                            \
 └──────────────────────────────────────── time
     1min       5min sustained       1min
```

## Results

After each run, `tests/load/results/` contains:
- `report.html` — visual HTML report
- `summary.txt` — plain-text summary suitable for CI logs

## CI (optional manual trigger)

The workflow `.github/workflows/load-test.yml` can be triggered manually from
**Actions → Load Tests → Run workflow** with custom VU counts and a target URL.
It runs only against staging (never production) and requires the
`STAGING_API_URL` and `STAGING_BACKEND_URL` Actions variables.
