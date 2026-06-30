import { Keypair } from '@stellar/stellar-sdk';
import crypto from 'crypto';

/**
 * Example: Send a webhook to SwiftRemit
 * This demonstrates how an anchor would send webhook callbacks
 */

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhooks/anchor';
const ANCHOR_ID = process.env.ANCHOR_ID || 'test-anchor';

// Method 1: Using Stellar Keypair Signature
async function sendWebhookWithKeypair() {
  // In production, this would be the anchor's secret key
  const keypair = Keypair.random();
  console.log('Using public key:', keypair.publicKey());

  const payload = {
    event_type: 'deposit_update',
    transaction_id: 'test-tx-001',
    status: 'pending_anchor',
    amount_in: '100.00',
    amount_out: '99.50',
    amount_fee: '0.50',
    message: 'Deposit received, processing'
  };

  const payloadString = JSON.stringify(payload);
  const signature = keypair.sign(Buffer.from(payloadString)).toString('base64');
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': signature,
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-anchor-id': ANCHOR_ID
    },
    body: payloadString
  });

  const result = await response.json();
  console.log('Response:', result);
  return result;
}

// Method 2: Using HMAC Signature
async function sendWebhookWithHMAC() {
  const secret = process.env.WEBHOOK_SECRET || 'test-secret';

  const payload = {
    event_type: 'withdrawal_update',
    transaction_id: 'test-tx-002',
    status: 'pending_external',
    external_transaction_id: 'bank-tx-12345',
    amount_out: '95.00'
  };

  const payloadString = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
  
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': signature,
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-anchor-id': ANCHOR_ID
    },
    body: payloadString
  });

  const result = await response.json();
  console.log('Response:', result);
  return result;
}

// Method 3: KYC Update
async function sendKYCUpdate() {
  const secret = process.env.WEBHOOK_SECRET || 'test-secret';

  const payload = {
    event_type: 'kyc_update',
    transaction_id: 'test-tx-001',
    kyc_status: 'approved',
    kyc_fields: {
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com'
    }
  };

  const payloadString = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
  
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': signature,
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-anchor-id': ANCHOR_ID
    },
    body: payloadString
  });

  const result = await response.json();
  console.log('Response:', result);
  return result;
}

// Run examples
async function main() {
  console.log('🔔 Testing Webhook Endpoints\n');

  try {
    console.log('1️⃣ Testing Keypair Signature...');
    await sendWebhookWithKeypair();
    console.log('✅ Keypair test complete\n');

    console.log('2️⃣ Testing HMAC Signature...');
    await sendWebhookWithHMAC();
    console.log('✅ HMAC test complete\n');

    console.log('3️⃣ Testing KYC Update...');
    await sendKYCUpdate();
    console.log('✅ KYC test complete\n');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { sendWebhookWithKeypair, sendWebhookWithHMAC, sendKYCUpdate };
