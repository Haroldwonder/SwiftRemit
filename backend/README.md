# SwiftRemit Verification Service

Backend service for asset verification in the SwiftRemit remittance platform.

## Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start PostgreSQL
# Ensure PostgreSQL is running on localhost:5432

# Run development server
npm run dev

# Build for production
npm run build
npm start
```

## Webhooks

SwiftRemit provides a webhook system for real-time notifications about remittance status changes.

### Overview

The webhook system enables your application to receive HTTP POST requests whenever a remittance's status changes. This allows you to:

- Receive real-time updates without polling
- Build event-driven workflows
- Integrate with external systems
- Track remittance progress

### Supported Events

- `remittance.created` - Remittance created (status: pending)
- `remittance.updated` - Remittance status changed (status: processing)
- `remittance.completed` - Remittance completed successfully
- `remittance.failed` - Remittance failed
- `remittance.cancelled` - Remittance was cancelled

### Registering a Webhook

**Endpoint:** `POST /api/webhooks/register`

**Request:**
```json
{
  "url": "https://example.com/webhooks/remittance",
  "events": [
    "remittance.created",
    "remittance.updated",
    "remittance.completed",
    "remittance.failed"
  ],
  "secret": "your-secret-key"
}
```

**Response:**
```json
{
  "id": "webhook_1234567890",
  "url": "https://example.com/webhooks/remittance",
  "events": [
    "remittance.created",
    "remittance.updated",
    "remittance.completed",
    "remittance.failed"
  ],
  "active": true,
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Webhook Payload Format

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
    "metadata": {
      "reference": "INV-2024-001"
    },
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:35:00Z"
  }
}
```

### Webhook Security

All webhook requests include security headers for verification:

- `x-webhook-signature` - HMAC-SHA256 signature of the payload
- `x-webhook-timestamp` - Unix timestamp of the request
- `x-webhook-id` - Unique ID for this webhook delivery

**Verifying Signatures in Node.js:**

```javascript
import crypto from 'crypto';

function verifyWebhook(payload, signature, timestamp, secret) {
  // Check timestamp is within 5 minutes
  const now = Date.now();
  const ts = parseInt(timestamp);
  if (Math.abs(now - ts) > 5 * 60 * 1000) {
    return false;
  }

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  return expectedSignature === signature;
}
```

### Handling Webhooks

Your endpoint should:

1. Verify the signature using your secret key
2. Return HTTP 200-299 status code to acknowledge receipt
3. Be idempotent (use `x-webhook-id` for deduplication)
4. Process asynchronously (don't take long to respond)

**Example Express Handler:**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

app.post('/webhooks/remittance', (req, res) => {
  try {
    // Extract headers
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const webhookId = req.headers['x-webhook-id'];

    // Verify signature
    const payload = JSON.stringify(req.body);
    if (!verifyWebhook(payload, signature, timestamp, WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Use webhookId for deduplication
    console.log(`Processing webhook ${webhookId}`);
    
    const { event, data } = req.body;
    
    // Handle different events
    switch (event) {
      case 'remittance.completed':
        console.log(`Remittance ${data.id} completed!`);
        break;
      case 'remittance.failed':
        console.log(`Remittance ${data.id} failed: ${data.reason}`);
        break;
      // ... handle other events
    }

    // Acknowledge immediately
    res.json({ success: true });
    
    // Process asynchronously
    processWebhook(event, data).catch(err => 
      console.error('Webhook processing error:', err)
    );
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});
```

### Reliability & Retries

- Failed deliveries are retried up to 3 times
- Retry delays use exponential backoff (1s, 2s, 4s default)
- Webhooks with HTTP 200-299 responses are considered successful
- All delivery attempts are logged for debugging

### Manual Testing

Test webhooks locally using the provided test script:

```bash
# Terminal 1: Start SwiftRemit
npm run dev

# Terminal 2: Start webhook test server
npm run test:webhook:manual
```

This starts a local webhook receiver and automatically:
1. Registers a test webhook
2. Triggers sample remittance events
3. Displays received webhooks with signature verification

View the dashboard at: **http://localhost:3001/webhooks/dashboard**

### Integration in Your Application

```typescript
import { WebhookService, createWebhookStore } from './webhooks';
import { remittanceEventEmitter } from './remittance/events';

// Setup
const store = createWebhookStore(postgresPool);
const webhookService = new WebhookService(store);

// Register webhook in your API
app.post('/api/webhooks/register', async (req, res) => {
  try {
    const registration = await webhookService.registerWebhook(req.body);
    res.json(registration);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Trigger webhooks when remittance status changes
remittanceEventEmitter.setWebhookService(webhookService);

async function updateRemittanceStatus(id, status, data) {
  // Update database
  // ...
  
  // Trigger webhooks
  await remittanceEventEmitter.emitStatusChange({
    remittanceId: id,
    status,
    amount: data.amount,
    currency: data.currency,
    recipientId: data.recipientId,
    timestamp: new Date(),
  });
}

// Retry pending deliveries periodically
setInterval(() => {
  webhookService.retryPendingDeliveries().catch(console.error);
}, 60000); // Every minute
```

### Database Schema (PostgreSQL)

The webhook system uses two tables:

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

## API Documentation

See [ASSET_VERIFICATION.md](../ASSET_VERIFICATION.md) for complete API documentation.

## Testing

```bash
npm test
```

## Project Structure

```
backend/
├── src/
│   ├── api.ts          # Express API routes
│   ├── database.ts     # PostgreSQL operations
│   ├── index.ts        # Entry point
│   ├── scheduler.ts    # Background jobs
│   ├── stellar.ts      # Soroban contract integration
│   ├── types.ts        # TypeScript types
│   └── verifier.ts     # Asset verification logic
├── .env.example        # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## Environment Variables

See `.env.example` for all configuration options.

## License

MIT

## Distributed Tracing (OpenTelemetry)

The backend emits OTLP traces for all major operations: HTTP requests, database queries, FX rate fetches, and webhook deliveries. Trace context is propagated to outbound anchor API calls via W3C `traceparent` headers.

### Local Jaeger setup

Run a Jaeger all-in-one container that accepts OTLP over HTTP:

```bash
docker run -d --name jaeger \
  -p 4318:4318 \   # OTLP HTTP receiver
  -p 16686:16686 \ # Jaeger UI
  jaegertracing/all-in-one:latest
```

Then start the backend with tracing enabled (the default):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev
```

Open the Jaeger UI at **http://localhost:16686** and select the `swiftremit-backend` service.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OTEL_ENABLED` | `true` | Set to `false` to disable tracing (e.g. in CI) |
| `OTEL_SERVICE_NAME` | `swiftremit-backend` | Service name shown in traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP collector endpoint |

### Manual spans

Use the `withSpan` helper for custom instrumentation:

```typescript
import { withSpan } from './tracing';

const result = await withSpan('fx-rate.fetch', async (span) => {
  span.setAttribute('currency.pair', `${from}/${to}`);
  return fetchRate(from, to);
});
```
