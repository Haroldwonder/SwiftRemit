# Issue #262: Input Sanitization for XSS Prevention

## Summary
Added input sanitization middleware to prevent stored XSS attacks in user-provided content, specifically the `reason` field in verification reports.

## Changes Made

### 1. Created Sanitizer Module
- **File**: [`backend/src/sanitizer.ts`](backend/src/sanitizer.ts)
- **Purpose**: XSS prevention via:
  - Stripping HTML tags (script, iframe, etc.)
  - Encoding HTML entities
  - Removing event handlers (onerror=, onclick=, etc.)

### 2. Database Schema Update
- **File**: [`backend/src/database.ts`](backend/src/database.ts)
- **Changes**:
  - Added `asset_reports` table to store individual reports with reason for audit trail
  - Added `saveAssetReport()` function to persist sanitized reasons

### 3. API Endpoint Update
- **File**: [`backend/src/api.ts`](backend/src/api.ts)
- **Endpoint**: `POST /api/verification/report`
- **Changes**:
  - Imported `sanitizeInput` from sanitizer module
  - Imported `saveAssetReport` from database
  - Added sanitization of `reason` field before storing
  - Stores sanitized reason in `asset_reports` table

### 4. Unit Tests
- **File**: [`backend/src/__tests__/sanitizer.test.ts`](backend/src/__tests__/sanitizer.test.ts)
- **Coverage**: 11 test cases covering:
  - Null/undefined handling
  - Script tag removal
  - Iframe tag removal
  - HTML entity encoding
  - Event handler removal
  - Safe content preservation

## Security Considerations

### What This Prevents
- Stored XSS attacks via `reason` field in verification reports
- Script injection through HTML tags
- Event handler exploitation (onerror, onclick, etc.)
- JavaScript URL injection

### Attack Vectors Mitigated
```
# Before (vulnerable):
POST /api/verification/report
{ "assetCode": "USDC", "issuer": "...", "reason": "<script>alert(1)</script>" }

# After (sanitized):
POST /api/verification/report
{ "assetCode": "USDC", "issuer": "...", "reason": "alert1" }
```

## Testing

```bash
# Run tests
cd backend
npm test

# Test specific module
npx vitest run sanitizer
```

## Checklist

- [x] Create sanitizer module with XSS protection
- [x] Update database schema with asset_reports table
- [x] Add saveAssetReport database function
- [x] Integrate sanitization in verification report endpoint
- [x] Add unit tests for sanitizer
- [x] Verify no TypeScript errors

## Related Issues
- Issue #260: HMAC Signature Verification for Webhooks
- Issue #261: Contract Upgrade Authorization with Timelock