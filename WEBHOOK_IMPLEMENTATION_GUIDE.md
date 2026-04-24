# Webhook System Implementation Summary

## Overview

A comprehensive webhook system has been implemented for the SwiftRemit backend service. This system enables real-time notifications to subscribers whenever remittance statuses change.

## Files Created

### Core Modules

1. **`src/webhooks/store.ts`**
   - Webhook storage abstraction layer
   - `IWebhookStore` interface for extensibility
   - `InMemoryWebhookStore` - for development/testing
   - `PostgresWebhookStore` - for production (persists to database)
   - Methods: register, unregister, getSubscribers, recordDelivery, getPendingDeliveries

2. **`src/webhooks/types.ts`**
   - TypeScript type definitions
   - `EventType` - supported webhook events
   - `WebhookSubscriber` - webhook registration data
   - `WebhookPayload` - webhook message structure
   - `RemittanceData` & `RemittanceEventPayload` - remittance-specific types
   - `WebhookDeliveryRecord` - delivery tracking

3. **`src/webhooks/dispatcher.ts`**
   - Core webhook delivery engine
   - Features:
     - HMAC-SHA256 signature generation
     - Exponential backoff retries (up to 3 attempts)
     - Timeout handling (30s default)
     - Comprehensive error logging
   - Methods: dispatch, attemptDelivery, retryPendingDeliveries, verifySignature

4. **`src/webhooks/service.ts`**
   - High-level webhook management API
   - Methods:
     - `registerWebhook()` - add new subscription
     - `unregisterWebhook()` - remove subscription
     - `getWebhook()` - get subscription details
     - `listWebhooks()` - list all subscriptions
     - `onRemittanceStatusChange()` - trigger webhook on status change
     - `triggerEvent()` - manually trigger webhook
     - `retryPendingDeliveries()` - retry failed deliveries

5. **`src/remittance/events.ts`**
   - Remittance event emitter using Node.js EventEmitter
   - `RemittanceEventEmitter` class
   - Integration point with webhook system
   - Helper function: `updateRemittanceStatus()`
   - Singleton instance: `remittanceEventEmitter`

### Supporting Files

6. **`src/webhooks/index.ts`**
   - Main export point for webhook module
   - Easy imports for all webhook functionality

7. **`scripts/test-webhook.ts`**
   - Manual testing script
   - Starts local webhook receiver server
   - Auto-registers test webhook
   - Triggers sample remittance events
   - Web dashboard for viewing received webhooks
   - Signature verification demo

8. **`examples/webhook-integration.ts`**
   - Complete integration example
   - Shows how to use all webhook APIs
   - Express.js route handlers
   - Background job setup
   - Error handling patterns

### Documentation

9. **`backend/README.md`**
   - Added comprehensive Webhooks section
   - API examples
   - Security/signature verification
   - Database schema
   - Integration patterns

10. **`backend/package.json`**
    - Added `test:webhook:manual` script

## Architecture

```
RemittanceStatusChange
    ↓
remittanceEventEmitter.emitStatusChange()
    ↓
WebhookService.onRemittanceStatusChange()
    ↓
WebhookDispatcher.dispatch()
    ↓
For each subscriber:
  ├─ Store delivery record
  ├─ Generate HMAC signature
  ├─ Send HTTP POST
  ├─ Handle response (success/retry)
  └─ Log delivery attempt
```

## Core Features

### 1. Webhook Registration

```typescript
const registration = await webhookService.registerWebhook({
  url: 'https://example.com/webhooks',
  events: ['remittance.completed', 'remittance.failed'],
  secret: 'your-secret-key'
});
```

### 2. Event Triggering

```typescript
await remittanceEventEmitter.emitStatusChange({
  remittanceId: 'remit_123',
  status: 'completed',
  amount: 150.00,
  currency: 'USD',
  recipientId: 'recip_456',
  timestamp: new Date(),
});
```

### 3. Webhook Payload

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
    "recipientId": "recip_456"
  }
}
```

### 4. Security

- HMAC-SHA256 signatures on all requests
- Timestamp validation (5-minute window default)
- Unique webhook ID for idempotency
- Signature header: `x-webhook-signature`

### 5. Reliability

- Automatic retries with exponential backoff
- Configurable max retries (default: 3)
- Delay multiplier: 2 (1s → 2s → 4s)
- Max delay cap: 60s
- Timeout: 30s per request

### 6. Monitoring

- All deliveries logged
- Success/failure tracking
- Error messages captured
- Response status codes recorded

## Supported Events

- `remittance.created` - New remittance (status: pending)
- `remittance.updated` - Status changed (status: processing)
- `remittance.completed` - Successfully completed
- `remittance.failed` - Failed to process
- `remittance.cancelled` - User cancelled

## Database Schema (PostgreSQL)

### Webhooks Table
```sql
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  events JSONB NOT NULL DEFAULT '[]',
  secret TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Webhook Deliveries Table
```sql
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, success, failed
  attempt INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_status 
  ON webhook_deliveries(status, created_at);
```

## Usage Examples

### Quick Start

```typescript
import {
  WebhookService,
  createWebhookStore,
  remittanceEventEmitter,
} from './src/webhooks';

// 1. Initialize
const store = createWebhookStore(postgresPool);
const webhookService = new WebhookService(store);
remittanceEventEmitter.setWebhookService(webhookService);

// 2. Register webhook (via API)
app.post('/api/webhooks/register', async (req, res) => {
  const webhook = await webhookService.registerWebhook(req.body);
  res.json(webhook);
});

// 3. Trigger on status change
app.post('/api/remittances/:id/status', async (req, res) => {
  await remittanceEventEmitter.emitStatusChange({
    remittanceId: req.params.id,
    status: req.body.status,
    amount: req.body.amount,
    currency: req.body.currency,
    recipientId: req.body.recipientId,
    timestamp: new Date(),
  });
  res.json({ success: true });
});

// 4. Background job for retries
setInterval(() => {
  webhookService.retryPendingDeliveries().catch(console.error);
}, 60000); // Every minute
```

### Webhook Receiver

```typescript
app.post('/webhooks/receive', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const payload = JSON.stringify(req.body);

  if (!WebhookDispatcher.verifySignature(
    payload,
    signature,
    timestamp,
    WEBHOOK_SECRET
  )) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { event, data } = req.body;
  console.log(`Received ${event}:`, data);

  res.json({ success: true });
});
```

### Local Testing

```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Run webhook tests
npm run test:webhook:manual

# Open browser to http://localhost:3001/webhooks/dashboard
```

## Configuration Options

### WebhookDeliveryOptions

```typescript
interface WebhookDeliveryOptions {
  maxRetries?: number;           // Default: 3
  initialDelayMs?: number;       // Default: 1000 (1s)
  backoffMultiplier?: number;    // Default: 2
  maxDelayMs?: number;           // Default: 60000 (60s)
  timeoutMs?: number;            // Default: 30000 (30s)
}
```

### Environment Variables

```env
# Webhook configuration
WEBHOOK_SECRET=your-secret-key
WEBHOOK_MAX_RETRIES=3
WEBHOOK_TIMEOUT_MS=30000

# Database (for persistent storage)
DATABASE_URL=postgresql://user:pass@localhost/db
```

## Error Handling

The system handles various failure scenarios:

1. **Network Errors** - Retried with backoff
2. **Timeouts** - Treated as failures, retried
3. **HTTP Errors** - All non-2xx codes trigger retry
4. **Invalid Signatures** - Rejected immediately
5. **Invalid URLs** - Rejected at registration

## Best Practices

1. **Always verify signatures** in your webhook receiver
2. **Use idempotency keys** (x-webhook-id) for deduplication
3. **Process webhooks asynchronously** - return 200 immediately
4. **Implement retry logic** on your end too
5. **Log all webhook events** for debugging
6. **Monitor webhook health** - track success/failure rates
7. **Use strong secrets** - at least 32 characters

## Performance Considerations

- **Database indexes** on delivery status and timestamp
- **Batch processing** of pending deliveries
- **Async retry job** runs every minute
- **Configurable limits** for pending delivery batch size
- **JSON storage** for flexible payload structure

## Future Enhancements

- [ ] Webhook signature rotation
- [ ] Delivery rate limiting per subscriber
- [ ] Dead-letter queue for permanently failed webhooks
- [ ] Webhook event filtering with JMESPath
- [ ] Batch delivery option
- [ ] Delivery status dashboard/API
- [ ] Webhook replay functionality
- [ ] Circuit breaker pattern for failing endpoints

## Testing

### Unit Tests

```bash
npm test
```

### Manual Integration Test

```bash
npm run test:webhook:manual
```

### CURL Examples

```bash
# Register webhook
curl -X POST http://localhost:3000/api/webhooks/register \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://webhook.site/unique-id",
    "events": ["remittance.completed"],
    "secret": "test-secret"
  }'

# Update remittance status
curl -X POST http://localhost:3000/api/remittances/remit_123/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "amount": 150,
    "currency": "USD",
    "recipientId": "recip_456"
  }'

# List webhooks
curl http://localhost:3000/api/webhooks
```

## Debugging

Enable debug logging:

```typescript
const webhookService = new WebhookService(
  store,
  {
    log: (msg) => console.log('[WEBHOOK]', msg),
    debug: (msg) => console.debug('[WEBHOOK:DEBUG]', msg),
    error: (msg) => console.error('[WEBHOOK:ERROR]', msg),
  }
);
```

## Support

- Check README.md → Webhooks section
- Review examples/webhook-integration.ts
- Run npm run test:webhook:manual
- Check delivery logs in webhook_deliveries table
