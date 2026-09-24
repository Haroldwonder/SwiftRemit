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
| POST | `/api/auth/login` | `public` | Rate-limited; 5 failures locks the identity for 15 min; audit-logged |
| POST | `/api/auth/refresh` | `public` (cookie) | Rotates the token; reuse revokes the whole family; audit-logged |
| POST | `/api/auth/logout` | `public` | Revokes the refresh family and the presented access token; audit-logged |
| GET | `/api/remittances` | `requireAuth` + scoping | Non-admins see only rows where they are the agent |
| GET | `/api/remittances/:id/receipt` | `requireAuth` + `ownership` | Non-admins must be the remittance sender |
| POST | `/api/agents` | `adminApiKey \|\| agent/admin token` | Audit-logged |
| GET | `/api/agents/:id` | `public` | Returns only non-sensitive registration data |
| PUT | `/api/agents/:id/payout-address` | `adminApiKey \|\| agent/admin token` | Redirects money — audit-logged |
| GET | `/api/agents/:id/reputation` | `public` | Aggregated reputation score and history; no sensitive data |
| POST | `/api/agents/:id/reputation` | `adminApiKey \|\| agent/admin token` | Records a reputation event — audit-logged |
| GET | `/api/accounts/:address/stellar-fees` | `requireAuth` | Exposes per-account chain data |
| GET | `/api/analytics/corridors` | `adminApiKey` | Pre-existing; audit-logged |
| GET | `/api/analytics/timeseries` | `adminApiKey` | Pre-existing; audit-logged |
| POST | `/api/anchors/admin` | `adminApiKey` | Pre-existing; audit-logged |
| PUT | `/api/anchors/admin/:id` | `adminApiKey` | Pre-existing; audit-logged |
| POST | `/api/anchors/admin/:id/deactivate` | `adminApiKey` | Pre-existing; audit-logged |
| DELETE | `/api/anchors/admin/:id` | `adminApiKey` | Pre-existing; audit-logged |
| GET | `/api/anchors` | `public` | Public anchor directory |
| GET | `/api/currencies` | `public` | Static reference data |
| GET | `/api/limits` | `public` | Static reference data |
| POST | `/api/settlements/simulate` | `public` | Read-only simulation, no state change |
| POST | `/api/graphql` | `requireAuth` + field-level | See "GraphQL" below |
| GET | `/api/graphql` | `public` | Endpoint metadata only; no data |
| GET | `/api/docs` | `public` | API documentation |

## Audit logging

Per the security checklist in `SETUP_GUIDE.md`, every admin and
security-sensitive operation emits a structured audit record. Records are
written by `services/auditLog.ts` and carry:

| Field | Meaning |
|---|---|
| `actor` | `token.sub` for token auth, or `api-key:<id>` for `adminApiKey` |
| `action` | Stable verb, e.g. `auth.login`, `agent.payout_address.update`, `anchor.deactivate` |
| `target` | Resource identifier the action applied to, when applicable |
| `timestamp` | ISO-8601 UTC, server clock |
| `outcome` | `success` or `failure` (with a reason code) |

Audit records are append-only and never include secrets, tokens, or password
material. The routes marked "audit-logged" above are the ones that must emit a
record; `src/__tests__/audit-log.test.ts` asserts each one does.

## Agent reputation

The agent reputation system (roadmap item #1570) exposes a per-agent score
derived from append-only reputation events. It follows the same authorisation
and audit rules as the rest of the agent surface:

- `GET /api/agents/:id/reputation` is `public` and returns only the aggregate
  score, event count, and non-sensitive event history — never payout addresses,
  credentials, or other private registration data.
- `POST /api/agents/:id/reputation` records a new event and is restricted to
  `adminApiKey` or an `agent`/`admin` token, matching the other agent-mutating
  routes. Every write is audit-logged with action `agent.reputation.record`.
- Reputation events are append-only; the score is recomputed from the event log
  rather than mutated in place, so history cannot be silently rewritten.

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
