# Requirements Document

## Introduction

This document specifies the requirements for implementing idempotency protection for transfer requests in the SwiftRemit remittance system. Idempotency protection ensures that duplicate transfer requests (with the same idempotency key) are not executed multiple times, preventing accidental duplicate transfers while allowing safe retries of failed requests.

The implementation focuses exclusively on transfer request handling (create_remittance function) and does not modify unrelated system logic or files outside the scope of transfer handling and supporting storage.

## Glossary

- **Idempotency_Key**: A unique client-provided identifier passed in the request header to identify logically identical requests
- **Request_Hash**: A deterministic cryptographic hash computed from the request payload (sender, agent, amount, expiry) to detect payload changes
- **Idempotency_Record**: A stored record containing the idempotency key, request hash, response data, and expiration timestamp
- **Transfer_Request**: A call to create_remittance that initiates a new remittance transaction
- **TTL**: Time-to-live duration after which an idempotency record expires and is automatically invalidated
- **System**: The SwiftRemit contract
- **Client**: The external caller making transfer requests

## Requirements

### Requirement 1: Idempotency Key Acceptance

**User Story:** As a client, I want to provide an idempotency key with my transfer request, so that I can safely retry failed requests without creating duplicate transfers.

#### Acceptance Criteria

1. WHEN a transfer request includes an Idempotency-Key header, THE System SHALL accept and process the idempotency key
2. WHEN a transfer request does not include an Idempotency-Key header, THE System SHALL process the transfer normally without idempotency protection
3. THE System SHALL support idempotency keys of reasonable length (up to 255 characters)
4. THE System SHALL accept alphanumeric characters, hyphens, and underscores in idempotency keys

### Requirement 2: Request Hash Generation

**User Story:** As a developer, I want the system to generate a deterministic hash from the request payload, so that payload changes can be detected even when using the same idempotency key.

#### Acceptance Criteria

1. WHEN processing a transfer request with an idempotency key, THE System SHALL compute a deterministic request hash from the payload
2. THE Request_Hash SHALL be computed from sender address, agent address, amount, and expiry fields
3. FOR ALL identical request payloads, THE System SHALL generate identical request hashes
4. FOR ALL different request payloads, THE System SHALL generate different request hashes with high probability
5. THE System SHALL use a cryptographic hash function (SHA-256) for request hash computation

### Requirement 3: Idempotency Record Storage

**User Story:** As a system operator, I want successful transfer responses to be stored with their idempotency keys, so that duplicate requests can return the original response.

#### Acceptance Criteria

1. WHEN a transfer request with an idempotency key completes successfully, THE System SHALL store an idempotency record
2. THE Idempotency_Record SHALL contain the idempotency key, request hash, response data (remittance_id), and expiration timestamp
3. THE System SHALL store idempotency records in persistent storage
4. WHEN a transfer request with an idempotency key fails, THE System SHALL NOT store an idempotency record

### Requirement 4: Duplicate Request Detection

**User Story:** As a client, I want duplicate requests with the same idempotency key to return the original response, so that I can safely retry requests without side effects.

#### Acceptance Criteria

1. WHEN a transfer request includes an idempotency key that already exists, THE System SHALL check if the request hash matches the stored hash
2. WHEN the idempotency key exists and the request hash matches, THE System SHALL return the previously stored response without executing the transfer
3. WHEN the idempotency key exists and the request hash matches, THE System SHALL NOT create a new remittance
4. WHEN the idempotency key exists and the request hash matches, THE System SHALL NOT transfer tokens
5. WHEN the idempotency key exists and the request hash matches, THE System SHALL NOT increment the remittance counter

### Requirement 5: Idempotency Conflict Detection

**User Story:** As a developer, I want requests with the same idempotency key but different payloads to be rejected, so that I can detect client-side errors or misuse of idempotency keys.

#### Acceptance Criteria

1. WHEN a transfer request includes an idempotency key that already exists, THE System SHALL compare the request hash with the stored hash
2. WHEN the idempotency key exists but the request hash differs, THE System SHALL reject the request with an IdempotencyConflict error
3. WHEN an idempotency conflict occurs, THE System SHALL NOT execute the transfer
4. WHEN an idempotency conflict occurs, THE System SHALL include both the expected hash and actual hash in the error response

### Requirement 6: Idempotency Record Expiration

**User Story:** As a system operator, I want idempotency records to expire after a configurable TTL, so that storage usage remains efficient and old keys can be reused.

#### Acceptance Criteria

1. THE System SHALL support a configurable TTL for idempotency records
2. WHEN storing an idempotency record, THE System SHALL calculate and store an expiration timestamp based on the current time plus TTL
3. WHEN checking for duplicate requests, THE System SHALL verify if the idempotency record has expired
4. WHEN an idempotency record has expired, THE System SHALL treat the request as new and allow execution
5. WHEN an idempotency record has expired, THE System SHALL overwrite the expired record with the new request data
6. THE System SHALL use a default TTL of 24 hours if not explicitly configured

### Requirement 7: Backward Compatibility

**User Story:** As a system operator, I want existing transfer behavior to remain unchanged for requests without idempotency keys, so that current clients continue to work without modification.

#### Acceptance Criteria

1. WHEN a transfer request does not include an idempotency key, THE System SHALL process the request using the existing create_remittance logic
2. WHEN a transfer request does not include an idempotency key, THE System SHALL NOT perform idempotency checks
3. WHEN a transfer request does not include an idempotency key, THE System SHALL NOT store idempotency records
4. THE System SHALL maintain all existing validation, error handling, and event emission for non-idempotent requests

### Requirement 8: Minimal Scope

**User Story:** As a developer, I want the implementation to modify only transfer-related code, so that the risk of introducing bugs in unrelated functionality is minimized.

#### Acceptance Criteria

1. THE System SHALL implement idempotency protection only for the create_remittance function
2. THE System SHALL NOT modify confirm_payout, cancel_remittance, or other non-transfer functions
3. THE System SHALL add idempotency storage functions without modifying existing storage functions
4. THE System SHALL add new error types without modifying existing error definitions
