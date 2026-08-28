# Issue 4: The real remittance-creation endpoint wasn't KYC-gated

## Problem

`createTransferGuard()` (`src/transfer-guard.ts`) enforces KYC approval, expiry, and
re-verification-pending checks. It was only applied to
`router.post('/transfer', authMiddleware, transferGuard, ...)` in
`src/routes/kyc.ts` — and that handler's entire body was
`return res.status(200).json({ success: true, message: 'Transfer allowed' })`, a no-op
stub that creates nothing.

The actual remittance-creation endpoint, `POST /api/remittance`
(`src/routes/remittance.ts`), used its own local `authMiddleware` that only checked for
a non-empty `x-user-id` header — it never imported or called `createTransferGuard` /
`transferGuard`. That handler inserts a real row into `transactions`
(`status = 'pending_user_transfer_start'`), i.e. it is the real money-movement entry
point, and was reachable by any caller with an arbitrary `x-user-id` header regardless
of that user's KYC status, expiry, or re-verification-pending state. The only KYC-gated
endpoint did nothing; the only endpoint that did something wasn't KYC-gated.

## Fix

`src/routes/remittance.ts`:

- Constructs a `KycUpsertService(pool)` the same way `routes/kyc.ts` does, and builds
  `transferGuard = createTransferGuard(kycUpsertService)`.
- Applies it to the real endpoint:
  `router.post('/remittance', authMiddleware, transferGuard, ...)`.

`transferGuard` runs after `authMiddleware` (which populates `req.user.id` from
`x-user-id`, matching the `AuthenticatedRequest` shape `transferGuard` expects) and
before the handler body, so a request from a user with expired or
re-verification-pending KYC now gets rejected with `403` and the same
`KYC_EXPIRED` / `KYC_RE_VERIFICATION_PENDING` / `KYC_NOT_APPROVED` error codes the
`/api/transfer` stub already returned, before any row is inserted into `transactions`.

## Not done (per task scope: no test/build step)

- The ticket's suggested approach also asks for an integration test asserting
  `POST /api/remittance` returns 403 for a user with expired or
  re-verification-pending KYC. That wasn't added here since this pass explicitly
  excludes writing/running tests — recommended as immediate follow-up, mirroring the
  existing `transfer-guard.test.ts` fixtures against this route instead of the stub.
- The now-redundant `/api/transfer` stub in `routes/kyc.ts` was left in place rather
  than removed, to keep this change minimal and avoid touching a second file/route
  contract as part of a security fix.

## Files changed

- `backend/src/routes/remittance.ts`
