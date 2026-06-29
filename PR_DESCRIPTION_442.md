# feat: Add ARIA live region for transaction status updates #442

## Description
This PR adds accessibility improvements to the TransactionStatusTracker component to ensure screen reader users are properly notified of transaction status changes.

## Changes Made
- Added `aria-live="polite"` region for status change announcements
- Added `role="status"` to the active transaction step
- Implemented status change detection and announcement logic
- Added screen reader only CSS class for the live region
- Updated tests to verify ARIA attributes and announcements

## Technical Details
- Status changes are announced with the format: "Transaction status changed to [Status]"
- Announcements only occur when status actually changes (not on initial render)
- The active step has `role="status"` for additional context
- Live region uses `aria-atomic="true"` to announce the entire message

## Testing
- Added tests for aria-live region presence
- Added tests for role="status" on active steps
- Added tests for status change announcements
- Verified no duplicate announcements on re-render

## Acceptance Criteria Met
- ✅ Status changes announced to screen readers
- ✅ aria-live region present
- ✅ role="status" added to status badge (active step)
- ✅ No duplicate announcements on re-render
- ✅ Tested with automated tests (manual testing with VoiceOver/NVDA recommended for full validation)

## Files Modified
- `frontend/src/components/TransactionStatusTracker.tsx`
- `frontend/src/components/TransactionStatusTracker.css`
- `frontend/src/components/__tests__/TransactionStatusTracker.test.tsx`