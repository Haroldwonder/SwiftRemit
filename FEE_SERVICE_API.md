# Fee Service API Reference

## Public Contract Methods

### Fee Calculation

#### `calculate_fee_breakdown`
Calculates complete fee breakdown for a transaction amount.

```rust
pub fn calculate_fee_breakdown(
    env: Env,
    amount: i128,
) -> Result<FeeBreakdown, ContractError>
```

**Parameters:**
- `env` - Contract environment
- `amount` - Transaction amount to calculate fees for

**Returns:**
- `FeeBreakdown` - Complete breakdown of all fees

**Example:**
```rust
let breakdown = client.calculate_fee_breakdown(&10000);
assert_eq!(breakdown.amount, 10000);
assert_eq!(breakdown.platform_fee, 250);  // 2.5%
assert_eq!(breakdown.protocol_fee, 100);  // 1%
assert_eq!(breakdown.total_fees, 350);
assert_eq!(breakdown.net_amount, 9650);
```

---

#### `calculate_fee_breakdown_with_corridor`
Calculates fees using corridor-specific configuration.

```rust
pub fn calculate_fee_breakdown_with_corridor(
    env: Env,
    amount: i128,
    corridor: FeeCorridor,
) -> Result<FeeBreakdown, ContractError>
```

**Parameters:**
- `env` - Contract environment
- `amount` - Transaction amount
- `corridor` - Corridor configuration with country codes and fee rules

**Returns:**
- `FeeBreakdown` - Breakdown using corridor-specific rates

**Example:**
```rust
let corridor = FeeCorridor {
    from_country: String::from_str(&env, "US"),
    to_country: String::from_str(&env, "MX"),
    strategy: FeeStrategy::Percentage(150),  // 1.5%
    protocol_fee_bps: Some(50),              // 0.5%
};

let breakdown = client.calculate_fee_breakdown_with_corridor(
    &10000,
    &corridor,
);
assert_eq!(breakdown.platform_fee, 150);
assert_eq!(breakdown.protocol_fee, 50);
assert_eq!(breakdown.net_amount, 9800);
```

---

### Corridor Management

#### `set_fee_corridor`
Configures fee rules for a country-to-country corridor.

```rust
pub fn set_fee_corridor(
    env: Env,
    caller: Address,
    corridor: FeeCorridor,
) -> Result<(), ContractError>
```

**Parameters:**
- `env` - Contract environment
- `caller` - Admin address (requires authentication)
- `corridor` - Corridor configuration to set

**Authorization:** Admin only

**Example:**
```rust
let corridor = FeeCorridor {
    from_country: String::from_str(&env, "US"),
    to_country: String::from_str(&env, "MX"),
    strategy: FeeStrategy::Percentage(150),
    protocol_fee_bps: Some(50),
};

client.set_fee_corridor(&admin, &corridor)?;
```

---

#### `get_fee_corridor`
Retrieves corridor configuration for a country pair.

```rust
pub fn get_fee_corridor(
    env: Env,
    from_country: String,
    to_country: String,
) -> Option<FeeCorridor>
```

**Parameters:**
- `env` - Contract environment
- `from_country` - Source country code (ISO 3166-1 alpha-2)
- `to_country` - Destination country code (ISO 3166-1 alpha-2)

**Returns:**
- `Some(FeeCorridor)` - Corridor configuration if exists
- `None` - No corridor configured for this pair

**Example:**
```rust
let corridor = client.get_fee_corridor(
    &String::from_str(&env, "US"),
    &String::from_str(&env, "MX"),
);

if let Some(corr) = corridor {
    println!("Found corridor: {} -> {}", corr.from_country, corr.to_country);
}
```

---

#### `remove_fee_corridor`
Removes corridor configuration for a country pair.

```rust
pub fn remove_fee_corridor(
    env: Env,
    caller: Address,
    from_country: String,
    to_country: String,
) -> Result<(), ContractError>
```

**Parameters:**
- `env` - Contract environment
- `caller` - Admin address (requires authentication)
- `from_country` - Source country code
- `to_country` - Destination country code

**Authorization:** Admin only

**Example:**
```rust
client.remove_fee_corridor(
    &admin,
    &String::from_str(&env, "US"),
    &String::from_str(&env, "MX"),
)?;
```

---

### Protocol Fee Management

#### `update_protocol_fee`
Updates the global protocol fee rate (Admin only).

```rust
pub fn update_protocol_fee(
    env: Env,
    caller: Address,
    fee_bps: u32,
) -> Result<(), ContractError>
```

**Parameters:**
- `env` - Contract environment
- `caller` - Admin address (requires authentication)
- `fee_bps` - New protocol fee in basis points (0-200, max 2%)

**Authorization:** Admin only

**Validation:**
- `fee_bps` must be ≤ 200 (MAX_PROTOCOL_FEE_BPS)
- Returns `ContractError::InvalidFeeBps` if out of range
- Returns `ContractError::Unauthorized` if caller is not admin

**Events:**
- Emits `fee::proto_upd` event with caller and new fee_bps

**Example:**
```rust
// Set protocol fee to 1% (100 basis points)
client.update_protocol_fee(&admin, &100)?;

// Set protocol fee to 0.5% (50 basis points)
client.update_protocol_fee(&admin, &50)?;

// Invalid: exceeds maximum (will fail)
let result = client.update_protocol_fee(&admin, &300);
assert_eq!(result, Err(ContractError::InvalidFeeBps));
```

---

#### `get_protocol_fee_bps`
Retrieves the current global protocol fee rate (Public view).

```rust
pub fn get_protocol_fee_bps(env: Env) -> u32
```

**Parameters:**
- `env` - Contract environment

**Returns:**
- `u32` - Protocol fee in basis points (0-200)

**Authorization:** None (public read-only)

**Example:**
```rust
let protocol_fee = client.get_protocol_fee_bps();
println!("Current protocol fee: {}bps ({}%)", protocol_fee, protocol_fee as f64 / 100.0);

// Use in fee calculation
let amount = 10000;
let protocol_fee_amount = amount * (protocol_fee as i128) / 10000;
```

**Notes:**
- Default value is 0 if not set during initialization
- Protocol fee is sent to treasury address during payout
- Maximum allowed value is 200 bps (2%)
- Can be overridden per-corridor using `FeeCorridor.protocol_fee_bps`

---

#### `update_treasury`
Updates the treasury address that receives protocol fees (Admin only).

```rust
pub fn update_treasury(
    env: Env,
    caller: Address,
    treasury: Address,
) -> Result<(), ContractError>
```

**Parameters:**
- `env` - Contract environment
- `caller` - Admin address (requires authentication)
- `treasury` - New treasury address

**Authorization:** Admin only

**Events:**
- Emits `admin::treasury` event with caller, old treasury, and new treasury

**Example:**
```rust
let new_treasury = Address::generate(&env);
client.update_treasury(&admin, &new_treasury)?;
```

---

#### `get_treasury`
Retrieves the current treasury address (Public view).

```rust
pub fn get_treasury(env: Env) -> Result<Address, ContractError>
```

**Parameters:**
- `env` - Contract environment

**Returns:**
- `Address` - Treasury address that receives protocol fees
- `ContractError::NotInitialized` - If contract not initialized

**Authorization:** None (public read-only)

**Example:**
```rust
let treasury = client.get_treasury()?;
println!("Protocol fees are sent to: {}", treasury);
```

---

## Data Structures

### `FeeBreakdown`

Complete breakdown of all fees for a transaction.

```rust
pub struct FeeBreakdown {
    pub amount: i128,
    pub platform_fee: i128,
    pub protocol_fee: i128,
    pub total_fees: i128,
    pub net_amount: i128,
    pub strategy_used: FeeStrategy,
    pub corridor_applied: Option<FeeCorridor>,
}
```

**Fields:**
- `amount` - Original transaction amount
- `platform_fee` - Platform fee charged
- `protocol_fee` - Protocol fee charged (sent to treasury)
- `total_fees` - Sum of platform_fee + protocol_fee
- `net_amount` - Amount after all fees (amount - total_fees)
- `strategy_used` - Fee strategy that was applied
- `corridor_applied` - Corridor configuration if used

**Validation:**
The breakdown includes a `validate()` method that ensures:
- `total_fees = platform_fee + protocol_fee`
- `net_amount = amount - total_fees`
- All amounts are non-negative

---

### `FeeCorridor`

Configuration for country-to-country fee rules.

```rust
pub struct FeeCorridor {
    pub from_country: String,
    pub to_country: String,
    pub strategy: FeeStrategy,
    pub protocol_fee_bps: Option<u32>,
}
```

**Fields:**
- `from_country` - Source country code (ISO 3166-1 alpha-2, e.g., "US")
- `to_country` - Destination country code (ISO 3166-1 alpha-2, e.g., "MX")
- `strategy` - Fee calculation strategy for this corridor
- `protocol_fee_bps` - Optional protocol fee override (if None, uses global setting)

---

### `FeeStrategy`

Fee calculation strategy enum.

```rust
pub enum FeeStrategy {
    Percentage(u32),  // Basis points (250 = 2.5%)
    Flat(i128),       // Fixed amount
    Dynamic(u32),     // Tiered based on amount
}
```

**Variants:**

1. **Percentage(bps)** - Fee as percentage of amount
   - `bps` - Basis points (1 bps = 0.01%, max 10000 = 100%)
   - Example: `Percentage(250)` = 2.5%

2. **Flat(amount)** - Fixed fee regardless of transaction size
   - `amount` - Fixed fee amount
   - Example: `Flat(100)` = 100 units

3. **Dynamic(base_bps)** - Tiered fees based on amount ranges
   - `base_bps` - Base fee in basis points
   - Tiers:
     - Amount < 1000: base_bps
     - 1000 ≤ Amount < 10000: base_bps / 2
     - Amount ≥ 10000: base_bps / 4
   - Example: `Dynamic(400)` = 4% for small, 2% for medium, 1% for large

---

## Internal Service Functions

These functions are used internally by the contract but not exposed as public methods.

### `calculate_platform_fee`
Calculates only the platform fee (backward compatible).

```rust
pub fn calculate_platform_fee(
    env: &Env,
    amount: i128,
) -> Result<i128, ContractError>
```

Used by `create_remittance()` to calculate the fee when creating a new remittance.

---

### `calculate_batch_fees`
Aggregates fees for multiple transactions.

```rust
pub fn calculate_batch_fees(
    env: &Env,
    amounts: &[i128],
    corridor: Option<&FeeCorridor>,
) -> Result<FeeBreakdown, ContractError>
```

Used for batch settlement operations to calculate total fees across multiple remittances.

---

## Error Handling

The fee service returns standard `ContractError` variants:

- `InvalidAmount` - Amount is zero, negative, or invalid
- `InvalidFeeBps` - Fee basis points exceed maximum (10000)
- `Overflow` - Arithmetic overflow in calculation
- `NotInitialized` - Contract not properly initialized

---

## Usage Patterns

### Pattern 1: Display Fees to User

```rust
// Before user commits to transaction, show fee breakdown
let breakdown = client.calculate_fee_breakdown(&amount);

display_to_user(&format!(
    "Amount: {}\n\
     Platform Fee: {}\n\
     Protocol Fee: {}\n\
     Total Fees: {}\n\
     You will receive: {}",
    breakdown.amount,
    breakdown.platform_fee,
    breakdown.protocol_fee,
    breakdown.total_fees,
    breakdown.net_amount
));
```

---

### Pattern 2: Corridor-Based Pricing

```rust
// Check if corridor exists for this country pair
let corridor = client.get_fee_corridor(&from_country, &to_country);

let breakdown = if let Some(corr) = corridor {
    // Use corridor-specific rates
    client.calculate_fee_breakdown_with_corridor(&amount, &corr)?
} else {
    // Use default rates
    client.calculate_fee_breakdown(&amount)?
};
```

---

### Pattern 3: Admin Configuration

```rust
// Set up multiple corridors
let corridors = vec![
    FeeCorridor {
        from_country: String::from_str(&env, "US"),
        to_country: String::from_str(&env, "MX"),
        strategy: FeeStrategy::Percentage(150),
        protocol_fee_bps: Some(50),
    },
    FeeCorridor {
        from_country: String::from_str(&env, "US"),
        to_country: String::from_str(&env, "PH"),
        strategy: FeeStrategy::Percentage(200),
        protocol_fee_bps: Some(75),
    },
];

for corridor in corridors {
    client.set_fee_corridor(&admin, &corridor)?;
}
```

---

## Migration Guide

### From Old API

**Old way (before refactor):**
```rust
// Fee was calculated internally, no breakdown available
let remittance_id = client.create_remittance(&sender, &agent, &amount, &None);
let remittance = client.get_remittance(&remittance_id);
// Only remittance.fee was available
```

**New way (after refactor):**
```rust
// Get complete breakdown before creating remittance
let breakdown = client.calculate_fee_breakdown(&amount);
// Show breakdown to user
display_fees(&breakdown);
// Then create remittance
let remittance_id = client.create_remittance(&sender, &agent, &amount, &None);
```

---

## Best Practices

1. **Always show fee breakdown to users** before they commit to a transaction
2. **Use corridors** for cross-border transactions to optimize fees
3. **Cache corridor lookups** if making multiple calculations for same country pair
4. **Validate amounts** before calling fee calculation functions
5. **Handle errors gracefully** and provide clear error messages to users

---

## Performance Considerations

- Fee calculations are O(1) - constant time
- Corridor lookups are O(1) - single storage read
- Batch calculations are O(n) where n is number of amounts
- No network calls or external dependencies

---

## Security Notes

- All arithmetic uses checked operations to prevent overflow
- Corridor management requires admin authentication
- Fee breakdowns self-validate for consistency
- Input validation at service boundary
- Type-safe Rust implementation prevents common errors

---

## Version History

### v1.0.0 (Current)
- Initial release of centralized fee service
- Support for corridor-based configurations
- Complete fee breakdown functionality
- Three fee strategies: Percentage, Flat, Dynamic
