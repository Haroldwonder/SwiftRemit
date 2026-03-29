# Prometheus Metrics Implementation

## Overview

This document describes the implementation of Prometheus metrics endpoint for the SwiftRemit backend service, addressing issue #263.

## Changes Made

### 1. Installed Dependencies

Added `prom-client` library to [`backend/package.json`](package.json):

```json
"prom-client": "^15.1.0"
```

### 2. Created Metrics Service

Created [`backend/src/metrics.ts`](src/metrics.ts) with the following metrics:

#### Counters

- **`swiftremit_settlements_total`** - Total number of settlements by status
  - Labels: `status` (completed, error, refunded, etc.), `kind` (deposit, withdrawal)
  - Incremented when transaction state changes

- **`swiftremit_webhook_deliveries_total`** - Total number of webhook deliveries by result
  - Labels: `result` (success, failed), `event_type` (deposit_update, withdrawal_update, kyc_update), `anchor_id`
  - Incremented on each webhook delivery attempt

#### Gauges

- **`swiftremit_active_remittances`** - Number of active remittances
  - Counts transactions not in terminal states (completed, refunded, expired, error)
  - Updated periodically (every 60 seconds)

- **`swiftremit_accumulated_fees`** - Total accumulated fees from completed transactions
  - Sums `amount_fee` from all completed transactions
  - Updated periodically (every 60 seconds)

### 3. Added /metrics Endpoint

Added Prometheus-compatible metrics endpoint to [`backend/src/api.ts`](src/api.ts):

```typescript
app.get("/metrics", async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  console.log("Metrics endpoint requested", { correlationId });

  try {
    const metrics = await metricsService.getMetrics();
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(metrics);
  } catch (error) {
    console.error("Error generating metrics:", error, { correlationId });
    res.status(500).json({ error: "Failed to generate metrics" });
  }
});
```

### 4. Excluded Metrics from Rate Limiting

Updated rate limiting configuration in [`backend/src/api.ts`](src/api.ts) to exclude `/metrics` endpoint:

```typescript
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"),
  message: "Too many requests from this IP, please try again later.",
  skip: (req) => req.path === "/metrics", // Exclude metrics endpoint from rate limiting
});
```

### 5. Updated Webhook Handler

Modified [`backend/src/webhook-handler.ts`](src/webhook-handler.ts) to track webhook delivery metrics:

- Added `MetricsService` import and initialization
- Incremented `swiftremit_webhook_deliveries_total` counter on successful webhook processing
- Incremented `swiftremit_webhook_deliveries_total` counter on failed signature verification

### 6. Updated Transaction State Manager

Modified [`backend/src/transaction-state.ts`](src/transaction-state.ts) to track settlement metrics:

- Added `MetricsService` import and initialization
- Incremented `swiftremit_settlements_total` counter on each transaction state update

### 7. Created Prometheus Configuration

Created [`backend/monitoring/prometheus.yml`](monitoring/prometheus.yml) with:

- Sample Prometheus configuration for scraping SwiftRemit backend
- Example alerting rules for common scenarios
- Multi-instance setup examples
- TLS and authentication examples

### 8. Created Monitoring Documentation

Created [`backend/monitoring/README.md`](monitoring/README.md) with:

- Documentation of all available metrics
- Quick setup instructions
- Grafana dashboard query examples
- Troubleshooting guide

## Metrics Format

The `/metrics` endpoint returns metrics in Prometheus text format (version 0.0.4):

```
# HELP swiftremit_settlements_total Total number of settlements by status
# TYPE swiftremit_settlements_total counter
swiftremit_settlements_total{status="completed",kind="deposit"} 42
swiftremit_settlements_total{status="completed",kind="withdrawal"} 38

# HELP swiftremit_webhook_deliveries_total Total number of webhook deliveries by result
# TYPE swiftremit_webhook_deliveries_total counter
swiftremit_webhook_deliveries_total{result="success",event_type="deposit_update",anchor_id="anchor1"} 150
swiftremit_webhook_deliveries_total{result="failed",event_type="deposit_update",anchor_id="anchor1"} 2

# HELP swiftremit_active_remittances Number of active remittances (not completed, refunded, expired, or error)
# TYPE swiftremit_active_remittances gauge
swiftremit_active_remittances 15

# HELP swiftremit_accumulated_fees Total accumulated fees from all transactions
# TYPE swiftremit_accumulated_fees gauge
swiftremit_accumulated_fees 1234.56
```

## Usage

### Accessing Metrics

```bash
curl http://localhost:3000/metrics
```

### Prometheus Configuration

Copy [`backend/monitoring/prometheus.yml`](monitoring/prometheus.yml) to your Prometheus configuration directory and adjust targets:

```yaml
scrape_configs:
  - job_name: "swiftremit-backend"
    static_configs:
      - targets: ["localhost:3000"]
```

### Grafana Dashboards

Example PromQL queries for Grafana:

**Webhook Success Rate:**

```promql
rate(swiftremit_webhook_deliveries_total{result="success"}[5m])
/
rate(swiftremit_webhook_deliveries_total[5m])
```

**Settlement Rate by Status:**

```promql
rate(swiftremit_settlements_total{status="completed"}[1h])
```

**Active Remittances Over Time:**

```promql
swiftremit_active_remittances
```

## Acceptance Criteria Status

- [x] `/metrics` endpoint returns valid Prometheus text format
- [x] Metrics are updated on each relevant event
- [x] Endpoint is excluded from rate limiting
- [x] `backend/monitoring/` directory updated with Prometheus config example

## Testing

The implementation has been tested for:

1. Syntax correctness - All TypeScript files compile without errors
2. Metrics endpoint accessibility - `/metrics` endpoint is properly registered
3. Rate limiting exclusion - `/metrics` endpoint is excluded from rate limiting
4. Metric updates - Metrics are incremented on relevant events

## Future Enhancements

Potential improvements for future iterations:

1. Add more granular metrics (e.g., per-anchor settlement rates)
2. Add histogram metrics for processing times
3. Add custom labels for environment and service version
4. Implement metric aggregation for multi-instance deployments
5. Add alerting rules for critical thresholds

## References

- [Prometheus Documentation](https://prometheus.io/docs/)
- [prom-client Library](https://github.com/siimon/prom-client)
- [Issue #263](https://github.com/Haroldwonder/SwiftRemit/issues/263)
