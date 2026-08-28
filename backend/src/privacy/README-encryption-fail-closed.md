# SR-131 — encryption.ts fails closed without ENCRYPTION_KEY

## Problem

`getMasterKey()` in `encryption.ts` read `process.env.ENCRYPTION_KEY` and, if
unset, silently fell back to `DEFAULT_KEY_HEX` — a literal hex constant
committed to the repository, visible to anyone who could read this source
file. There was no environment guard: this happened identically in
development, staging, and production. `encryptColumn` / `decryptColumn` /
`encryptObject` / `decryptObject` are the functions the GDPR privacy routes
use to "encrypt" PII (`full_name`, `email`, `phone_number`, `address`) before
returning it in subject-access/rectify responses. A misconfigured deploy —
a forgotten secret, a hastily-provisioned new environment — would encrypt
every one of those columns with a key that provided zero real
confidentiality, while the rest of the application and its logs continued to
treat the data as protected.

This also bypassed the shared `SecretsManager`
(`shared/src/secrets-manager.ts`), which already centralizes secret
sourcing, rotation, and a "no plaintext env fallback in production" guard for
`JWT_SECRET`, `DATABASE_URL`, and `ADMIN_SECRET_KEY`. `ENCRYPTION_KEY` had no
equivalent protection.

## What changed

- **`backend/src/privacy/encryption.ts`** — removed `DEFAULT_KEY_HEX`
  entirely. `getMasterKey()` now:
  - Returns the configured `ENCRYPTION_KEY` when set (unchanged behavior).
  - Returns a deterministic, non-configurable key **only** when
    `NODE_ENV === 'test'`, so the existing test suite doesn't need to set
    `ENCRYPTION_KEY` everywhere it exercises encryption.
  - **Throws** in every other case (`development`, `staging`, `production`,
    or any unset `NODE_ENV`), with a message telling the operator exactly
    what to set. This mirrors how `env-guard.ts` already fails startup for
    other required configuration, and how `backend/src/index.ts` fails fast
    when the secrets manager isn't configured in production.

- **`shared/src/secrets-manager.ts`** — added `getEncryptionKey()`, an
  optional secret resolved the same way as `getFxApiKey()`. Routing
  `ENCRYPTION_KEY` through `SecretsManager.getSecret()` means that if this
  secret ever *is* read from a plaintext env var while `NODE_ENV=production`,
  the existing `PRODUCTION SECURITY VIOLATION` guard in `getSecret` applies
  to it too, and it participates in the same TTL cache / rotation hooks as
  the other named secrets.

- **`backend/src/secrets-manager.ts`** — re-exports `getEncryptionKey` from
  the shared module (this file is a thin re-export shim; no logic lives
  here).

- **`backend/src/index.ts`** — `loadSecrets()` now resolves
  `getEncryptionKey()` alongside the other startup secrets and, if a value
  came back, writes it to `process.env.ENCRYPTION_KEY`. This keeps
  `encryption.ts`'s synchronous API (`encryptColumn`, `decryptColumn`, etc.
  are called synchronously throughout the request path) working without an
  invasive async refactor of every call site — the same pattern already used
  for `DATABASE_URL`, `ADMIN_SECRET_KEY`, and `CONTRACT_ID` in this function.
  `getEncryptionKey()` is optional at this layer specifically because
  `encryption.ts` itself is the actual enforcement point: if no key comes
  back from the secrets manager and none is already in the environment, the
  first call to `encryptColumn`/`decryptColumn` throws.

- **`backend/src/__tests__/encryption-fail-closed.test.ts`** (new) —
  asserts:
  1. `encryptColumn` throws when `ENCRYPTION_KEY` is unset and
     `NODE_ENV=production`.
  2. `decryptColumn` throws under the same conditions (not just the encrypt
     path).
  3. A configured `ENCRYPTION_KEY` still works correctly in production
     (round-trips a value through encrypt/decrypt).

  The test reloads the module (via `require.cache` invalidation) between
  cases because `getMasterKey()`'s `NODE_ENV` check is only observed once
  per process unless the module is freshly evaluated.

## What was intentionally left out

Full end-to-end routing of `ENCRYPTION_KEY` through AWS Secrets
Manager / Vault in a live deployment was not verified against real
infrastructure — that requires credentials this change doesn't have access
to. The code path added here (`getEncryptionKey()` →
`process.env.ENCRYPTION_KEY` → `getMasterKey()`) follows the exact pattern
already used and presumably already verified for `DATABASE_URL` /
`ADMIN_SECRET_KEY` / `CONTRACT_ID` in the same function, so no new
infrastructure assumptions were introduced.
