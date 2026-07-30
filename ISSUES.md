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

*Add new issues below this line in the same format.*
