# Fix: wildcard CORS on backend/src/api.ts and api/src/app.ts

## Problem

Both `backend/src/api.ts:115` and `api/src/app.ts:128` called `app.use(cors())`
with no options. The `cors` npm package defaults to `origin: '*'` when no
`origin` option is supplied, so both services accepted cross-origin requests
from any website by default — combined with routes that carry no auth guard,
any third-party site's client-side JavaScript could call these APIs directly
from a visitor's browser. `docs/THREAT_MODEL.md` (T-06, TB-02) flagged the
adjacent CSRF/SameSite gap but not this wildcard CORS configuration.

## What was implemented

1. **`shared/src/cors-options.ts`** — new shared module (same relative-import
   pattern as `shared/src/logger.ts`) exporting:
   - `parseAllowedOrigins(raw)` — parses a comma-separated origin list.
   - `buildCorsOptions(allowedOrigins)` — returns `cors.CorsOptions` with an
     origin-allowlist check function. No `Origin` header (server-to-server
     calls) is allowed through; an allowlisted origin is reflected back with
     `credentials: true`; anything else is rejected (no
     `Access-Control-Allow-Origin` header is sent, so the browser blocks the
     response). An empty allowlist fails closed.
   - `corsOptionsFromEnv()` — builds options from `process.env.ALLOWED_ORIGINS`.

2. **`backend/src/api.ts`** and **`api/src/app.ts`** — both now call
   `app.use(cors(corsOptionsFromEnv()))` instead of `app.use(cors())`.

3. **`.env.example`** (both `backend/` and `api/`) — documents the new
   `ALLOWED_ORIGINS` env var (comma-separated exact origins).

4. **`api/src/__tests__/cors.test.ts`** — regression test asserting:
   - an unlisted origin gets no `Access-Control-Allow-Origin` header;
   - an allowlisted origin gets it reflected back plus
     `Access-Control-Allow-Credentials: true` (needed for the
     `/api/auth/refresh` cookie flow — `api/AUTH_MATRIX.md`);
   - a CORS preflight (`OPTIONS`) from an unlisted origin also gets no
     allow-origin header.

## Notes

- `credentials: true` is scoped by the same allowlist check — it's not
  turned on globally, only for origins already permitted to receive a
  response at all.
- Diff across the six changed files is 145 lines (under the 150-line
  threshold), hence this README.
