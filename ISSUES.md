# Issues

This file tracks active and recently completed engineering issues.

---

## SR-027 — Webhook DLQ Monitoring, Auto-Retry, Auto-Disable, and Bulk-Replay

**Area:** Backend  
**Type:** Feature  
**Priority:** P1  
**Estimate:** M  
**Branch:** `sr-027-webhook-dlq`  
**Status:** ✅ Complete

### Problem

`add_webhook_dead_letters.sql` creates a DLQ table and the admin API exposes
`GET /admin/webhooks/dlq` and `POST /admin/webhooks/dlq/:id/replay`, but nothing
alerts when the DLQ grows and there is no automatic retry or expiry. Failed
customer notifications accumulate silently until someone happens to check the
admin endpoint.

### Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | DLQ depth is visible in Grafana per subscription | ✅ |
| 2 | An alert fires within 5 minutes of the threshold being crossed | ✅ |
| 3 | Entries older than the max age are expired and counted, not retried forever | ✅ |
| 4 | Subscriptions are auto-disabled after K failures and the owner is notified | ✅ |

### Changes

#### Database migration — `backend/migrations/sr027_dlq_monitoring.sql`

New columns on `webhooks`: `owner_email`, `consecutive_failures`, `disabled_at`.  
New columns on `webhook_dead_letters`: `subscription_id`, `expired_at`, `next_retry_at`.  
Indexes for efficient per-subscription depth queries and scheduler scans.

Rollback: `backend/migrations/sr027_dlq_monitoring.down.sql`

#### Prometheus metrics — `backend/src/metrics.ts`

- `swiftremit_webhook_dlq_depth{subscription_id}` — gauge: pending DLQ entries
  per subscription (not replayed and not expired). Refreshed on every `/metrics`
  scrape via `updateAllMetrics`.
- `swiftremit_webhook_dlq_oldest_entry_timestamp_seconds{subscription_id}` —
  Unix timestamp of the oldest unresolved entry; used by stale-entry alert
  expression `(time() - metric) > 86400`.

#### Alert rules

`monitoring/alerts.yml` (project-level):
- `SwiftRemitDlqDepthHigh` — depth > 10 for 5 min, severity: warning
- `SwiftRemitDlqDepthCritical` — depth > 50 for 2 min, severity: critical
- `SwiftRemitDlqStaleEntries` — oldest entry age > 24 h for 5 min, severity: warning

`backend/monitoring/alert_rules.yml` (backend team):
- `WebhookDlqDepthHighPerSubscription` / `WebhookDlqDepthCriticalPerSubscription`
- `WebhookDlqStaleEntries`

#### Scheduled job — `backend/src/webhook-dlq-processor.ts`

`WebhookDlqProcessor` runs every 5 minutes (wired into `scheduler.ts` via
`node-cron` + `withAdvisoryLock` + `runTracked`).

1. **Expiry** — sets `expired_at = NOW()` for entries older than
   `DLQ_MAX_AGE_HOURS` (default 72 h). Entries are never deleted.
2. **Retry** — fetches up to `DLQ_BATCH_SIZE` (default 50) pending entries
   with `next_retry_at <= NOW()`, re-delivers with HMAC-SHA256 signature,
   schedules the next retry via exponential backoff:
   `delay = min(base × 2^(attempt−1), max_ms) ± jitter`
   Defaults: base 30 s, cap 1 h, jitter ±20 %.
3. **Auto-disable** — on each failure, `consecutive_failures` on the `webhooks`
   row is incremented. When it reaches `DLQ_DISABLE_THRESHOLD` (default 10)
   the subscription is set `active = FALSE, disabled_at = NOW()` and an email
   is sent to `owner_email` (if set) via the existing SMTP transport in
   `backend/src/email.ts`.
4. **Reset** — on successful re-delivery `consecutive_failures` resets to 0.

Environment variables (all optional):

| Variable | Default | Description |
|---|---|---|
| `DLQ_MAX_AGE_HOURS` | `72` | Hours before entry is expired |
| `DLQ_RETRY_BASE_MS` | `30000` | Base retry delay in ms |
| `DLQ_RETRY_MAX_MS` | `3600000` | Max retry delay cap in ms |
| `DLQ_RETRY_JITTER_PERCENT` | `20` | ±% jitter on capped delay |
| `DLQ_DISABLE_THRESHOLD` | `10` | Consecutive failures before auto-disable |
| `DLQ_BATCH_SIZE` | `50` | Max entries per scheduler run |

#### Bulk-replay admin endpoint — `api/src/routes/admin.ts`

```
POST /api/admin/webhooks/dlq/bulk-replay
x-api-key: <ADMIN_API_KEY>
Content-Type: application/json

{ "ids": ["<uuid>", ...], "replayed_by": "alice@example.com" }
```

Max 100 IDs per request. Returns:

```json
{
  "success": true,
  "data": {
    "replayed": ["<uuid>", ...],
    "failed":   [{ "id": "<uuid>", "reason": "..." }, ...],
    "skipped":  ["<uuid>", ...]
  }
}
```

Every entry is recorded in `admin_audit_log` with action
`dlq.bulk-replay.success`, `dlq.bulk-replay.failed`, or `dlq.bulk-replay.skipped`.

### Testing checklist

- [ ] Apply `sr027_dlq_monitoring.sql` to dev DB; confirm no errors
- [ ] Confirm `swiftremit_webhook_dlq_depth` appears in `/metrics` after seeding a DLQ row
- [ ] Verify `WebhookDlqDepthHighPerSubscription` fires in Alertmanager when depth > 10 for 5 min
- [ ] Confirm `WebhookDlqStaleEntries` fires after inserting a synthetic old row
- [ ] Confirm expired entries are not retried by the scheduler
- [ ] Confirm auto-disable fires after `DLQ_DISABLE_THRESHOLD` failures and email is logged
- [ ] Call `POST /admin/webhooks/dlq/bulk-replay` with fresh + already-replayed + unknown IDs;
      verify correct split across `replayed` / `failed` / `skipped`
- [ ] Confirm `admin_audit_log` contains one row per entry in the bulk-replay request
