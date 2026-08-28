# Backend authorisation matrix

Companion to `api/AUTH_MATRIX.md`, covering the `backend` service. Historically
this service had no equivalent contract, which is how `/api/admin`, `/api/aml`
and `/api/compliance` shipped reachable with no authentication at all (see the
SR-131 finding this file was added to close). Every route group below and the
guard it requires must match `src/__tests__/auth-matrix.test.ts`; drift fails
the build.

## Guard types

| Guard | Enforcement |
|---|---|
| `public` | No authentication |
| `apiKeyRateLimiter` | Flat per-IP/key bucket only — no identity check |
| `scopedApiKey(scope)` | `scopedApiKeyMiddleware` (`src/middleware/api-key-rate-limit.ts`) resolves the caller's API key, rejects missing/revoked/expired keys with 401, and rejects keys lacking `scope` with 403. The mapping from route prefix to required scope lives in `ROUTE_SCOPES` (`src/middleware/api-key-store.ts`) — that table is the enforcement source of truth, this document is the human-readable mirror of it. |
| `officer` | `requireOfficer` (`src/routes/aml.ts`) — resolves from the verified API-key owner first, x-officer-id header only as legacy fallback |

`admin:*` is a wildcard scope that satisfies every other scope check
(`ApiKeyStore.hasScope`).

## Matrix

| Method | Route prefix | Guard | Notes |
|---|---|---|---|
| GET/POST/DELETE/PATCH | `/api/admin/*` | `scopedApiKey(admin:*)` | Audit log, jobs, webhook rotation. Was previously reachable with only a 20 req/min IP limiter. |
| GET | `/api/aml/*` | `scopedApiKey(read:compliance)` | Screening results, alert queue, SAR/travel-rule reads. |
| POST/PATCH | `/api/aml/*` | `scopedApiKey(admin:*)` + `officer` | Mutating AML actions also require `requireOfficer`, which now derives the actor from the API-key owner rather than the caller-supplied `x-officer-id` header. |
| GET | `/api/compliance/*` | `scopedApiKey(read:compliance)` | Includes `/api/compliance/report`, which returns joined remittance + transaction PII and previously had no auth at all. |
| POST/PATCH | `/api/compliance/*` | `scopedApiKey(admin:*)` | Threshold and flag-status mutations. |
| GET | `/api/devices/*` | `scopedApiKey(read:devices)` | |
| POST/PATCH/DELETE | `/api/devices/*` | `scopedApiKey(admin:*)` | |
| POST/GET/DELETE | `/api/developers/keys` | `scopedApiKey(admin:*)` + Bearer owner token | Unchanged from SR-043. |
| GET | `/api/verification/*` | `scopedApiKey(read:verification)` | Most permissive; default free-tier scope. |
| GET | `/api/kyc/*` | `scopedApiKey(read:kyc)` | |
| POST | `/api/kyc/register` | `scopedApiKey(write:kyc)` | |
| POST | `/api/remittance`, `/api/fx-rate` | `scopedApiKey(write:remittance)` | |
| GET | `/api/remittance/*`, `/api/fx-rate/*` | `scopedApiKey(read:remittance)` | |
| ALL | `/health`, `/metrics`, `/api/docs` | `public` | No PII, no mutation. |
| POST | `/webhooks/kyc/:anchor_id` | HMAC signature (`verifyAnchorSignature`, SR-131) | Previously `public` — see the KYC webhook finding. |

## Known limitations

- `ROUTE_SCOPES` matches on a literal method+path-prefix string, not the
  Express route pattern — a route registered under a prefix not listed here
  silently requires no scope (`requiredScopeForRoute` returns `null`). New
  routers under `/api/*` must add an entry here and in `ROUTE_SCOPES`.
- Officer/admin identity is still just "the API key's `owner_id`" — there is
  no role table distinguishing an operations officer from any other key
  owner. A key with `admin:*` can act as an AML officer.
