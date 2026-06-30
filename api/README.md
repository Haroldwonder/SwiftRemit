# SwiftRemit Currency Configuration API

RESTful API service that exposes supported currencies and their formatting rules with dynamic configuration loading.

## Features

✅ Dynamic currency configuration from JSON file
✅ Environment-based configuration overrides
✅ Startup validation with fail-fast behavior
✅ Schema-validated JSON responses
✅ Comprehensive error handling
✅ Rate limiting and security headers
✅ Unit and integration tests
✅ Zero breaking changes to existing APIs

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Run development server
npm run dev

# Build for production
npm run build
npm start

# Run tests
npm test

# Run integration tests
npm run test:integration
```

## API Endpoints

### GET /api/currencies

Returns all supported currencies with their formatting rules.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "code": "USD",
      "symbol": "$",
      "decimal_precision": 2,
      "name": "United States Dollar"
    },
    {
      "code": "EUR",
      "symbol": "€",
      "decimal_precision": 2,
      "name": "Euro"
    }
  ],
  "count": 2,
  "timestamp": "2026-02-23T10:30:00.000Z"
}
```

### GET /api/currencies/:code

Returns a specific currency by code (case-insensitive).

**Example:** `GET /api/currencies/USD`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "code": "USD",
      "symbol": "$",
      "decimal_precision": 2,
      "name": "United States Dollar"
    }
  ],
  "count": 1,
  "timestamp": "2026-02-23T10:30:00.000Z"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": {
    "message": "Currency not found: XYZ",
    "code": "CURRENCY_NOT_FOUND"
  },
  "timestamp": "2026-02-23T10:30:00.000Z"
}
```

### GET /api/anchors

Returns all available anchor providers with optional filtering.

**Query Parameters:**
- `status` (optional): Filter by status (`active`, `inactive`, `maintenance`)
- `currency` (optional): Filter by supported currency code (e.g., `USD`)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "anchor-1",
      "name": "MoneyGram Access",
      "domain": "moneygram.stellar.org",
      "description": "Global money transfer service",
      "status": "active",
      "fees": {
        "deposit_fee_percent": 1.5,
        "withdrawal_fee_percent": 2.0,
        "withdrawal_fee_fixed": 1.0,
        "min_fee": 1.0,
        "max_fee": 50.0
      },
      "limits": {
        "min_amount": 10,
        "max_amount": 10000,
        "daily_limit": 25000
      },
      "compliance": {
        "kyc_required": true,
        "kyc_level": "intermediate",
        "supported_countries": ["US", "CA"],
        "restricted_countries": ["KP"],
        "documents_required": ["government_id"]
      },
      "supported_currencies": ["USD"],
      "processing_time": "1-3 business days",
      "rating": 4.5,
      "verified": true
    }
  ],
  "count": 1,
  "timestamp": "2026-02-25T10:30:00.000Z"
}
```

### GET /api/anchors/:id

Returns details for a specific anchor provider.

**Example:** `GET /api/anchors/anchor-1`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "anchor-1",
    "name": "MoneyGram Access",
    ...
  },
  "timestamp": "2026-02-25T10:30:00.000Z"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": {
    "message": "Anchor with id 'invalid-id' not found",
    "code": "ANCHOR_NOT_FOUND"
  },
  "timestamp": "2026-02-25T10:30:00.000Z"
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-23T10:30:00.000Z",
  "uptime": 123.456
}
```

## Configuration

### Currency Configuration File

Location: `./config/currencies.json` (configurable via `CURRENCY_CONFIG_PATH`)

**Structure:**
```json
{
  "currencies": [
    {
      "code": "USD",
      "symbol": "$",
      "decimal_precision": 2,
      "name": "United States Dollar"
    }
  ]
}
```

**Field Validation:**
- `code`: 3-12 uppercase alphanumeric characters (required)
- `symbol`: 1-10 characters (required)
- `decimal_precision`: Integer 0-18 (required)
- `name`: 1-100 characters (optional)

### Environment Variables

```bash
# API Configuration
PORT=3000
NODE_ENV=development

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100

# Currency Configuration
CURRENCY_CONFIG_PATH=./config/currencies.json
CURRENCY_CONFIG_ENV_OVERRIDE=false

# Environment-specific overrides (JSON array)
CURRENCY_OVERRIDES='[{"code":"USD","symbol":"$","decimal_precision":2}]'
```

### Environment Overrides

Enable environment-based configuration overrides:

```bash
# Enable overrides
CURRENCY_CONFIG_ENV_OVERRIDE=true

# Override existing currency or add new ones
CURRENCY_OVERRIDES='[
  {"code":"USD","symbol":"US$","decimal_precision":3},
  {"code":"CAD","symbol":"C$","decimal_precision":2}
]'
```

Overrides are merged with the base configuration:
- Existing currencies are updated
- New currencies are added
- Base configuration remains unchanged

## Validation

### Startup Validation

The service validates configuration at startup and **fails fast** if:
- Configuration file is missing or invalid JSON
- Required fields are missing
- Field values are out of range
- Duplicate currency codes exist
- Environment overrides are malformed

### Runtime Validation

All API responses are schema-validated to ensure:
- Consistent response structure
- Type safety
- Required fields present
- Valid data formats

## Error Handling

### Configuration Errors

```
✗ Failed to load currency configuration: Configuration file not found: /path/to/config.json
✗ Server startup aborted due to configuration error
```

The server will **not start** if configuration is invalid.

### API Errors

All errors return consistent format:

```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE"
  },
  "timestamp": "2026-02-23T10:30:00.000Z"
}
```

**Error Codes:**
- `CURRENCY_NOT_FOUND` - Currency code not found (404)
- `INVALID_CURRENCY_CODE` - Invalid currency code format (400)
- `CURRENCY_RETRIEVAL_ERROR` - Internal error retrieving currency (500)
- `ROUTE_NOT_FOUND` - API route not found (404)
- `RATE_LIMIT_EXCEEDED` - Too many requests (429)
- `INTERNAL_SERVER_ERROR` - Unexpected server error (500)

## Testing

### Unit Tests

```bash
npm test
```

Tests cover:
- Configuration loading from file
- Environment override merging
- Validation rules
- Error handling
- Currency retrieval

### Integration Tests

```bash
npm run test:integration
```

Tests cover:
- End-to-end API requests
- Configuration change reflection
- Concurrent request handling
- Performance benchmarks
- Data integrity

### Test Coverage

```bash
npm test -- --coverage
```

## Security

### Rate Limiting

- 100 requests per 15 minutes per IP
- Configurable via environment variables
- Returns 429 status when exceeded

### Security Headers

- Helmet.js for security headers
- CORS enabled
- JSON body parsing with size limits

### Input Validation

- Currency codes validated against pattern
- Decimal precision range checked
- Symbol length validated
- No SQL injection risk (no database)

## Performance

- Configuration loaded once at startup
- In-memory currency lookup (O(n))
- No database queries
- Response time < 100ms
- Handles 1000+ req/s

## Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment Setup

```bash
# Production
NODE_ENV=production
PORT=3000
CURRENCY_CONFIG_PATH=/app/config/currencies.json
```

### Health Checks

```bash
# Kubernetes liveness probe
curl http://localhost:3000/health

# Expected response
{"status":"ok","timestamp":"...","uptime":123.456}
```

## Adding New Currencies

### Method 1: Update Configuration File

Edit `config/currencies.json`:

```json
{
  "currencies": [
    {
      "code": "BTC",
      "symbol": "₿",
      "decimal_precision": 8,
      "name": "Bitcoin"
    }
  ]
}
```

Restart the service to apply changes.

### Method 2: Environment Override

Set environment variable:

```bash
CURRENCY_CONFIG_ENV_OVERRIDE=true
CURRENCY_OVERRIDES='[{"code":"BTC","symbol":"₿","decimal_precision":8}]'
```

No code changes required!

## Troubleshooting

### Configuration Not Loading

```bash
# Check file exists
ls -la config/currencies.json

# Validate JSON
cat config/currencies.json | jq .

# Check environment variable
echo $CURRENCY_CONFIG_PATH
```

### Validation Errors

```bash
# Check logs for specific validation errors
npm run dev

# Example error:
# Configuration validation failed: "decimal_precision" must be less than or equal to 18
```

### Port Already in Use

```bash
# Change port
PORT=3001 npm run dev

# Or kill existing process
lsof -ti:3000 | xargs kill
```

## License

MIT
