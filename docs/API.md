# API Versioning & Deprecation Policy

## Versioning Scheme

SwiftRemit uses URL-prefix versioning. All endpoints are reachable under
`/v1/`. Example: `GET /v1/remittances`.

Unversioned paths (`GET /remittances`) are aliased to the current version
with a `Deprecation: true` header. Clients should migrate to versioned
paths.

An `Accept-Version` header is also supported as a fallback.

## Support Window

Each API version is supported for **12 months** after its successor is
released. During this window:
- The version continues to receive security fixes.
- No breaking changes are made.
- Deprecation and Sunset headers are emitted.

## Deprecation Headers

Deprecated endpoints include:
- `Deprecation: date="YYYY-MM-DD"` — when the deprecation was announced.
- `Sunset: YYYY-MM-DD` — when the endpoint will be removed.
- `Link: </v2/new-path>; rel="successor-version"` — where to migrate.

## Breaking Changes

A breaking change is any of:
- Removing a field from a response.
- Changing a field's type.
- Removing an endpoint.
- Changing error codes.

Breaking changes require a new API version. Additive changes (new fields,
new endpoints) are made within the current version.

## Contract Tests

The v1 response shapes are pinned by contract tests. Any change to a v1
response shape fails CI, ensuring backwards compatibility.
