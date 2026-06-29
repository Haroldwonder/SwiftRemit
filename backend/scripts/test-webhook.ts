/**
 * Test Webhook Script
 * 
 * Manual testing script for webhook system.
 * Usage: npx tsx scripts/test-webhook.ts
 * 
 * Features:
 * - Create local echo server to receive webhooks
 * - Register webhook with SwiftRemit
 * - Trigger remittance events
 * - Display received webhooks
 * - Verify signatures
 */

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';

// Configuration
const WEBHOOK_PORT = 3001;
const REMITTANCE_SERVICE_URL = process.env.SERVICE_URL || 'http://localhost:3000';
const WEBHOOK_SECRET = 'test-webhook-secret-12345';

interface WebhookEvent {
  timestamp: string;
  event: string;
  data: any;
  signature: string;
  signatureValid: boolean;
}

const app = express();
app.use(express.json());

let receivedWebhooks: WebhookEvent[] = [];

/**
 * Verify webhook signature
 */
function verifySignature(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    return expectedSignature === signature;
  } catch (error) {
    return false;
  }
}

/**
 * Webhook receiver endpoint
 */
app.post('/webhooks/test', (req: Request, res: Response) => {
  const payload = JSON.stringify(req.body);
  const signature = req.headers['x-webhook-signature'] as string;
  const timestamp = req.headers['x-webhook-timestamp'] as string;
  const webhookId = req.headers['x-webhook-id'] as string;

  if (!signature || !timestamp || !webhookId) {
    console.error('❌ Missing webhook headers');
    return res.status(400).json({ error: 'Missing webhook headers' });
  }

  const isValid = verifySignature(payload, signature, timestamp, WEBHOOK_SECRET);

  const event: WebhookEvent = {
    timestamp: new Date().toISOString(),
    event: req.body.event,
    data: req.body.data,
    signature,
    signatureValid: isValid,
  };

  receivedWebhooks.push(event);

  const status = isValid ? '✅' : '❌';
  console.log(`${status} Received ${req.body.event}`);
  console.log(`   Signature: ${isValid ? 'VALID' : 'INVALID'}`);
  console.log(`   Data:`, JSON.stringify(req.body.data, null, 2));

  res.json({ success: true, id: webhookId });
});

/**
 * Dashboard endpoint to view received webhooks
 */
app.get('/webhooks/dashboard', (req: Request, res: Response) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Webhook Test Dashboard</title>
      <style>
        body { font-family: monospace; padding: 20px; background: #f5f5f5; }
        h1 { color: #333; }
        .webhook { 
          background: white; 
          border-left: 4px solid #4CAF50;
          padding: 10px;
          margin: 10px 0;
          border-radius: 4px;
        }
        .webhook.failed { border-left-color: #f44336; }
        .webhook.success { border-left-color: #4CAF50; }
        .event-type { font-weight: bold; color: #2196F3; }
        .timestamp { color: #999; font-size: 0.9em; }
        .signature { 
          padding: 5px 10px;
          background: #f0f0f0;
          border-radius: 3px;
          font-size: 0.9em;
          margin: 5px 0;
        }
        .valid { background: #c8e6c9; color: #2e7d32; }
        .invalid { background: #ffcdd2; color: #c62828; }
        .data { 
          background: #f9f9f9; 
          padding: 10px; 
          margin: 10px 0;
          border-radius: 3px;
          font-size: 0.85em;
          overflow-x: auto;
        }
        .controls { margin-bottom: 20px; }
        button { 
          padding: 10px 20px; 
          background: #2196F3; 
          color: white; 
          border: none; 
          border-radius: 4px;
          cursor: pointer;
          margin-right: 10px;
          font-size: 14px;
        }
        button:hover { background: #1976D2; }
        button.warning { background: #FF9800; }
        button.warning:hover { background: #F57C00; }
        .count { background: #E3F2FD; color: #1565C0; padding: 2px 8px; border-radius: 3px; font-weight: bold; }
        .register-info { 
          background: #FFF3E0; 
          border: 1px solid #FFB74D;
          padding: 15px;
          border-radius: 4px;
          margin-bottom: 20px;
        }
        code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
      </style>
    </head>
    <body>
      <h1>🪝 Webhook Test Dashboard</h1>
      
      <div class="register-info">
        <strong>📋 Integration:</strong><br>
        Webhook URL: <code>http://localhost:${WEBHOOK_PORT}/webhooks/test</code><br>
        Secret: <code>${WEBHOOK_SECRET}</code><br>
        Events: remittance.created, remittance.updated, remittance.completed, remittance.failed
      </div>

      <div class="controls">
        <button onclick="location.reload()">🔄 Refresh</button>
        <button onclick="clearWebhooks()" class="warning">🗑️ Clear All</button>
      </div>

      <div>
        Received Webhooks: <span class="count">${receivedWebhooks.length}</span>
      </div>

      ${
        receivedWebhooks.length === 0
          ? '<p style="color: #999;">No webhooks received yet. Trigger some events!</p>'
          : receivedWebhooks
              .map(
                (w, i) => `
                <div class="webhook ${w.signatureValid ? 'success' : 'failed'}">
                  <div>
                    <span class="event-type">${w.event}</span>
                    <span class="timestamp">${w.timestamp}</span>
                  </div>
                  <div class="signature ${w.signatureValid ? 'valid' : 'invalid'}">
                    Signature: ${w.signatureValid ? '✅ VALID' : '❌ INVALID'}
                  </div>
                  <div class="data"><pre>${JSON.stringify(w.data, null, 2)}</pre></div>
                </div>
              `
              )
              .join('')
      }

      <script>
        function clearWebhooks() {
          if (confirm('Clear all received webhooks?')) {
            fetch('/webhooks/clear', { method: 'POST' });
            location.reload();
          }
        }
        
        // Auto-refresh every 2 seconds
        setInterval(() => location.reload(), 2000);
      </script>
    </body>
    </html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/**
 * Clear webhooks endpoint
 */
app.post('/webhooks/clear', (req: Request, res: Response) => {
  receivedWebhooks = [];
  res.json({ success: true });
});

/**
 * Main test runner
 */
async function runTests() {
  console.log('🚀 Starting Webhook Test Script\n');

  // Start local server
  const server = app.listen(WEBHOOK_PORT, () => {
    console.log(`✅ Test server running on http://localhost:${WEBHOOK_PORT}`);
    console.log(`📊 Dashboard: http://localhost:${WEBHOOK_PORT}/webhooks/dashboard\n`);
  });

  // Test webhook registration and triggering
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    // Step 1: Register webhook
    console.log('📝 Step 1: Registering webhook...');
    const webhookUrl = `http://localhost:${WEBHOOK_PORT}/webhooks/test`;

    const registerResponse = await axios.post(
      `${REMITTANCE_SERVICE_URL}/api/webhooks/register`,
      {
        url: webhookUrl,
        events: ['remittance.created', 'remittance.updated', 'remittance.completed', 'remittance.failed'],
        secret: WEBHOOK_SECRET,
      }
    );

    if (registerResponse.status === 200 || registerResponse.status === 201) {
      console.log('✅ Webhook registered successfully');
      console.log(`   ID: ${registerResponse.data.id}\n`);
    } else {
      console.error('❌ Failed to register webhook:', registerResponse.status);
    }

    // Step 2: Trigger remittance events
    console.log('🎯 Step 2: Triggering remittance events...\n');

    const remittanceId = `remit_${Date.now()}`;

    // Event 1: Created
    console.log('📤 Sending remittance.created event...');
    await axios.post(`${REMITTANCE_SERVICE_URL}/api/remittances/${remittanceId}/status`, {
      status: 'pending',
      amount: 150.00,
      currency: 'USD',
      sourceCurrency: 'GBP',
      recipientId: 'recip_123',
      reason: 'Test remittance',
    });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Event 2: Updated
    console.log('📤 Sending remittance.updated event...');
    await axios.post(`${REMITTANCE_SERVICE_URL}/api/remittances/${remittanceId}/status`, {
      status: 'processing',
      amount: 150.00,
      currency: 'USD',
      recipientId: 'recip_123',
    });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Event 3: Completed
    console.log('📤 Sending remittance.completed event...');
    await axios.post(`${REMITTANCE_SERVICE_URL}/api/remittances/${remittanceId}/status`, {
      status: 'completed',
      amount: 150.00,
      currency: 'USD',
      recipientId: 'recip_123',
    });
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n✅ All events sent!\n');
    console.log('📊 View received webhooks at: http://localhost:${WEBHOOK_PORT}/webhooks/dashboard');
    console.log('   (Page auto-refreshes every 2 seconds)\n');

    // Keep server running
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down test server...');
      server.close(() => {
        console.log('Done!');
        process.exit(0);
      });
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('❌ Error:', error.response?.data || error.message);
    } else {
      console.error('❌ Error:', error);
    }

    server.close(() => {
      process.exit(1);
    });
  }
}

// Run tests
runTests();
