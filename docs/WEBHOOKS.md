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
