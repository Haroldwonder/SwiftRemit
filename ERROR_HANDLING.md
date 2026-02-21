# Centralized Error Handling System

## Overview

The SwiftRemit contract implements a centralized error handling system that provides:
- Single global error handler for all contract operations
- Structured error responses with consistent formatting
- Error categorization and severity levels
- Prevention of stack traces and sensitive information leakage
- User-friendly error messages

## Architecture

### Error Flow

```
Contract Operation
    ↓
Error Occurs
    ↓
ErrorHandler.handle_error()
    ↓
Map Error → Structured Response
    ↓
Log (Debug Only)
    ↓
Return Clean Error to Client
```

### Components

1. **ErrorHandler** - Single global error handler
2. **ErrorResponse** - Structured error response format
3. **ErrorCategory** - Error classification system
4. **ErrorSeverity** - Error severity levels
5. **Error Mapping** - Maps ContractError to user-friendly messages

## Error Handler

### Single Global Handler

```rust
use crate::error_handler::ErrorHandler;

pub fn operation(env: Env, param: Type) -> Result<T, ContractError> {
    match validate_and_execute(&env, param) {
        Ok(result) => Ok(result),
        Err(error) => {
            // Single point of error handling
            let response = ErrorHandler::handle_error(&env, error);
            // Error is logged (debug only) and formatted
            Err(error)
        }
    }
}
```

### Error Response Structure

```rust
pub struct ErrorResponse {
    pub code: u32,              // Error code (1-19)
    pub message: SorobanString, // User-friendly message
    pub category: ErrorCategory, // Error classification
    pub severity: ErrorSeverity, // Severity level
}
```

## Error Categories

Errors are grouped into 5 categories:

### 1. Validation Errors
User input validation failures:
- `InvalidAmount` (code 3)
- `InvalidFeeBps` (code 4)
- `InvalidAddress` (code 10)

### 2. Authorization Errors
Permission and access control failures:
- `Unauthorized` (code 14)

### 3. State Errors
Invalid state for requested operation:
- `AlreadyInitialized` (code 1)
- `NotInitialized` (code 2)
- `InvalidStatus` (code 7)
- `SettlementExpired` (code 11)
- `DuplicateSettlement` (code 12)
- `ContractPaused` (code 13)
- `NoFeesToWithdraw` (code 9)
- `CannotRemoveLastAdmin` (code 17)

### 4. Resource Errors
Resource not found or already exists:
- `AgentNotRegistered` (code 5)
- `RemittanceNotFound` (code 6)
- `AdminNotFound` (code 16)
- `AdminAlreadyExists` (code 15)
- `TokenNotWhitelisted` (code 18)
- `TokenAlreadyWhitelisted` (code 19)

### 5. System Errors
Internal system errors:
- `Overflow` (code 8)

## Error Severity Levels

### Low Severity
Expected user errors, validation failures:
- All validation errors
- Resource not found errors
- State errors (paused, expired, etc.)

**Action**: Return error to user, no alert needed

### Medium Severity
Unexpected but recoverable errors:
- `NotInitialized`
- `DuplicateSettlement`
- `Unauthorized`

**Action**: Log for investigation, monitor frequency

### High Severity
Critical system errors requiring immediate attention:
- `Overflow`

**Action**: Alert operations team, investigate immediately

## Error Mapping

### Complete Error Map

| Code | Error | Message | Category | Severity |
|------|-------|---------|----------|----------|
| 1 | AlreadyInitialized | Contract already initialized | State | Low |
| 2 | NotInitialized | Contract not initialized | State | Medium |
| 3 | InvalidAmount | Amount must be greater than zero | Validation | Low |
| 4 | InvalidFeeBps | Fee must be between 0 and 10000 basis points | Validation | Low |
| 5 | AgentNotRegistered | Agent is not registered | Resource | Low |
| 6 | RemittanceNotFound | Remittance not found | Resource | Low |
| 7 | InvalidStatus | Invalid remittance status for this operation | State | Low |
| 8 | Overflow | Arithmetic overflow occurred | System | High |
| 9 | NoFeesToWithdraw | No fees available to withdraw | State | Low |
| 10 | InvalidAddress | Invalid address format | Validation | Low |
| 11 | SettlementExpired | Settlement window has expired | State | Low |
| 12 | DuplicateSettlement | Settlement already executed | State | Medium |
| 13 | ContractPaused | Contract is paused | State | Low |
| 14 | Unauthorized | Unauthorized: admin access required | Authorization | Medium |
| 15 | AdminAlreadyExists | Admin already exists | Resource | Low |
| 16 | AdminNotFound | Admin not found | Resource | Low |
| 17 | CannotRemoveLastAdmin | Cannot remove the last admin | State | Low |
| 18 | TokenNotWhitelisted | Token is not whitelisted | Resource | Low |
| 19 | TokenAlreadyWhitelisted | Token is already whitelisted | Resource | Low |

## Usage Examples

### Basic Error Handling

```rust
use crate::error_handler::ErrorHandler;

pub fn create_remittance(env: Env, amount: i128) -> Result<u64, ContractError> {
    // Validation
    if amount <= 0 {
        let error = ContractError::InvalidAmount;
        let _response = ErrorHandler::handle_error(&env, error);
        return Err(error);
    }
    
    // Business logic
    Ok(remittance_id)
}
```

### Using the Macro

```rust
use crate::handle_contract_error;

pub fn operation(env: Env) -> Result<T, ContractError> {
    let result = risky_operation();
    handle_contract_error!(&env, result)
}
```

### Getting Error Information

```rust
use crate::error_handler::ErrorHandler;

// Get error category
let category = ErrorHandler::get_error_category(error);

// Get error severity
let severity = ErrorHandler::get_error_severity(error);

// Check if retryable
let can_retry = ErrorHandler::is_retryable(error);

// Get user message
let message = ErrorHandler::get_user_message(&env, error);

// Get error code
let code = ErrorHandler::get_error_code(error);
```

## Security Features

### 1. No Stack Traces
Error messages never include stack traces or internal implementation details:

```rust
// ❌ BAD: Exposes internal details
"Error at line 42 in lib.rs: amount validation failed"

// ✅ GOOD: Clean user message
"Amount must be greater than zero"
```

### 2. No Sensitive Information
Error messages don't leak sensitive data:

```rust
// ❌ BAD: Exposes internal state
"Admin address GCXYZ... not found in storage key 0x1234"

// ✅ GOOD: Generic message
"Admin not found"
```

### 3. Debug-Only Logging
Detailed error logs only available in debug builds:

```rust
#[cfg(any(test, feature = "testutils"))]
{
    // Detailed logging for debugging
    log_error(env, &format!("[HIGH] Error: {:?}", error));
}

#[cfg(not(any(test, feature = "testutils")))]
{
    // No logging in production
}
```

## Error Handling Best Practices

### ✅ DO

```rust
// DO: Use centralized error handler
let response = ErrorHandler::handle_error(&env, error);

// DO: Return clean errors to clients
return Err(error); // Error already processed by handler

// DO: Check error category for handling
match ErrorHandler::get_error_category(error) {
    ErrorCategory::Validation => { /* handle validation */ }
    ErrorCategory::Authorization => { /* handle auth */ }
    _ => {}
}

// DO: Use severity for monitoring
if ErrorHandler::get_error_severity(error) == ErrorSeverity::High {
    // Alert operations team
}
```

### ❌ DON'T

```rust
// DON'T: Expose internal errors
return Err(format!("Internal error: {:?}", error));

// DON'T: Include stack traces
panic!("Error occurred: {}", error); // Never panic in production

// DON'T: Log sensitive data
log(&format!("User {} failed: {}", user_address, error));

// DON'T: Return different error types
return Err("Some string error"); // Use ContractError only
```

## Retry Logic

Some errors are transient and can be retried:

```rust
use crate::error_handler::ErrorHandler;

pub fn operation_with_retry(env: &Env) -> Result<T, ContractError> {
    match operation(env) {
        Ok(result) => Ok(result),
        Err(error) => {
            if ErrorHandler::is_retryable(error) {
                // Retry logic
                operation(env)
            } else {
                Err(error)
            }
        }
    }
}
```

### Retryable Errors
- `ContractPaused` - Contract may be unpaused

### Non-Retryable Errors
- All validation errors (won't change on retry)
- Resource not found errors (won't appear on retry)
- Authorization errors (permissions won't change)
- System errors (indicate serious issues)

## Client Integration

### Handling Errors in Client Code

```javascript
// JavaScript/TypeScript client example
try {
    const result = await contract.createRemittance({
        sender: senderAddress,
        agent: agentAddress,
        amount: 1000
    });
} catch (error) {
    // Error code is available
    const errorCode = error.code;
    
    // Map to user-friendly message
    switch(errorCode) {
        case 3:
            showError("Please enter a valid amount");
            break;
        case 5:
            showError("Selected agent is not registered");
            break;
        case 13:
            showError("Service is temporarily paused");
            break;
        default:
            showError("An error occurred. Please try again.");
    }
}
```

### Error Response Format

Clients receive structured error information:
```json
{
    "code": 3,
    "message": "Amount must be greater than zero",
    "category": "Validation",
    "severity": "Low"
}
```

## Monitoring and Alerting

### Error Metrics

Track these metrics for monitoring:

1. **Error Rate by Category**
   - Validation errors (expected, should be low)
   - Authorization errors (monitor for attacks)
   - State errors (monitor for issues)
   - System errors (alert immediately)

2. **Error Rate by Severity**
   - Low: Normal operation
   - Medium: Investigate if increasing
   - High: Alert immediately

3. **Specific Error Tracking**
   - `Overflow` errors → Critical alert
   - `Unauthorized` errors → Security monitoring
   - `DuplicateSettlement` → Investigate cause

### Alert Rules

```
IF error.severity == High
  THEN alert operations team immediately

IF error.category == Authorization AND rate > threshold
  THEN alert security team (possible attack)

IF error.code == 8 (Overflow)
  THEN page on-call engineer
```

## Testing Error Handling

### Unit Tests

```rust
#[test]
fn test_error_handler_validation_error() {
    let env = Env::default();
    let error = ContractError::InvalidAmount;
    
    let response = ErrorHandler::handle_error(&env, error);
    
    assert_eq!(response.code, 3);
    assert_eq!(response.category, ErrorCategory::Validation);
    assert_eq!(response.severity, ErrorSeverity::Low);
}
```

### Integration Tests

```rust
#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_invalid_amount_returns_proper_error() {
    let contract = create_contract();
    contract.create_remittance(&sender, &agent, &0, &None);
}
```

## Error Handler API Reference

### Main Functions

#### `handle_error(env: &Env, error: ContractError) -> ErrorResponse`
Main error handling function. Processes error and returns structured response.

#### `get_error_category(error: ContractError) -> ErrorCategory`
Returns the category of an error.

#### `get_error_severity(error: ContractError) -> ErrorSeverity`
Returns the severity level of an error.

#### `is_retryable(error: ContractError) -> bool`
Checks if an error is transient and can be retried.

#### `get_user_message(env: &Env, error: ContractError) -> SorobanString`
Returns user-friendly error message.

#### `get_error_code(error: ContractError) -> u32`
Returns the numeric error code.

### Helper Types

#### `ErrorResponse`
```rust
pub struct ErrorResponse {
    pub code: u32,
    pub message: SorobanString,
    pub category: ErrorCategory,
    pub severity: ErrorSeverity,
}
```

#### `ErrorCategory`
```rust
pub enum ErrorCategory {
    Validation,
    Authorization,
    State,
    Resource,
    System,
}
```

#### `ErrorSeverity`
```rust
pub enum ErrorSeverity {
    Low,
    Medium,
    High,
}
```

## Migration Guide

### Before: Scattered Error Handling

```rust
pub fn operation(env: Env) -> Result<T, ContractError> {
    if invalid {
        // Direct error return, no processing
        return Err(ContractError::InvalidAmount);
    }
    // Business logic
}
```

### After: Centralized Error Handling

```rust
pub fn operation(env: Env) -> Result<T, ContractError> {
    if invalid {
        let error = ContractError::InvalidAmount;
        // Process through error handler
        let _response = ErrorHandler::handle_error(&env, error);
        return Err(error);
    }
    // Business logic
}
```

## Summary

The centralized error handling system provides:

✅ **Single Global Handler** - One place for all error processing
✅ **Structured Responses** - Consistent error format
✅ **Error Categorization** - Grouped by type for better handling
✅ **Severity Levels** - Prioritize error response
✅ **Security** - No stack traces or sensitive data leakage
✅ **User-Friendly Messages** - Clean, actionable error messages
✅ **Monitoring Support** - Error metrics and alerting
✅ **Retry Logic** - Identify transient errors
✅ **Client Integration** - Easy to handle in client code
✅ **Comprehensive Testing** - Full test coverage

For implementation details, see `src/error_handler.rs`.
