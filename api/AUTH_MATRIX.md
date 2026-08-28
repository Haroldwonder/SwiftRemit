# API authorisation matrix

Every HTTP route and the guard it requires. SR-048 requires this file to be
committed and every route to match it; `src/__tests__/auth-matrix.test.ts`
enumerates the routes and asserts each guard, so drift fails the build.

## Roles

| Role | Source | Meaning |
|---|---|---|
| `user` | default for any authenticated identity | Can read only their own data |
| `agent` | `AGENT_USER_IDS` env allowlist | Can register agents and change payout addresses |
| `admin` | `ADMIN_USER_IDS` env allowlist | Unrestricted across the matrix |

Roles come from the signed access token's `role` claim. They are never read from
a request header or body — a claim the client controls is not an authorisation
decision. `admin` does **not** implicitly satisfy an `agent`-only guard; routes
list every role they accept.

## Guard types

| Guard | Enforcement |
|---|---|
| `public` | No authentication |
| `requireAuth` | Valid access token; any role |
| `requireAgentOrAdmin` | Valid token with role `agent` or `admin` |
| `requireAdmin` | Valid token with role `admin`; a user or agent token is rejected with 403 |
| `adminApiKey` | Shared `x-api-key` secret, compared with `timingSafeEqual` |
| `adminApiKey \|\| agent/admin token` | Either path is accepted |
| `ownership` | Guard above, plus the resource owner must match `token.sub` |

## Matrix

| Method | Route | Guard | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | `public` | Rate-limited; 5 failures locks the identity for 15 min |
| POST | `/api/auth/refresh` | `public` (cookie) | Rotates the token; reuse revokes the whole family |
| POST | `/api/auth/logout` | `public` | Revokes the refresh family and the presented access token |
| GET | `/api/remittances` | `requireAuth` + scoping | Non-admins see only rows where they are the agent |
| GET | `/api/remittances/:id/receipt` | `requireAuth` + `ownership` | Non-admins must be the remittance sender |
| POST | `/api/agents` | `adminApiKey \|\| agent/admin token` | Audit-logged |
| GET | `/api/agents/:id` | `public` | Returns only non-sensitive registration data |
| PUT | `/api/agents/:id/payout-address` | `adminApiKey \|\| agent/admin token` | Redirects money — audit-logged |
| GET | `/api/accounts/:address/stellar-fees` | `requireAuth` | Exposes per-account chain data |
| GET | `/api/analytics/corridors` | `adminApiKey` | Pre-existing |
| GET | `/api/analytics/timeseries` | `adminApiKey` | Pre-existing |
| POST | `/api/anchors/admin` | `adminApiKey` | Pre-existing |
| PUT | `/api/anchors/admin/:id` | `adminApiKey` | Pre-existing |
| POST | `/api/anchors/admin/:id/deactivate` | `adminApiKey` | Pre-existing |
| DELETE | `/api/anchors/admin/:id` | `adminApiKey` | Pre-existing |
| GET | `/api/anchors` | `public` | Public anchor directory |
| GET | `/api/currencies` | `public` | Static reference data |
| GET | `/api/limits` | `public` | Static reference data |
| POST | `/api/settlements/simulate` | `public` | Read-only simulation, no state change |
| POST | `/api/graphql` | `requireAuth` + field-level | See "GraphQL" below |
| GET | `/api/graphql` | `public` | Endpoint metadata only; no data |
| GET | `/api/docs` | `public` | API documentation |

## GraphQL

A single HTTP guard is not sufficient for GraphQL, because one authorised
request can still select fields the caller is not entitled to. Enforcement is
layered:

1. `requireAuth` on the transport — no anonymous queries.
2. Field-level authorisation during execution. An unauthorised field resolves to
   `null` and adds an error entry; it never returns data.
3. Depth and complexity budgets, rejected **before** execution begins.
4. Introspection disabled when `NODE_ENV=production`.

## Known limitations

- ~~**Token state is per-process.**~~ Resolved: `services/tokenStore.ts` now
  keeps its fast in-memory Maps as an L1 cache but writes through to Redis
  (when `REDIS_URL` is set) and fans out every mutation over a
  `sr:tokenstore:events` pub/sub channel that all instances subscribe to.
  Revocation and lockout recorded on one instance now apply on every instance
  within one pub/sub round trip. `REDIS_URL` unset (local dev, unit tests)
  falls back to the original single-process behaviour.
- ~~**Credential verification is still stubbed.**~~ Resolved: `db/userStore.ts`
  backs `verifyCredentials()` with a real per-user bcrypt password hash (a
  `users` table when `DATABASE_URL` is configured, an in-memory map
  otherwise), so a valid password for one identity can no longer be used to
  authenticate as a different one.
- ~~**Role assignment is env-driven.**~~ Resolved: roles now live on the same
  `users` row and are read via `getUserRole()`. `ADMIN_USER_IDS` /
  `AGENT_USER_IDS` are consulted only once, to seed the first operator
  accounts (`seedBootstrapOperatorsOnce` in `db/userStore.ts`) — they are no
  longer read on every login and never overwrite an existing row.
