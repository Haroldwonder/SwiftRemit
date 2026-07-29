# Webhooks Guide

SwiftRemit provides webhooks to notify your application of asynchronous events such as remittance status changes and disputes.

## Webhook Security

Every webhook request includes an `x-webhook-signature` header containing an HMAC-SHA256 signature of the payload, generated using your subscription's secret key.

To prevent replay attacks, the payload includes an `x-webhook-timestamp` header. The signature is calculated over the string `<timestamp>.<payload_body>`.

### Signature Verification Example (Node.js)

```javascript
const crypto = require('crypto');

function verifyWebhook(req, secret) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const body = JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

## Secret Rotation

To maintain security, you should periodically rotate your webhook secret. SwiftRemit supports a **zero-downtime secret rotation** with a **24-hour overlap window**.

When you trigger a secret rotation, SwiftRemit immediately generates a new secret. However, to ensure in-flight deliveries and your application's deployment process don't drop events, SwiftRemit will send **two** signatures in every webhook request for the next 24 hours:
- `x-webhook-signature`: Signed with the **new** secret.
- `x-webhook-signature-prev`: Signed with the **previous** secret.

After the 24-hour overlap window, the previous secret will be automatically retired, and the `x-webhook-signature-prev` header will no longer be sent.

### Handling Secret Rotation

Your webhook verification logic should check the new signature first, and if that fails, fall back to checking the previous signature.

#### Enhanced Verification Example

```javascript
const crypto = require('crypto');

function verifyWebhookWithRotation(req, currentSecret, previousSecret) {
  const timestamp = req.headers['x-webhook-timestamp'];
  const body = JSON.stringify(req.body);
  const msg = `${timestamp}.${body}`;

  // 1. Try verifying with the current secret
  const sig = req.headers['x-webhook-signature'];
  if (sig && isValidSignature(msg, sig, currentSecret)) {
    return true;
  }

  // 2. Fall back to the previous secret during rotation overlap
  const prevSig = req.headers['x-webhook-signature-prev'];
  if (prevSig && previousSecret && isValidSignature(msg, prevSig, previousSecret)) {
    return true;
  }

  return false;
}

function isValidSignature(msg, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

By maintaining both the old and new secrets in your configuration during the rotation event, you can safely deploy the new secret without missing any webhook deliveries.
# Webhook System

SwiftRemit exposes two complementary webhook surfaces:

1. **Outbound remittance webhooks** — the backend fans out `remittance.*` and `sep24.expired_refund` events to registered subscriber URLs whenever a remittance changes state.
2. **Inbound anchor webhooks** — anchors POST signed callbacks to `/webhooks/anchor`; the backend verifies, validates, and routes them.

Both surfaces share the same HMAC-SHA256 signature scheme and are served from the single `backend/src/webhooks/` module.

---

## Architecture

```
backend/src/
  webhooks/
    dispatcher.ts   ← single canonical dispatcher (axios, dead-letter, drain, ±jitter)
    service.ts      ← high-level API: register, trigger, list, retry
    store.ts        ← IWebhookStore + InMemoryWebhookStore + PostgresWebhookStore
    types.ts        ← shared TypeScript types
    index.ts        ← barrel export
  webhook-handler.ts   ← inbound anchor webhook handler (routes to dispatcher)
  webhook-verifier.ts  ← Stellar keypair / HMAC-SHA256 verification (inbound)
  webhook-middleware.ts← Express middleware for inbound HMAC verification
  webhook-logger.ts    ← structured logging + suspicious-activity detection
  webhook-health.ts    ← /webhooks/health endpoint
  remittance/
    events.ts       ← EventEmitter bridge → WebhookService
```

---

## Outbound Webhooks

### Dispatcher

`backend/src/webhooks/dispatcher.ts` delivers events with:

- **HMAC-SHA256 signatures** — every delivery includes `x-webhook-signature` (hex) and `x-webhook-timestamp` (ms epoch). The signed message is `${timestamp}.${serialisedBody}`.
- **Secret rotation grace period** — if a subscriber has `previous_secret` + `secret_rotated_at` within the last 24 hours, an additional `x-webhook-signature-prev` header is emitted so receivers can verify against either key without downtime.
- **Exponential backoff + jitter** — delay formula: `min(base × 2^(attempt-1), max) ± jitter%`. Fully configurable via environment variables.
- **Dead-letter queue** — permanently-failed deliveries are stored and can be replayed.
- **`drain()`** — waits for all in-flight dispatches to settle; called during graceful shutdown.
- **Content-Type support** — `application/json` (default) or `application/x-www-form-urlencoded`.

### Retry Configuration

| Env var | Default | Description |
|---|---|---|
| `WEBHOOK_MAX_RETRIES` | `5` | Max delivery attempts per event |
| `WEBHOOK_RETRY_BASE_MS` | `1000` | Base delay for backoff (ms) |
| `WEBHOOK_RETRY_MAX_MS` | `300000` | Maximum delay cap (5 min) |
| `WEBHOOK_RETRY_JITTER_PERCENT` | `20` | ±Jitter applied to each delay |
| `WEBHOOK_TIMEOUT_MS` | `30000` | Per-request timeout |

### Supported Event Types

| Event | Trigger |
|---|---|
| `remittance.created` | New remittance enters `Pending` state |
| `remittance.updated` | Remittance moves to `Processing` |
| `remittance.completed` | Remittance settled |
| `remittance.failed` | Agent calls `mark_failed` |
| `remittance.cancelled` | Sender cancels or expiry processed |
| `kyc.expiry_warning` | KYC nearing expiry |
| `sep24.expired_refund` | SEP-24 transaction expired and refunded |

### Payload Shape

```json
{
  "event": "remittance.created",
  "timestamp": "2026-07-29T07:00:00.000Z",
  "id": "uuid-v4",
  "correlation_id": "optional-trace-id",
  "data": { ... }
}
```

### Registering a Subscriber

```typescript
import { WebhookService, createWebhookStore } from './src/webhooks';
import { Pool } from 'pg';

const store = createWebhookStore(new Pool());
const service = new WebhookService(store);

const webhook = await service.registerWebhook({
  url: 'https://your-server.example.com/hooks',
  events: ['remittance.created', 'remittance.completed'],
  secret: 'your-hmac-secret',
});
```

### Verifying a Delivery (Receiver Side)

```typescript
import crypto from 'crypto';

function verify(rawBody: string, headers: Record<string, string>, secret: string): boolean {
  const sig = headers['x-webhook-signature'];
  const ts  = headers['x-webhook-timestamp'];
  if (!sig || !ts) return false;

  // Reject timestamps older than 5 minutes
  if (Math.abs(Date.now() - Number(ts)) > 300_000) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

During a key rotation, also try `x-webhook-signature-prev` with the old secret if verification with the current secret fails.

---

## Inbound Anchor Webhooks

### Endpoint

```
POST /webhooks/anchor
```

### Required Headers

| Header | Description |
|---|---|
| `x-signature` | Base64 Stellar signature **or** hex HMAC-SHA256 |
| `x-timestamp` | ISO-8601 timestamp (must be within 5-minute window) |
| `x-nonce` | Unique request ID — prevents replay |
| `x-anchor-id` | Registered anchor identifier |

### Supported Event Types (Inbound)

| `event_type` | Description |
|---|---|
| `deposit_update` | SEP-24 deposit progress |
| `withdrawal_update` | SEP-24 withdrawal progress |
| `kyc_update` | KYC status change from anchor |
| `contract_created` | Remittance created on-chain |
| `sep24_deposit_update` | SEP-24 deposit detail |
| `sep24_withdrawal_update` | SEP-24 withdrawal detail |
| `daily_limit_updated` | Admin changed a daily corridor limit |
| `dispute_raised` | Sender raised a dispute |
| `dispute_resolved` | Admin resolved a dispute |

### Signature Verification

The handler (`webhook-handler.ts`) tries HMAC verification first (using `webhook_secret` from the anchor record). If no HMAC secret is stored, it falls back to Stellar ed25519 verification using the anchor's `public_key`.

### Error Responses

| Code | Reason |
|---|---|
| `400` | Missing required headers or unknown `event_type` |
| `401` | Timestamp out of window, duplicate nonce, or invalid signature |
| `403` | `stellar.toml` SIGNING_KEY mismatch or unauthorised admin action |
| `404` | Unknown `anchor-id` |
| `500` | Internal error |

---

## Database Schema

Relevant tables (see `backend/migrations/`):

| Table | Purpose |
|---|---|
| `webhooks` | Registered outbound subscriber records |
| `webhook_deliveries` | Per-delivery status and attempt count |
| `webhook_dead_letters` | Permanently-failed deliveries for replay |
| `webhook_logs` | Inbound anchor webhook audit log |
| `suspicious_webhooks` | Flagged inbound requests |

---

## Monitoring

Key SQL queries live in `backend/monitoring/webhook_queries.sql`.

Prometheus metrics are exported via `/metrics` (see `backend/src/metrics.ts`).

---

## Setup & Testing

```bash
# Start backend
cd backend && npm run dev

# Manual send (development)
npx ts-node backend/scripts/test-webhook.ts

# Integration example
npx ts-node backend/examples/webhook-integration.ts
```

Health check:

```
GET /webhooks/health
```

---

## Security Checklist

- ✅ HMAC-SHA256 or Stellar ed25519 signature on every inbound request
- ✅ Timestamp window (5 minutes) enforced
- ✅ Single-use nonce tracked in database (`webhook_nonces`)
- ✅ HTTPS enforced on all outbound delivery URLs
- ✅ Secret rotation grace period (24 h dual-signing)
- ✅ Dead-letter queue — no silent drops
- ✅ Rate limiting on `/webhooks/*` (1000 req/min via express-rate-limit)
- ✅ Suspicious-activity pattern detection and audit logging
