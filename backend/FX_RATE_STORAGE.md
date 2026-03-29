# FX Rate Storage

## Overview

The FX rate storage feature captures and stores the exchange rate used at transaction time, ensuring immutability and auditability for all remittance transactions.

## Features

✅ **Rate Storage**: Save FX rate, provider, and timestamp at transaction time  
✅ **Immutability**: Prevent recalculation during settlement using UNIQUE constraint  
✅ **Auditability**: Full audit trail with timestamps and provider information  
✅ **High Precision**: Support for up to 8 decimal places (DECIMAL(20, 8))

## Database Schema

```sql
CREATE TABLE fx_rates (
  id SERIAL PRIMARY KEY,
  transaction_id VARCHAR(100) NOT NULL UNIQUE,
  rate DECIMAL(20, 8) NOT NULL,
  provider VARCHAR(100) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  from_currency VARCHAR(10) NOT NULL,
  to_currency VARCHAR(10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fx_transaction ON fx_rates(transaction_id);
CREATE INDEX idx_fx_timestamp ON fx_rates(timestamp);
CREATE INDEX idx_fx_currencies ON fx_rates(from_currency, to_currency);
```

## API Endpoints

### Store FX Rate

**POST** `/api/fx-rate`

Store the FX rate used for a transaction.

**Request Body:**
```json
{
  "transactionId": "tx_12345",
  "rate": 1.25,
  "provider": "CurrencyAPI",
  "fromCurrency": "USD",
  "toCurrency": "EUR"
}
```

**Response:**
```json
{
  "success": true,
  "message": "FX rate stored successfully"
}
```

**Validation:**
- `transactionId`: Required, string
- `rate`: Required, positive number
- `provider`: Required, string
- `fromCurrency`: Required, string
- `toCurrency`: Required, string

### Get FX Rate

**GET** `/api/fx-rate/:transactionId`

Retrieve the FX rate for a specific transaction.

**Response:**
```json
{
  "id": 1,
  "transaction_id": "tx_12345",
  "rate": 1.25,
  "provider": "CurrencyAPI",
  "timestamp": "2024-01-15T10:30:00Z",
  "from_currency": "USD",
  "to_currency": "EUR",
  "created_at": "2024-01-15T10:30:05Z"
}
```

**Error Response (404):**
```json
{
  "error": "FX rate not found for this transaction"
}
```

## Usage Example

### Storing Rate at Transaction Time

```typescript
import { saveFxRate } from './database';

// When creating a remittance transaction
const transactionId = 'remittance_001';
const currentRate = await fetchExchangeRate('USD', 'EUR');

await saveFxRate({
  transaction_id: transactionId,
  rate: currentRate,
  provider: 'CurrencyAPI',
  timestamp: new Date(),
  from_currency: 'USD',
  to_currency: 'EUR',
});
```

### Retrieving Rate During Settlement

```typescript
import { getFxRate } from './database';

// During settlement, use stored rate (no recalculation)
const storedRate = await getFxRate(transactionId);

if (storedRate) {
  const convertedAmount = amount * storedRate.rate;
  // Use stored rate for settlement
}
```

## Acceptance Criteria

✅ **Save rate, provider, timestamp**: All three fields are stored atomically  
✅ **Prevent recalculation during settlement**: UNIQUE constraint on transaction_id prevents updates  
✅ **Ensure auditability**: Timestamps and provider information provide full audit trail

## Immutability Guarantee

The `UNIQUE(transaction_id)` constraint combined with `ON CONFLICT DO NOTHING` ensures that:

1. Once an FX rate is stored for a transaction, it cannot be modified
2. Subsequent attempts to store a rate for the same transaction are silently ignored
3. Settlement always uses the original rate captured at transaction time

## Testing

Run tests with:

```bash
cd backend
npm test fx-rate.test.ts
```

Tests cover:
- Rate storage at transaction time
- Immutability (prevention of recalculation)
- Auditability (timestamp and provider tracking)
- High precision rate handling
- Error cases (non-existent transactions)

## Security Considerations

- **Input Validation**: All inputs are validated before storage
- **Rate Limiting**: API endpoints are protected by rate limiting
- **SQL Injection**: Parameterized queries prevent SQL injection
- **Precision**: DECIMAL type prevents floating-point errors

## Performance

- **Indexes**: Optimized queries with indexes on transaction_id, timestamp, and currencies
- **Single Write**: Atomic insert operation
- **Fast Lookup**: O(1) lookup by transaction_id using primary index

## Integration

The FX rate storage integrates with:

1. **Transaction Creation**: Store rate when remittance is created
2. **Settlement**: Retrieve rate during payout confirmation
3. **Audit Reports**: Query historical rates for compliance
4. **Analytics**: Track rate trends over time
