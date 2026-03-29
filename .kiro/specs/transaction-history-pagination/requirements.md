# Requirements Document

## Description
Add pagination support to transaction history queries.

## Acceptance Criteria

1. Accept page and limit parameters
2. Return metadata: `{ "page": 1, "total_pages": X, "total_records": X }`
3. Prevent large unbounded queries
