# Webhook System Quick Reference

## 🚀 Quick Start

```bash
# Setup
./setup-webhooks.sh

# Start server
cd backend && npm run dev

# Test
npm run webhook:example
```

## 📡 Endpoint

```
POST /webhooks/anchor
```

## 🔑 Required Headers

| Header | Description | Example |
|--------|-------------|---------|
| `x-signature` | Base64 signature or hex HMAC | `dGVzdC1zaWduYXR1cmU=` |
| `x-timestamp` | ISO-8601 timestamp | `2026-02-26T12:00:00Z` |
| `x-nonce` | Unique request ID | `550e8400-e29b-41d4-a716-446655440000` |
| `x-anchor-id` | Anchor identifier | `anchor-123` |

## 📦 Event Types

### Deposit Update
```json
{
  "event_type": "deposit_update",
  "transaction_id": "tx-123",
  "status": "pending_stellar",
  "amount_in": "100.00",
  "amount_out": "99.50",
  "amount_fee": "0.50"
}
```

### Withdrawal Update
```json
{
  "event_type": "withdrawal_update",
  "transaction_id": "tx-456",
  "status": "pending_external",
  "external_transaction_id": "bank-tx-789"
}
```

### KYC Update
```json
{
  "event_type": "kyc_update",
  "transaction_id": "tx-789",
  "kyc_status": "approved"
}
```

## 🔒 Signature Methods

### Method 1: Stellar Keypair
```typescript
const signature = keypair
  .sign(Buffer.from(payload))
  .toString('base64');
```

### Method 2: HMAC-SHA256
```typescript
const signature = crypto
  .createHmac('sha256', secret)
  .update(payload)
  .digest('hex');
```

## 📊 Status Transitions

### Deposits
```
pending_user_transfer_start
  → pending_anchor
  → pending_stellar
  → completed
```

### Withdrawals
```
pending_user_transfer_start
  → pending_anchor
  → pending_external
  → completed
```

## 🚨 Error Responses

| Code | Error | Reason |
|------|-------|--------|
| 400 | Missing headers | Required header missing |
| 401 | Invalid timestamp | Outside 5-min window |
| 401 | Invalid nonce | Duplicate/replay attempt |
| 401 | Invalid signature | Signature verification failed |
| 404 | Anchor not found | Unknown anchor_id |
| 500 | Internal error | Server error |

## 🔍 Monitoring

### Key Queries
```sql
-- Success rate
SELECT COUNT(*), 
  SUM(CASE WHEN verified THEN 1 ELSE 0 END) as verified
FROM webhook_logs 
WHERE received_at > NOW() - INTERVAL '1 hour';

-- Suspicious activity
SELECT * FROM suspicious_webhooks 
WHERE investigated = false;

-- Stuck transactions
SELECT * FROM transactions 
WHERE status NOT IN ('completed', 'error')
  AND updated_at < NOW() - INTERVAL '24 hours';
```

## 🛠️ Troubleshooting

### Signature Fails
- ✅ Check anchor public key
- ✅ Verify payload encoding (UTF-8)
- ✅ Confirm signature format (base64)

### Timestamp Fails
- ✅ Check server time (NTP sync)
- ✅ Verify timezone handling
- ✅ Ensure within 5-min window

### State Transition Fails
- ✅ Check current status
- ✅ Verify transition is valid
- ✅ Confirm transaction exists

## 📝 Database Tables

| Table | Purpose |
|-------|---------|
| `webhook_logs` | All incoming webhooks |
| `suspicious_webhooks` | Flagged activity |
| `anchors` | Registered anchors |
| `transactions` | Transaction records |
| `transaction_state_history` | State changes |

## 🎯 Security Checklist

- ✅ Signature verification enabled
- ✅ Timestamp validation (5-min window)
- ✅ Nonce tracking active
- ✅ HTTPS enforced
- ✅ Rate limiting configured
- ✅ Suspicious activity monitoring
- ✅ Audit logging enabled

## 📚 Documentation

- **Full Docs**: `WEBHOOK_SYSTEM.md`
- **Implementation**: `WEBHOOK_IMPLEMENTATION_SUMMARY.md`
- **Monitoring**: `backend/monitoring/webhook_queries.sql`
- **Examples**: `backend/examples/send-webhook.ts`

## 🔧 NPM Scripts

```bash
npm run dev              # Start dev server
npm run test             # Run all tests
npm run test:webhook     # Run webhook tests only
npm run webhook:example  # Send test webhook
```

## 📞 Support

- Check logs: `SELECT * FROM webhook_logs ORDER BY received_at DESC LIMIT 10`
- Check suspicious: `SELECT * FROM suspicious_webhooks WHERE investigated = false`
- Check state: `SELECT * FROM transaction_state_history WHERE transaction_id = 'tx-123'`
