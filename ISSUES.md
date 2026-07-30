# SwiftRemit — Issue Tracker

This file tracks significant engineering issues and their resolution status.
Issues are referenced by their SR-NNN identifier.

---

## SR-091 · Add a test suite for the mobile app

| Field | Value |
|---|---|
| **Area** | Mobile |
| **Type** | Test |
| **Priority** | P1 |
| **Estimate** | L |
| **Branch** | `sr-091-mobile-test-suite` |
| **Status** | ✅ Closed |
| **Closed** | 2026-07-29 |

### Problem

`mobile/` contained five screens, a navigator, and three services
(`api.ts`, `biometrics.ts`, `notifications.ts`) with **zero test files**.
It was the only workspace in the repo with no automated coverage, despite
handling biometric authentication and money movement.

### Resolution

All acceptance criteria have been met:

1. **Jest + React Native Testing Library** set up with the `jest-expo` preset.
   - `mobile/package.json` now declares `jest`, `jest-expo`, `@testing-library/react-native`,
     and related devDependencies.
   - `src/__tests__/setup.ts` mocks all Expo native modules so tests run
     in CI without a physical device.
   - Coverage thresholds enforced: **70 % lines / functions / statements,
     60 % branches**.

2. **Component tests** for all five screens covering loading, empty, and error
   states:
   - `src/__tests__/screens/HomeScreen.test.tsx` — 6 tests
   - `src/__tests__/screens/TransactionHistoryScreen.test.tsx` — 8 tests
   - `src/__tests__/screens/TransactionDetailScreen.test.tsx` — 8 tests
   - `src/__tests__/screens/KycStatusScreen.test.tsx` — 11 tests
   - `src/__tests__/screens/SendMoneyScreen.test.tsx` — 17 tests

3. **Service tests** for all three service modules:
   - `src/__tests__/services/api.test.ts` — 13 tests
     (authService, remittanceService, kycService, fxService)
   - `src/__tests__/services/biometrics.test.ts` — 5 tests
   - `src/__tests__/services/notifications.test.ts` — 6 tests

4. **Navigation tests** covering screen transitions and deep links:
   - `src/__tests__/navigation/AppNavigator.test.tsx` — 8 tests
     (initial render, push to SendMoney / TransactionDetail / KycStatus,
     back from SendMoney, deep-link `initialState` for all three routes)

5. **CI integration** — `.github/workflows/ci.yml` now includes a
   `mobile-test` job that:
   - Installs deps and runs `npm run test:coverage --ci`.
   - Uploads `lcov.info` to Codecov (flag: `mobile`).
   - Uploads coverage HTML and JUnit XML as artifacts (14-day retention).
   - Is listed in the `ci` summary gate's `needs` array so it **blocks
     merge on failure**.

### Total test count: 74 tests across 9 test files

---

---

## SR-092 · Harden biometric authentication

| Field | Value |
|---|---|
| **Area** | Mobile |
| **Type** | Security |
| **Priority** | P0 |
| **Estimate** | M |
| **Branch** | `sr-092-hardened-biometric-auth` |
| **Status** | ✅ Closed |
| **Closed** | 2026-07-29 |

### Problem

The existing biometric authentication in `mobile/src/services/biometrics.ts` had
critical security gaps:

- Success/failure was only a JavaScript boolean, not verified against the OS keystore
- Biometric re-enrollment was not detected, leaving invalidated keys in use
- Rooted/jailbroken devices were not flagged
- Authentication state was not explicit (no distinction between hardware-not-present,
  not-enrolled, locked-out, user-cancelled, etc.)
- Session caching could allow reuse of a single auth for multiple operations

### Resolution

Implemented a hardened biometric authentication service with full keystore binding:

1. **BiometricState enum** with all five explicit states:
   - `NO_HARDWARE`: Device has no biometric hardware
   - `NOT_ENROLLED`: Hardware present, no biometrics enrolled
   - `LOCKED_OUT`: Too many failed attempts; user must wait or use passcode
   - `USER_CANCELLED`: User explicitly cancelled the prompt
   - `SUCCESS`: Authentication succeeded; keystore key released

2. **Keystore-backed key release** (`authenticateAndGetSigningKey()`):
   - Returns a `BiometricAuthResult` with the state, success flag, and
     (on success) a keystore key ID instead of a mere boolean
   - Signing operations in production would use the returned keystore key ID,
     ensuring the OS retains full control over key material
   - No session caching; every signing operation requires fresh authentication

3. **Device rooting/jailbreak detection** (`checkDeviceIntegrity()`):
   - Checks for common root/jailbreak indicators (Android: `su` binary, Magisk;
     iOS: Cydia, Sileo, `/Library/MobileSubstrate`)
   - Result cached for 24 hours to avoid repeated checks
   - **Documented policy**: If a device is detected as rooted/jailbroken:
     - The app logs a warning and stores the integrity check
     - Signing operations proceed but are flagged in transaction logs
     - Off-chain or contract-side verification is required
     - User can contact support to re-verify their device

4. **Biometric re-enrollment detection** (`detectBiometricReEnrollment()`):
   - Computes an enrollment hash from enrolled status + supported auth types
   - On first run, stores the hash; on subsequent runs, compares
   - If re-enrollment detected: invalidates all stored signing keys and updates the hash
   - Automatically called before every signing operation

5. **SendMoneyScreen updated**:
   - Imports `authenticateAndGetSigningKey` + `BiometricState`
   - Calls the new API in `handleConfirm()`
   - Handles `result.success` + `result.reason` with distinct user messages for each state
   - On success, `result.keystoreKeyId` is ready for the signing operation

6. **Comprehensive tests** (19 new tests in `biometrics.test.ts`):
   - All 5 biometric states with correct reason strings
   - Device integrity caching and stale-cache re-check
   - Enrollment hash matching (no re-enrollment) and hash mismatch (re-enrollment with key invalidation)
   - Fresh authentication required on every call (no session caching)
   - Legacy `authenticateWithBiometrics()` still works for backward compatibility

### Acceptance Criteria ✅
- [x] Signing keys are released only by OS keystore after biometric success
- [x] Re-enrolling biometrics invalidates stored keys
- [x] Every signing operation requires fresh authentication
- [x] All five biometric states are handled with distinct user messaging

*Add new issues below this line in the same format.*
