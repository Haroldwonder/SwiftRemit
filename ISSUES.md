# SwiftRemit — Issue Tracker

This file is the canonical source of tracked security, feature, and test issues
for the SwiftRemit monorepo. Each entry maps to a branch and commit convention.

---

## SR-041 · Shared Secrets Manager
**Area:** Backend · **Type:** Security · **Priority:** P1 · **Status:** ✅ Done  
**Branch:** `sr-041-shared-secrets-manager`

Extracted a single shared secrets module (`shared/src/secrets-manager.ts`) consumed
by both `backend/` and `api/`. Production startup fails fast when a required secret
resolves from a plaintext env var. Secret caching with TTL and rotation-without-restart
are supported. No secret value is ever logged.

**Files changed:**
- `shared/src/secrets-manager.ts` — canonical implementation
- `backend/src/secrets-manager.ts` — re-export shim
- `api/src/secrets-manager.ts` — re-export shim
- `backend/src/index.ts` — production AWS_REGION guard + Promise.all pre-flight
- `api/src/index.ts` — production AWS_REGION guard + Promise.all pre-flight

---

## SR-042 · Centralised XSS Sanitization
**Area:** Backend · **Type:** Security · **Priority:** P1 · **Status:** ✅ Done  
**Branch:** `sr-042-centralised-xss-sanitization`

Sanitization centralised in `shared/src/sanitizer.ts` with context-specific encoding
for JSON responses, HTML email, PDF receipts, and on-chain Stellar memos. Applied at
the Zod (backend) and Joi (api) validation layers so every parsed field is sanitized
automatically. OWASP XSS Filter Evasion payloads are neutralised in all four contexts.
Log redaction extended to cover high-entropy strings and connection strings by value
pattern in addition to key-name matching.

**Files changed:**
- `shared/src/sanitizer.ts` — four context encoders
- `shared/src/logger.ts` — enhanced redaction (16 sensitive keys + value heuristic)
- `backend/src/sanitizer.ts` — re-export shim
- `api/src/utils/sanitize.ts` — re-export shim
- `backend/src/schemas/zod.ts` — `.transform()` on every string field
- `api/src/schemas/requestValidation.ts` — `.custom()` wrappers on every string field
- `backend/src/correlation-id.ts` — extends shared logger with OTel + correlation IDs
- `api/src/types.ts` — re-exports shared logger (removes duplicate implementation)
- `backend/src/__tests__/sanitizer.test.ts` — 59 test cases incl. 37 OWASP payloads

---

## SR-043 · Scoped API Key Middleware
**Area:** Backend · **Type:** Security · **Priority:** P1 · **Status:** ✅ Done  
**Branch:** `sr-043-scoped-api-keys`  
**Commit:** `feat(auth): scoped API keys with hashed storage and tier rate limits (SR-043)`

### Scope model

| Scope | Routes |
|---|---|
| `read:verification` | `GET /api/verification/*`, `POST /api/verification/*` |
| `write:remittance` | `POST /api/remittance`, `POST /api/fx-rate` |
| `read:remittance` | `GET /api/remittance/*`, `GET /api/fx-rate/*` |
| `read:kyc` | `GET /api/kyc/*` |
| `write:kyc` | `POST /api/kyc/register` |
| `admin:*` | All `/api/admin/*`, `/api/kyc/config`, `/api/developers/*` |

### Acceptance criteria status
- ✅ A key without the required scope receives 403
- ✅ Keys are stored SHA-256 hashed; the `api_keys` table has `key_hash CHAR(64)`, no plaintext column
- ✅ Revoked and expired keys are rejected immediately (401)
- ✅ `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers on every authenticated response (`draft-7` standard)

### Rate-limit tiers
| Tier | Max requests / min |
|---|---|
| `free` (default) | 100 |
| `standard` | 500 |
| `premium` | 2 000 |

### API
- `POST /api/developers/keys` — create key (secret shown once)
- `GET /api/developers/keys` — list caller's keys (no secret/hash in response)
- `DELETE /api/developers/keys/:key_id` — revoke immediately; 403 if wrong owner

**Files changed:**
- `backend/src/middleware/api-key-store.ts` — new: store, hashing, scope model, route map
- `backend/src/middleware/api-key-rate-limit.ts` — replaced: tier limiters + scopedApiKeyMiddleware
- `backend/src/api.ts` — initApiKeyMiddleware at startup, scopedApiKeyMiddleware in chain, CRUD routes
- `backend/src/__tests__/api-key-store.test.ts` — 40 test cases

---

## SR-044 · Test Coverage Enforcement
**Area:** Backend · **Type:** Test · **Priority:** P2 · **Status:** ✅ Done  
**Branch:** `sr-044-coverage-enforcement`  
**Commit:** `test(coverage): enforce thresholds and add tests for 8 untested modules (SR-044)`

### Coverage thresholds (initial — ratchet each sprint)
| Metric | Threshold |
|---|---|
| Lines | 60% |
| Functions | 60% |
| Branches | 55% |
| Statements | 60% |

### New test files

| File | Cases | Modules covered |
|---|---|---|
| `transfer-guard.test.ts` | 12 | `transfer-guard.ts` |
| `admin-confirmation.test.ts` | 14 | `admin-confirmation.ts` |
| `distributed-lock.test.ts` | 6 | `distributed-lock.ts` |
| `secrets-manager.test.ts` | 14 | `shared/src/secrets-manager.ts` |
| `email.test.ts` | 7 | `email.ts` |
| `ramp-webhook-handler.test.ts` | 7 | `ramp-webhook-handler.ts` |
| `ramp-event-hooks.test.ts` | 10 | `ramp-event-hooks.ts` |
| `kyc-expiry-notifier.test.ts` | 7 | `kyc-expiry-notifier.ts` |

### CI changes
- `npm run test:coverage` runs vitest with `@vitest/coverage-v8`
- Explicit threshold gate step in `backend-ci.yml` parses `coverage-summary.json`
  and emits `::error::` annotations + exits 1 if any metric misses its threshold
- Coverage artifact retained for 14 days
- PR comment via `vitest-coverage-report-action`

**Files changed:**
- `backend/vitest.config.ts` — new: coverage config with thresholds
- `backend/package.json` — `test:coverage` script, `@vitest/coverage-v8` devDep
- `.github/workflows/backend-ci.yml` — coverage enforcement step, 14-day artifact retention
- 8 new test files under `backend/src/__tests__/`

---

## Open Issues

| ID | Title | Area | Priority | Status |
|---|---|---|---|---|
| SR-045 | TBD | — | — | 📋 Backlog |
