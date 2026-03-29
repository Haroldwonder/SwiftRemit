# SwiftRemit Monitoring

This directory contains monitoring configurations and queries for the SwiftRemit backend service.

## Prometheus Metrics

The backend service exposes Prometheus-compatible metrics at the `/metrics` endpoint.

### Available Metrics

The following metrics are available:

#### Counters

- `swiftremit_settlements_total` - Total number of settlements by status
  - Labels: `status` (e.g., completed, error, refunded), `kind` (deposit, withdrawal)
- `swiftremit_webhook_deliveries_total` - Total number of webhook deliveries by result
  - Labels: `result` (success, failed), `event_type` (deposit_update, withdrawal_update, kyc_update), `anchor_id`

#### Gauges

- `swiftremit_active_remittances` - Number of active remittances (not completed, refunded, expired, or error)
- `swiftremit_accumulated_fees` - Total accumulated fees from all completed transactions

### Accessing Metrics

The metrics endpoint is available at:

```
GET http://your-backend-host:3000/metrics
```

The endpoint returns metrics in Prometheus text format (version 0.0.4).

**Note:** The `/metrics` endpoint is excluded from rate limiting to ensure Prometheus can scrape metrics without restrictions.

## Prometheus Configuration

A sample Prometheus configuration file is provided in [`prometheus.yml`](prometheus.yml).

### Quick Setup

1. Copy [`prometheus.yml`](prometheus.yml) to your Prometheus configuration directory
2. Adjust the `targets` in the `swiftremit-backend` job to match your backend service host and port
3. Restart Prometheus to load the new configuration

### Example Configuration

```yaml
scrape_configs:
  - job_name: "swiftremit-backend"
    static_configs:
      - targets: ["localhost:3000"]
        labels:
          service: "swiftremit-backend"
          environment: "production"
```

### Multi-Instance Setup

For multiple backend instances:

```yaml
scrape_configs:
  - job_name: "swiftremit-backend-instances"
    static_configs:
      - targets:
          - "backend-1:3000"
          - "backend-2:3000"
          - "backend-3:3000"
        labels:
          service: "swiftremit-backend"
```

## Alerting Examples

The [`prometheus.yml`](prometheus.yml) file includes example alerting rules. Uncomment and customize as needed:

- **HighWebhookFailureRate** - Alerts when webhook failure rate exceeds 10%
- **HighActiveRemittances** - Alerts when active remittances exceed 1000
- **LowSettlementRate** - Alerts when settlement completion rate is too low

## Database Monitoring Queries

See [`webhook_queries.sql`](webhook_queries.sql) for SQL queries to monitor webhook health and detect issues directly from the database.

## Grafana Dashboards

You can create Grafana dashboards using the exposed metrics. Example queries:

### Webhook Success Rate

```promql
rate(swiftremit_webhook_deliveries_total{result="success"}[5m])
/
rate(swiftremit_webhook_deliveries_total[5m])
```

### Settlement Rate by Status

```promql
rate(swiftremit_settlements_total{status="completed"}[1h])
```

### Active Remittances Over Time

```promql
swiftremit_active_remittances
```

### Accumulated Fees

```promql
swiftremit_accumulated_fees
```

## Troubleshooting

### Metrics Not Appearing

1. Verify the backend service is running and accessible
2. Check that the `/metrics` endpoint returns data: `curl http://localhost:3000/metrics`
3. Verify Prometheus can reach the backend service
4. Check Prometheus logs for scrape errors

### Missing Metrics

- Metrics are updated on relevant events (webhook deliveries, transaction state changes)
- `swiftremit_active_remittances` and `swiftremit_accumulated_fees` are updated periodically (every 60 seconds by default)
- If metrics are missing, check the backend service logs for errors

## Additional Resources

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [prom-client Library](https://github.com/siimon/prom-client)
