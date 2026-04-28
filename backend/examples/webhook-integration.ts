/**
 * Example: Webhook Integration
 * 
 * This example shows how to integrate the webhook system into your application
 */

import express from 'express';
import { Pool } from 'pg';
import {
  WebhookService,
  createWebhookStore,
  remittanceEventEmitter,
  WebhookDispatcher,
} from '../src/webhooks';

const app = express();
const pool = new Pool();

app.use(express.json());

// Initialize webhook system
const webhookStore = createWebhookStore(pool);
const webhookService = new WebhookService(webhookStore);

// Connect webhook service to remittance events
remittanceEventEmitter.setWebhookService(webhookService);

// ============================================================================
// 1. WEBHOOK REGISTRATION ENDPOINTS
// ============================================================================

/**
 * Register a new webhook
 * POST /api/webhooks/register
 */
app.post('/api/webhooks/register', async (req, res) => {
  try {
    const registration = await webhookService.registerWebhook({
      url: req.body.url,
      events: req.body.events,
      secret: req.body.secret,
    });

    res.status(201).json(registration);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Registration failed',
    });
  }
});

/**
 * Unregister a webhook
 * DELETE /api/webhooks/:id
 */
app.delete('/api/webhooks/:id', async (req, res) => {
  try {
    const success = await webhookService.unregisterWebhook(req.params.id);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Webhook not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to unregister' });
  }
});

/**
 * Get webhook details
 * GET /api/webhooks/:id
 */
app.get('/api/webhooks/:id', async (req, res) => {
  try {
    const webhook = await webhookService.getWebhook(req.params.id);
    if (webhook) {
      res.json(webhook);
    } else {
      res.status(404).json({ error: 'Webhook not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch webhook' });
  }
});

/**
 * List all webhooks
 * GET /api/webhooks
 */
app.get('/api/webhooks', async (req, res) => {
  try {
    const webhooks = await webhookService.listWebhooks();
    res.json(webhooks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// ============================================================================
// 2. REMITTANCE STATUS UPDATE
// ============================================================================

/**
 * Update remittance status and trigger webhooks
 * POST /api/remittances/:id/status
 */
app.post('/api/remittances/:id/status', async (req, res) => {
  const remittanceId = req.params.id;
  const { status, amount, currency, sourceCurrency, recipientId, reason, metadata } = req.body;

  try {
    // 1. Update database (implement based on your schema)
    // const result = await updateRemittanceInDatabase(remittanceId, status);

    // 2. Trigger webhooks
    await remittanceEventEmitter.emitStatusChange({
      remittanceId,
      status,
      amount,
      currency,
      sourceCurrency,
      recipientId,
      reason,
      metadata,
      timestamp: new Date(),
    });

    res.json({ 
      success: true,
      message: `Remittance ${remittanceId} status updated to ${status}` 
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Status update failed',
    });
  }
});

// ============================================================================
// 3. WEBHOOK RECEIVER (for inbound webhooks from other services)
// ============================================================================

/**
 * Receive and verify webhooks
 * POST /api/webhooks/receive
 */
app.post('/api/webhooks/receive', (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'] as string;
    const timestamp = req.headers['x-webhook-timestamp'] as string;
    const webhookId = req.headers['x-webhook-id'] as string;

    if (!signature || !timestamp || !webhookId) {
      return res.status(400).json({ error: 'Missing webhook headers' });
    }

    // Verify signature
    const payload = JSON.stringify(req.body);
    const secret = process.env.WEBHOOK_SECRET || 'your-secret';

    if (!WebhookDispatcher.verifySignature(payload, signature, timestamp, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    console.log(`✅ Received verified webhook: ${req.body.event}`);
    console.log('Data:', req.body.data);

    // Process webhook asynchronously
    processWebhookAsync(req.body).catch(err => console.error('Webhook processing error:', err));

    // Return immediately to acknowledge
    res.json({ success: true, id: webhookId });
  } catch (error) {
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function processWebhookAsync(webhook: any) {
  const { event, data } = webhook;

  switch (event) {
    case 'remittance.completed':
      console.log(`🎉 Remittance ${data.id} completed!`);
      // Send confirmation email, update UI, etc.
      break;

    case 'remittance.failed':
      console.log(`❌ Remittance ${data.id} failed: ${data.reason}`);
      // Handle failure, notify user, etc.
      break;

    case 'remittance.updated':
      console.log(`📝 Remittance ${data.id} updated to ${data.status}`);
      // Update tracking, notify subscribers, etc.
      break;
  }
}

// ============================================================================
// 4. BACKGROUND JOBS
// ============================================================================

/**
 * Retry pending webhook deliveries
 * Recommended: Run every 1-5 minutes
 */
async function retryFailedWebhooks() {
  try {
    await webhookService.retryPendingDeliveries();
  } catch (error) {
    console.error('Failed to retry webhooks:', error);
  }
}

// Setup interval for retrying failed webhooks
setInterval(retryFailedWebhooks, 60000); // Every 1 minute

// ============================================================================
// 5. HEALTH CHECK
// ============================================================================

app.get('/health/webhooks', async (req, res) => {
  try {
    const webhooks = await webhookService.listWebhooks();
    res.json({
      status: 'healthy',
      webhooksRegistered: webhooks.length,
      activeWebhooks: webhooks.filter(w => w.active).length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: 'Failed to check webhook status',
    });
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('📋 Webhook endpoints:');
  console.log('   POST   /api/webhooks/register      - Register a webhook');
  console.log('   GET    /api/webhooks               - List all webhooks');
  console.log('   GET    /api/webhooks/:id           - Get webhook details');
  console.log('   DELETE /api/webhooks/:id           - Unregister a webhook');
  console.log('   POST   /api/remittances/:id/status - Update remittance status');
  console.log('   POST   /api/webhooks/receive       - Receive inbound webhooks');
  console.log('   GET    /health/webhooks            - Webhook health check');
});

export default app;
