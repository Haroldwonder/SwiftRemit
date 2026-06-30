# OpenAPI Documentation

This document describes the OpenAPI 3.0 specification implementation for SwiftRemit services.

## Overview

SwiftRemit now provides machine-readable API specifications for both services:
- **API Service** (`api/`): Currency configuration and anchor management
- **Backend Service** (`backend/`): Asset verification, KYC, and webhook handling

## Accessing the Documentation

### Development

When running the services locally, Swagger UI documentation is available at:

- API Service: http://localhost:3000/api/docs
- Backend Service: http://localhost:3001/api/docs

### OpenAPI Spec Files

Raw OpenAPI specifications are available at:

- API Service: `api/openapi.yaml`
- Backend Service: `backend/openapi.yaml`

You can also access them via HTTP:
- http://localhost:3000/api/docs/openapi.json
- http://localhost:3000/api/docs/openapi.yaml
- http://localhost:3001/api/docs/openapi.json
- http://localhost:3001/api/docs/openapi.yaml

## Generating Client SDKs

Use the OpenAPI specifications to generate client SDKs in various languages:

### JavaScript/TypeScript
```bash
npx @openapitools/openapi-generator-cli generate \
  -i api/openapi.yaml \
  -g typescript-axios \
  -o ./generated/api-client
```

### Python
```bash
openapi-generator-cli generate \
  -i backend/openapi.yaml \
  -g python \
  -o ./generated/backend-client
```

### Java
```bash
openapi-generator-cli generate \
  -i api/openapi.yaml \
  -g java \
  -o ./generated/api-client-java
```

### Other Languages
OpenAPI Generator supports 50+ languages. See: https://openapi-generator.tech/docs/generators

## Validation

### Manual Validation

Validate the OpenAPI specs manually:

```bash
# API Service
cd api
npm run validate:openapi

# Backend Service
cd backend
npm run validate:openapi
```

### CI/CD Validation

The OpenAPI specs are automatically validated in CI/CD pipelines:
- On every push to `main` or `develop`
- On every pull request
- Checks that specs are valid and up-to-date

See `.github/workflows/openapi-validation.yml` for details.

## API Service Endpoints

### Health
- `GET /health` - Health check

### Currencies
- `GET /api/currencies` - List all currencies
- `GET /api/currencies/{code}` - Get currency by code

### Anchors
- `GET /api/anchors` - List all anchors (with optional filtering)
- `GET /api/anchors/{id}` - Get anchor by ID
- `POST /api/anchors/admin` - Create anchor (requires API key)

## Backend Service Endpoints

### Health
- `GET /health` - Health check

### Asset Verification
- `GET /api/verification/{assetCode}/{issuer}` - Get asset verification status
- `POST /api/verification/verify` - Trigger asset verification
- `POST /api/verification/report` - Report suspicious asset
- `GET /api/verification/verified` - List verified assets
- `POST /api/verification/batch` - Batch verification status

### KYC
- `GET /api/kyc/status` - Get KYC status (requires authentication)

### Transfer
- `POST /api/transfer` - Initiate transfer (requires KYC approval)

### FX Rates
- `POST /api/fx-rate` - Store FX rate
- `GET /api/fx-rate/{transactionId}` - Get FX rate for transaction

### Webhooks
- `POST /api/webhook` - Receive webhook (requires signature verification)

## Authentication

### API Service
- Admin endpoints require `x-api-key` header

### Backend Service
- User endpoints require `x-user-id` header
- Webhook endpoints require signature headers:
  - `x-signature`: HMAC signature
  - `x-timestamp`: Request timestamp
  - `x-nonce`: Unique nonce
  - `x-anchor-id`: Anchor identifier

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE"
  },
  "timestamp": "2026-03-28T20:00:00.000Z"
}
```

### Common Error Codes
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (missing/invalid authentication)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (resource doesn't exist)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

## Rate Limiting

Both services implement rate limiting:
- Default: 100 requests per 15 minutes per IP
- Configurable via environment variables:
  - `RATE_LIMIT_WINDOW_MS`
  - `RATE_LIMIT_MAX_REQUESTS`

## Maintenance

### Keeping Specs Up-to-Date

The OpenAPI specifications should be updated whenever:
1. New endpoints are added
2. Request/response schemas change
3. Authentication requirements change
4. Error codes are added or modified

### Best Practices

1. **Validate before committing**: Always run `npm run validate:openapi` before committing changes
2. **Update examples**: Keep example values realistic and helpful
3. **Document error cases**: Include all possible error responses
4. **Version appropriately**: Update version numbers for breaking changes
5. **Test with real clients**: Generate and test client SDKs to ensure usability

## Tools and Resources

- **Swagger UI**: Interactive API documentation
- **Swagger Editor**: https://editor.swagger.io/ (paste spec to edit)
- **OpenAPI Generator**: https://openapi-generator.tech/
- **Postman**: Import OpenAPI spec to create collections
- **Insomnia**: Import OpenAPI spec for API testing

## Support

For questions or issues with the API specifications:
1. Check this documentation
2. Review the OpenAPI spec files
3. Test endpoints using Swagger UI
4. Contact the SwiftRemit development team
