# Error Handling Quick Reference

## Quick Start

### Using the Error Handler

```rust
use crate::error_handler::ErrorHandler;

pub fn your_function(env: Env) -> Result<T, ContractError> {
    match operation() {
        Ok(result) => Ok(result),
        Err(error) => {
            let _response = ErrorHandler::handle_error(&env, error);
            Err(error)
        }
    }
}
```

## Error Codes Cheat Sheet

| Code | Error | Category | Severity | Retryable |
|------|-------|----------|----------|-----------|
| 1 | AlreadyInitialized | State | Low | No |
| 2 | NotInitialized | State | Medium | No |
| 3 | InvalidAmount | Validation | Low | No |
| 4 | InvalidFeeBps | Validation | Low | No |
| 5 | AgentNotRegistered | Resource | Low | No |
| 6 | RemittanceNotFound | Resource | Low | No |
| 7 | InvalidStatus | State | Low | No |
| 8 | Overflow | System | High | No |
| 9 | NoFeesToWithdraw | State | Low | No |
| 10 | InvalidAddress | Validation | Low | No |
| 11 | SettlementExpired | State | Low | No |
| 12 | DuplicateSettlement | State | Medium | No |
| 13 | ContractPaused | State | Low | Yes |
| 14 | Unauthorized | Authorization | Medium | No |
| 15 | AdminAlreadyExists | Resource | Low | No |
| 16 | AdminNotFound | Resource | Low | No |
| 17 | CannotRemoveLastAdmin | State | Low | No |
| 18 | TokenNotWhitelisted | Resource | Low | No |
| 19 | TokenAlreadyWhitelisted | Resource | Low | No |

## Error Categories

### Validation (3 errors)
```rust
InvalidAmount, InvalidFeeBps, InvalidAddress
```

### Authorization (1 error)
```rust
Unauthorized
```

### State (8 errors)
```rust
AlreadyInitialized, NotInitialized, InvalidStatus,
SettlementExpired, DuplicateSettlement, ContractPaused,
NoFeesToWithdraw, CannotRemoveLastAdmin
```

### Resource (6 errors)
```rust
AgentNotRegistered, RemittanceNotFound, AdminNotFound,
AdminAlreadyExists, TokenNotWhitelisted, TokenAlreadyWhitelisted
```

### System (1 error)
```rust
Overflow
```

## Common Patterns

### Pattern 1: Basic Error Handling
```rust
if invalid_condition {
    let error = ContractError::InvalidAmount;
    let _response = ErrorHandler::handle_error(&env, error);
    return Err(error);
}
```

### Pattern 2: Get Error Info
```rust
let category = ErrorHandler::get_error_category(error);
let severity = ErrorHandler::get_error_severity(error);
let message = ErrorHandler::get_user_message(&env, error);
let code = ErrorHandler::get_error_code(error);
```

### Pattern 3: Check Retry
```rust
if ErrorHandler::is_retryable(error) {
    // Retry logic
} else {
    // Permanent failure
}
```

### Pattern 4: Handle by Category
```rust
match ErrorHandler::get_error_category(error) {
    ErrorCategory::Validation => { /* user input error */ }
    ErrorCategory::Authorization => { /* permission denied */ }
    ErrorCategory::State => { /* invalid state */ }
    ErrorCategory::Resource => { /* not found */ }
    ErrorCategory::System => { /* critical error */ }
}
```

### Pattern 5: Handle by Severity
```rust
match ErrorHandler::get_error_severity(error) {
    ErrorSeverity::Low => { /* log and continue */ }
    ErrorSeverity::Medium => { /* investigate */ }
    ErrorSeverity::High => { /* alert immediately */ }
}
```

## Error Messages

### Validation Errors
```
Code 3:  "Amount must be greater than zero"
Code 4:  "Fee must be between 0 and 10000 basis points"
Code 10: "Invalid address format"
```

### Authorization Errors
```
Code 14: "Unauthorized: admin access required"
```

### State Errors
```
Code 1:  "Contract already initialized"
Code 2:  "Contract not initialized"
Code 7:  "Invalid remittance status for this operation"
Code 9:  "No fees available to withdraw"
Code 11: "Settlement window has expired"
Code 12: "Settlement already executed"
Code 13: "Contract is paused"
Code 17: "Cannot remove the last admin"
```

### Resource Errors
```
Code 5:  "Agent is not registered"
Code 6:  "Remittance not found"
Code 15: "Admin already exists"
Code 16: "Admin not found"
Code 18: "Token is not whitelisted"
Code 19: "Token is already whitelisted"
```

### System Errors
```
Code 8: "Arithmetic overflow occurred"
```

## Client Integration

### JavaScript/TypeScript
```javascript
try {
    const result = await contract.operation({...});
} catch (error) {
    const code = error.code;
    
    // Handle by code
    switch(code) {
        case 3:  showError("Invalid amount"); break;
        case 5:  showError("Agent not registered"); break;
        case 13: showError("Service paused"); break;
        case 14: showError("Permission denied"); break;
        default: showError("An error occurred");
    }
    
    // Or handle by category
    if (isValidationError(code)) {
        // Show form validation error
    } else if (isAuthError(code)) {
        // Redirect to login
    }
}

function isValidationError(code) {
    return [3, 4, 10].includes(code);
}

function isAuthError(code) {
    return code === 14;
}
```

### Python
```python
try:
    result = contract.operation(...)
except ContractError as e:
    code = e.code
    
    if code == 3:
        print("Invalid amount")
    elif code == 5:
        print("Agent not registered")
    elif code == 13:
        print("Service paused")
    elif code == 14:
        print("Permission denied")
    else:
        print("An error occurred")
```

## Testing

### Test Error Handling
```rust
#[test]
fn test_error_handling() {
    let env = Env::default();
    let error = ContractError::InvalidAmount;
    
    let response = ErrorHandler::handle_error(&env, error);
    
    assert_eq!(response.code, 3);
    assert_eq!(response.category, ErrorCategory::Validation);
    assert_eq!(response.severity, ErrorSeverity::Low);
}
```

### Test Error in Contract
```rust
#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_invalid_amount() {
    let contract = create_contract();
    contract.create_remittance(&sender, &agent, &0, &None);
}
```

## Monitoring

### Alert Rules
```
IF error.code == 8 THEN alert("Critical: Overflow error")
IF error.code == 14 AND rate > 10/min THEN alert("Security: High auth failures")
IF error.severity == High THEN alert("Critical error occurred")
```

### Metrics to Track
```
- Error rate by code
- Error rate by category
- Error rate by severity
- Retry success rate
- Error distribution over time
```

## Best Practices

### ✅ DO
```rust
// DO: Use error handler
let _response = ErrorHandler::handle_error(&env, error);

// DO: Check error category
let category = ErrorHandler::get_error_category(error);

// DO: Return clean errors
return Err(error);

// DO: Check if retryable
if ErrorHandler::is_retryable(error) { retry(); }
```

### ❌ DON'T
```rust
// DON'T: Skip error handler
return Err(error); // Without processing

// DON'T: Expose internal details
return Err(format!("Error at line {}", line));

// DON'T: Log sensitive data
log(&format!("User {} error", address));

// DON'T: Panic in production
panic!("Error: {}", error);
```

## Debugging

### Check Error Details
```rust
// Get all error information
let code = ErrorHandler::get_error_code(error);
let category = ErrorHandler::get_error_category(error);
let severity = ErrorHandler::get_error_severity(error);
let message = ErrorHandler::get_user_message(&env, error);
let retryable = ErrorHandler::is_retryable(error);

println!("Error {}: {} ({:?}, {:?}, retryable: {})",
    code, message, category, severity, retryable);
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Code 3 | Amount ≤ 0 | Use positive amount |
| Code 4 | Fee > 10000 | Use 0-10000 range |
| Code 5 | Agent not added | Register agent first |
| Code 6 | Wrong ID | Check remittance_id |
| Code 7 | Already processed | Check status |
| Code 8 | Math overflow | Check calculation |
| Code 13 | Contract paused | Wait for unpause |
| Code 14 | Not admin | Use admin account |

## API Reference

### ErrorHandler Functions

```rust
// Main handler
handle_error(env: &Env, error: ContractError) -> ErrorResponse

// Helper functions
get_error_category(error: ContractError) -> ErrorCategory
get_error_severity(error: ContractError) -> ErrorSeverity
is_retryable(error: ContractError) -> bool
get_user_message(env: &Env, error: ContractError) -> SorobanString
get_error_code(error: ContractError) -> u32
```

### ErrorResponse Fields

```rust
pub struct ErrorResponse {
    pub code: u32,              // 1-19
    pub message: SorobanString, // User-friendly
    pub category: ErrorCategory, // Classification
    pub severity: ErrorSeverity, // Priority
}
```

### ErrorCategory Values

```rust
Validation    // Input validation
Authorization // Permission denied
State         // Invalid state
Resource      // Not found/exists
System        // Internal error
```

### ErrorSeverity Values

```rust
Low    // Expected user errors
Medium // Unexpected but recoverable
High   // Critical system errors
```

## Summary

- **19 unique error codes** (1-19)
- **5 error categories** (Validation, Authorization, State, Resource, System)
- **3 severity levels** (Low, Medium, High)
- **1 retryable error** (ContractPaused)
- **Single global handler** (ErrorHandler)
- **Structured responses** (ErrorResponse)
- **No information leakage** (Clean messages only)

For complete documentation, see [ERROR_HANDLING.md](ERROR_HANDLING.md)
