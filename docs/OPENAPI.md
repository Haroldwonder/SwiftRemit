# OpenAPI Specification

> Single source of truth for the SwiftRemit API specification.

## Overview

SwiftRemit publishes a single OpenAPI 3.0 specification that covers all public
API endpoints. The spec is generated from route definitions and validated in CI.

## Generating the spec

```bash
npm run generate:openapi
```

This produces `api/openapi.yaml` from the route definitions in `api/src/routes/`.

## Validation

The CI pipeline (`openapi-validation.yml`) validates that:
1. The generated spec is valid OpenAPI 3.0.
2. Every route in `api/src/routes/` has a corresponding OpenAPI operation.
3. Request/response schemas match TypeScript type definitions.

## Schema sharing

Shared schema components live in `api/src/schemas/openapi.ts`. Both the API
and backend services import from this single location. Do not create duplicate
schema definitions in `backend/src/schemas/`.

## Pagination

All list endpoints use cursor-based pagination (SR-051). The standard envelope:

```json
{
  "data": [...],
  "next_cursor": "string | null",
  "has_more": true,
  "page_size": 20
}
```

Query parameters:
- `cursor` (string, optional): Cursor from a previous response's `next_cursor`.
- `limit` (integer, optional): Page size. Default: 20, max: 100.

## Adding a new endpoint

1. Add the route handler in `api/src/routes/`.
2. Add the OpenAPI operation in `api/src/schemas/openapi.ts`.
3. Run `npm run generate:openapi` to regenerate the spec.
4. CI will fail if the route exists without a spec entry.
