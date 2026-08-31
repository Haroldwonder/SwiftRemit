# SR-140: Apply the KYC transfer guard to the real remittance-creation endpoint

**Reference:** Haroldwonder/SwiftRemit #1283 — Applied Aug 27, 2026, 11:42 PM

## Problem

`createTransferGuard()` in `backend/src/transfer-guard.ts` enforces KYC
approval, expiry, and re-verification-pending checks before allowing a
transfer. It was applied in `backend/src/routes/kyc.ts` to
`router.post('/transfer', authMiddleware, transferGuard, ...)` — but that
handler's entire body was `return res.status(200).json({ success: true,
message: 'Transfer allowed' })`, a no-op stub that creates nothing.

The actual remittance-creation endpoint, `POST /api/remittance` in
`backend/src/routes/remittance.ts`, used a different, local
`authMiddleware` that only checked for a non-empty `x-user-id` header — it
never imported or called `createTransferGuard`/`transferGuard`. That
handler inserts a real row into `transactions` with status
`pending_user_transfer_start`, i.e. it is the real money-movement entry
point, and it was reachable by any caller with an arbitrary `x-user-id`
header regardless of that user's KYC status, expiry, or
re-verification-pending state.

So the only endpoint that was KYC-gated did nothing, and the only endpoint
that did something was not KYC-gated — a compliance control that provided
no actual protection on the live transaction-creation path.

## What was implemented

- `backend/src/routes/remittance.ts` now constructs its own
  `KycUpsertService` (the same construction pattern already used in
  `routes/kyc.ts`) and builds a `transferGuard` from
  `createTransferGuard(kycUpsertService)`.
- `POST /api/remittance` is now defined as
  `router.post('/remittance', authMiddleware, transferGuard, ...)`, so
  every request must pass the KYC approval/expiry/re-verification checks
  before the handler can reach the `INSERT INTO transactions` call.
- The `/api/transfer` stub in `routes/kyc.ts` was left in place — closing
  the gap on the endpoint that actually moves money was the priority;
  removing or repurposing the stub is a separate, lower-risk follow-up.

## Files touched

- `backend/src/routes/remittance.ts`

## Result

`POST /api/remittance` now returns `403` with a `KYC_EXPIRED`,
`KYC_RE_VERIFICATION_PENDING`, `KYC_PENDING`, or `KYC_NOT_APPROVED` error
code for a caller whose KYC isn't in good standing, instead of
unconditionally creating a pending transaction for any request carrying an
`x-user-id` header.

## Suggested follow-up (not in scope of this change)

Add an integration test asserting `POST /api/remittance` returns `403` for
a user with expired or re-verification-pending KYC, and decide whether the
`/api/transfer` stub in `routes/kyc.ts` should be removed or turned into a
real endpoint now that the guard's real enforcement point is
`/api/remittance`.
