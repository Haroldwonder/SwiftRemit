# Remittance Webhook Quick Reference

## Files Overview

| File | Purpose |
|------|---------|
| `src/webhooks/store.ts` | Webhook registration storage (in-memory or PostgreSQL) |
| `src/webhooks/types.ts` | TypeScript type definitions |
| `src/webhooks/dispatcher.ts` | Sends webhooks with retries & signatures |
| `src/webhooks/service.ts` | High-level webhook API |
| `src/webhooks/index.ts` | Main export point |
| `src/remittance/events.ts` | Remittance event emitter |
| `scripts/test-webhook.ts` | Manual testing with web dashboard |
| `examples/webhook-integration.ts` | Full integration example |
| `WEBHOOK_IMPLEMENTATION_GUIDE.md` | Detailed documentation |

## Quick Setup (5 minutes)

### 1. Initialize Webhook System

```typescript
import { WebhookService, createWebhookStore } from './src/webhooks';
import { remittanceEventEmitter } from './src/remittance/events';
import { Pool } from 'pg';

const pool = new Pool();
const store = createWebhookStore(pool); // Use PostgreSQL
const webhookService = new WebhookService(store);

// Connect events to webhooks
remittanceEventEmitter.setWebhookService(webhookService);
```

### 2. Add Registration Endpoint

```typescript
app.post('/api/webhooks/register', async (req, res) => {
  try {
    const webhook = await webhookService.registerWebhook({
      url: req.body.url,
      events: req.body.events,
      secret: req.body.secret,
    });
    res.status(201).json(webhook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```

### 3. Trigger Webhooks on Status Change

```typescript
// When remittance status changes
await remittanceEventEmitter.emitStatusChange({
  remittanceId: 'remit_123',
  status: 'completed',
  amount: 150.00,
  currency: 'USD',
  recipientId: 'recip_456',
  timestamp: new Date(),
});
```

### 4. Setup Retry Job

```typescript
setInterval(() => {
  webhookService.retryPendingDeliveries().catch(console.error);
}, 60000); // Every minute
```

## Common Tasks

### Register a Webhook

```bash
curl -X POST http://localhost:3000/api/webhooks/register \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/webhooks",
    "events": ["remittance.completed", "remittance.failed"],
    "secret": "your-secret"
  }'
```

**Response:**
```json
{
  "id": "webhook_1234567890",
  "url": "https://example.com/webhooks",
  "events": ["remittance.completed", "remittance.failed"],
  "active": true,
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### List All Webhooks

```typescript
const webhooks = await webhookService.listWebhooks();
console.log(webhooks);
```

### Unregister a Webhook

```typescript
const deleted = await webhookService.unregisterWebhook('webhook_id');
```

### Verify Webhook Signature (Receiver Side)

```typescript
import { WebhookDispatcher } from './src/webhooks';

const payload = JSON.stringify(req.body);
const isValid = WebhookDispatcher.verifySignature(
  payload,
  req.headers['x-webhook-signature'],
  req.headers['x-webhook-timestamp'],
  'your-secret'
);

if (!isValid) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

### Handle Webhook in Node.js

```typescript
app.post('/webhooks/remittance', (req, res) => {
  const { event, data } = req.body;

  // Process asynchronously
  handleWebhook(event, data).catch(console.error);

  // Return immediately
  res.json({ success: true });
});

async function handleWebhook(event, data) {
  switch (event) {
    case 'remittance.completed':
      console.log(`✅ Remittance ${data.id} completed`);
      // Update database, send email, etc.
      break;

    case 'remittance.failed':
      console.log(`❌ Remittance ${data.id} failed`);
      break;
  }
}
```

### Handle Webhook in Python

```python
import hmac
import hashlib
import json
from flask import Flask, request

app = Flask(__name__)
WEBHOOK_SECRET = 'your-secret'

@app.route('/webhooks/remittance', methods=['POST'])
def handle_webhook():
    # Verify signature
    payload = request.data
    signature = request.headers.get('x-webhook-signature')
    timestamp = request.headers.get('x-webhook-timestamp')

    expected_sig = hmac.new(
        WEBHOOK_SECRET.encode(),
        f"{timestamp}.{payload.decode()}".encode(),
        hashlib.sha256
    ).hexdigest()

    if expected_sig != signature:
        return {'error': 'Invalid signature'}, 401

    # Process webhook
    data = request.json
    print(f"Received {data['event']}: {data['data']}")

    return {'success': True}, 200
```

### Test Webhooks Locally

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run test:webhook:manual

# Terminal 3 (view dashboard)
open http://localhost:3001/webhooks/dashboard
```

## Event Types

| Event | Trigger | Status |
|-------|---------|--------|
| `remittance.created` | New remittance | pending |
| `remittance.updated` | Status change | processing |
| `remittance.completed` | Success | completed |
| `remittance.failed` | Error | failed |
| `remittance.cancelled` | User cancelled | cancelled |

## Webhook Payload Structure

```json
{
  "event": "remittance.completed",
  "timestamp": "2024-01-15T10:35:00Z",
  "id": "evt_550e8400-e29b-41d4-a716-446655440000",
  "data": {
    "id": "remit_123",
    "status": "completed",
    "amount": 150.00,
    "currency": "USD",
    "sourceCurrency": "GBP",
    "recipientId": "recip_456",
    "reason": "Monthly support",
    "metadata": { "reference": "INV-2024-001" },
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:35:00Z"
  }
}
```

## Retry Behavior

| Attempt | Delay | Cumulative Wait |
|---------|-------|-----------------|
| 1 | — | 0s |
| 2 | 1s | 1s |
| 3 | 2s | 3s |
| 4 | 4s | 7s (then max 60s) |

- Final attempt: **7 seconds** from initial request
- If still failing: marked as 'failed', kept for manual review

## Signature Verification

**Header Format:**
```
x-webhook-signature: <hmac_sha256_hex>
x-webhook-timestamp: <unix_milliseconds>
x-webhook-id: webhook_<timestamp>_<random>
```

**To Verify:**
```
signature = HMAC-SHA256(
  message: `${timestamp}.${payload}`,
  key: webhook_secret
)
```

## Database Queries

### Get delivery status

```sql
SELECT status, COUNT(*) as count 
FROM webhook_deliveries 
GROUP BY status;
```

### Failed deliveries

```sql
SELECT id, event_type, error 
FROM webhook_deliveries 
WHERE status = 'failed' 
ORDER BY created_at DESC;
```

### Subscriber statistics

```sql
SELECT w.url, COUNT(d.id) as deliveries, 
       SUM(CASE WHEN d.status = 'success' THEN 1 ELSE 0 END) as successful
FROM webhooks w
LEFT JOIN webhook_deliveries d ON w.id = d.webhook_id
GROUP BY w.id
ORDER BY deliveries DESC;
```

## Environment Variables

```env
DATABASE_URL=postgresql://user:pass@localhost/db
WEBHOOK_SECRET=your-secret-key
WEBHOOK_MAX_RETRIES=3
WEBHOOK_TIMEOUT_MS=30000
WEBHOOK_INITIAL_DELAY_MS=1000
NODE_ENV=production
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Webhooks not triggering | Check webhook is registered and active |
| Signature verification fails | Ensure secret matches, check timestamp window |
| Deliveries keep failing | Check endpoint URL is accessible, review error logs |
| High latency | Implement async processing, increase retry delays |
| Database growing | Archive old deliveries, increase cleanup frequency |

## Performance Tips

1. **Use async/await** for better concurrency
2. **Batch operations** when processing multiple webhooks
3. **Offload retries** to background job queue
4. **Monitor delivery times** - set timeout appropriately
5. **Implement circuit breaker** for consistently failing endpoints
6. **Archive old records** - keep database lean

## API Reference

### WebhookService

```typescript
// Register
registerWebhook(request: WebhookRegistrationRequest): Promise<WebhookRegistrationResponse>

// Unregister
unregisterWebhook(id: string): Promise<boolean>

// Query
getWebhook(id: string): Promise<WebhookRegistrationResponse | null>
listWebhooks(): Promise<WebhookRegistrationResponse[]>

// Trigger
onRemittanceStatusChange(id: string, status: string, data: any): Promise<{success, failed}>
triggerEvent(event: EventType, data: any): Promise<{success, failed}>

// Retry
retryPendingDeliveries(): Promise<void>
```

### WebhookDispatcher

```typescript
// Static verification method
static verifySignature(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string,
  windowMs?: number
): boolean
```

### RemittanceEventEmitter

```typescript
// Set webhook service
setWebhookService(webhookService: WebhookService): void

// Emit event
emitStatusChange(event: RemittanceStatusChangeEvent): Promise<void>

// Listeners
onRemittanceCreated(callback: Function): void
onRemittanceCompleted(callback: Function): void
onRemittanceFailed(callback: Function): void
// ... etc
```

## Real-world Examples

### Email Notification on Completion

```typescript
app.post('/webhooks/remittance', async (req, res) => {
  const { event, data } = req.body;

  if (event === 'remittance.completed') {
    await sendEmail({
      to: data.recipientEmail,
      subject: `Your remittance of ${data.amount} ${data.currency} is complete!`,
      body: `Check your bank account for the funds.`,
    });
  }

  res.json({ success: true });
});
```

### Slack Notification on Failure

```typescript
app.post('/webhooks/remittance', async (req, res) => {
  const { event, data } = req.body;

  if (event === 'remittance.failed') {
    await axios.post(SLACK_WEBHOOK_URL, {
      text: `❌ Remittance ${data.id} failed!\nReason: ${data.reason}`,
    });
  }

  res.json({ success: true });
});
```

### Update Dashboard in Real-time

```typescript
app.post('/webhooks/remittance', async (req, res) => {
  const { event, data } = req.body;

  // Broadcast to connected WebSocket clients
  io.emit('remittance-update', {
    remittanceId: data.id,
    status: data.status,
    timestamp: data.updatedAt,
  });

  res.json({ success: true });
});
```
