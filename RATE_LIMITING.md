# Rate Limiting Implementation

## Overview

SwiftRemit now includes configurable rate limiting to protect endpoints from abuse. The rate limiting system tracks requests per address within configurable time windows.

## Features

- **Per-Address Tracking**: Each address has its own rate limit counter
- **Configurable Thresholds**: Admins can adjust max requests and time windows
- **Enable/Disable Toggle**: Rate limiting can be turned on or off
- **Automatic Window Reset**: Counters reset after the time window expires
- **429 Error Response**: Returns `RateLimitExceeded` error when limits are exceeded

## Configuration

### Default Settings

When the contract is initialized, rate limiting is enabled with these defaults:
- **Max Requests**: 100 requests
- **Time Window**: 60 seconds
- **Enabled**: true

### Admin Functions

#### Update Rate Limit Configuration

```rust
pub fn update_rate_limit(
    env: Env,
    caller: Address,
    max_requests: u32,
    window_seconds: u64,
    enabled: bool,
) -> Result<(), ContractError>
```

**Parameters:**
- `caller`: Admin address (must be authorized)
- `max_requests`: Maximum number of requests allowed per window
- `window_seconds`: Time window in seconds
- `enabled`: Whether rate limiting is enabled

**Example:**
```rust
// Set rate limit to 50 requests per 30 seconds
contract.update_rate_limit(&admin, 50, 30, true)?;

// Disable rate limiting
contract.update_rate_limit(&admin, 100, 60, false)?;
```

#### Get Rate Limit Configuration

```rust
pub fn get_rate_limit_config(env: Env) -> (u32, u64, bool)
```

**Returns:** Tuple of (max_requests, window_seconds, enabled)

**Example:**
```rust
let (max_requests, window_seconds, enabled) = contract.get_rate_limit_config();
```

#### Get Rate Limit Status for Address

```rust
pub fn get_rate_limit_status(env: Env, address: Address) -> (u32, u32, u64)
```

**Returns:** Tuple of (current_requests, max_requests, window_seconds)

**Example:**
```rust
let (current, max, window) = contract.get_rate_limit_status(&user_address);
println!("Used {}/{} requests in {} second window", current, max, window);
```

## Protected Endpoints

Rate limiting is automatically applied to these user-facing functions:

1. **create_remittance**: Checked against sender's address
2. **confirm_payout**: Checked against agent's address  
3. **cancel_remittance**: Checked against sender's address

## Error Handling

When rate limit is exceeded, the contract returns:

```rust
ContractError::RateLimitExceeded = 23
```

**Error Message:**
```
Rate limit exceeded for this address.
Cause: Too many requests within the configured time window.
Action: Wait for the rate limit window to reset (default: 60 seconds).
```

## Implementation Details

### Storage

Rate limit data is stored in temporary storage with automatic TTL management:

- **Configuration**: Stored in instance storage (contract-level)
- **Per-Address Counters**: Stored in temporary storage with TTL
- **TTL**: Set to window_seconds + 3600 seconds for safety margin

### Algorithm

1. Check if rate limiting is enabled (skip if disabled)
2. Get current timestamp from ledger
3. Load or create rate limit entry for address
4. Check if current window has expired:
   - If expired: Reset counter to 1, start new window
   - If not expired: Check if at limit
     - If at limit: Return `RateLimitExceeded` error
     - If under limit: Increment counter
5. Save updated entry with TTL

### Window Reset

Rate limit windows reset automatically when:
- The time elapsed since window start exceeds `window_seconds`
- The first request after window expiry starts a new window

## Security Considerations

### Blockchain Context

Unlike traditional HTTP APIs, blockchain rate limiting has unique characteristics:

1. **Gas Costs**: Transaction fees provide natural rate limiting
2. **Per-Address**: Limits are per blockchain address, not IP
3. **Deterministic**: Uses ledger timestamp, not wall clock
4. **Storage Costs**: Temporary storage used to minimize costs

### Attack Vectors

**Sybil Attacks**: Attacker creates multiple addresses to bypass limits
- **Mitigation**: Gas costs make this expensive
- **Additional Protection**: Consider requiring minimum balance or staking

**Timestamp Manipulation**: Validators control ledger timestamp
- **Mitigation**: Stellar consensus ensures reasonable timestamps
- **Impact**: Limited to small time adjustments

**Storage Exhaustion**: Many addresses could fill temporary storage
- **Mitigation**: Temporary storage with TTL automatically cleans up
- **Cost**: Attacker pays for storage

## Best Practices

### For Administrators

1. **Monitor Usage**: Check rate limit status for active addresses
2. **Adjust Thresholds**: Tune based on legitimate usage patterns
3. **Emergency Disable**: Can disable rate limiting if needed
4. **Coordinate with Pause**: Use with contract pause for emergencies

### For Integrators

1. **Handle 429 Errors**: Implement exponential backoff
2. **Check Status**: Query rate limit status before batch operations
3. **Distribute Load**: Use multiple addresses for high-volume operations
4. **Respect Limits**: Don't attempt to circumvent rate limits

## Testing

Rate limiting includes comprehensive test coverage:

```rust
// Test basic rate limiting
#[test]
fn test_rate_limit_within_limits()

// Test limit exceeded
#[test]
fn test_rate_limit_exceeded()

// Test window reset
#[test]
fn test_rate_limit_window_reset()

// Test disable functionality
#[test]
fn test_rate_limit_disabled()

// Test per-address isolation
#[test]
fn test_rate_limit_per_address()
```

## Configuration Examples

### Conservative (High Security)
```rust
contract.update_rate_limit(&admin, 10, 60, true)?;
// 10 requests per minute
```

### Moderate (Balanced)
```rust
contract.update_rate_limit(&admin, 50, 60, true)?;
// 50 requests per minute (default-ish)
```

### Permissive (High Throughput)
```rust
contract.update_rate_limit(&admin, 200, 60, true)?;
// 200 requests per minute
```

### Burst Protection
```rust
contract.update_rate_limit(&admin, 5, 10, true)?;
// 5 requests per 10 seconds (30 per minute max)
```

## Future Enhancements

Potential improvements for future versions:

1. **Tiered Limits**: Different limits for different user tiers
2. **Burst Allowance**: Allow short bursts above sustained rate
3. **Whitelist**: Exempt certain addresses from rate limiting
4. **Dynamic Adjustment**: Auto-adjust based on network conditions
5. **Rate Limit Events**: Emit events when limits are hit for monitoring

## API Reference

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| 23 | RateLimitExceeded | Too many requests within time window |

### Storage Keys

| Key | Type | Description |
|-----|------|-------------|
| RateLimitKey::Config | Instance | Global rate limit configuration |
| RateLimitKey::Entry(Address) | Temporary | Per-address request tracking |

### Data Structures

```rust
pub struct RateLimitConfig {
    pub max_requests: u32,
    pub window_seconds: u64,
    pub enabled: bool,
}

struct RateLimitEntry {
    request_count: u32,
    window_start: u64,
}
```

## Conclusion

The rate limiting implementation provides flexible, configurable protection against abuse while maintaining the performance and cost-efficiency required for blockchain applications. Administrators have full control over thresholds and can adapt the system to their specific needs.
