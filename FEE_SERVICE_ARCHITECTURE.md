# Fee Service Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     SwiftRemit Contract                         │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                   Public API Layer                        │ │
│  │                                                           │ │
│  │  • calculate_fee_breakdown()                             │ │
│  │  • calculate_fee_breakdown_with_corridor()               │ │
│  │  • set_fee_corridor()                                    │ │
│  │  • get_fee_corridor()                                    │ │
│  │  • remove_fee_corridor()                                 │ │
│  │  • create_remittance()                                   │ │
│  │  • confirm_payout()                                      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                            │                                    │
│                            ▼                                    │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              Fee Service Module (NEW)                     │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────┐    │ │
│  │  │  calculate_fees_with_breakdown()                │    │ │
│  │  │  • Primary entry point                          │    │ │
│  │  │  • Handles corridor logic                       │    │ │
│  │  │  • Returns complete breakdown                   │    │ │
│  │  └─────────────────────────────────────────────────┘    │ │
│  │                            │                             │ │
│  │                            ▼                             │ │
│  │  ┌─────────────────────────────────────────────────┐    │ │
│  │  │  calculate_fee_by_strategy()                    │    │ │
│  │  │  • Percentage strategy                          │    │ │
│  │  │  • Flat fee strategy                            │    │ │
│  │  │  • Dynamic tiered strategy                      │    │ │
│  │  └─────────────────────────────────────────────────┘    │ │
│  │                            │                             │ │
│  │                            ▼                             │ │
│  │  ┌─────────────────────────────────────────────────┐    │ │
│  │  │  calculate_protocol_fee()                       │    │ │
│  │  │  • Protocol fee calculation                     │    │ │
│  │  │  • Treasury fee handling                        │    │ │
│  │  └─────────────────────────────────────────────────┘    │ │
│  │                            │                             │ │
│  │                            ▼                             │ │
│  │  ┌─────────────────────────────────────────────────┐    │ │
│  │  │  FeeBreakdown::validate()                       │    │ │
│  │  │  • Consistency checks                           │    │ │
│  │  │  • Mathematical validation                      │    │ │
│  │  └─────────────────────────────────────────────────┘    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                            │                                    │
│                            ▼                                    │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                   Storage Layer                           │ │
│  │                                                           │ │
│  │  • get_fee_strategy()                                    │ │
│  │  • get_protocol_fee_bps()                                │ │
│  │  • get_fee_corridor()                                    │ │
│  │  • set_fee_corridor()                                    │ │
│  │  • remove_fee_corridor()                                 │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Fee Calculation Without Corridor

```
User Request
    │
    ▼
calculate_fee_breakdown(amount)
    │
    ├─► get_fee_strategy() ──────────┐
    │                                 │
    ├─► get_protocol_fee_bps() ──────┤
    │                                 │
    ▼                                 ▼
calculate_fee_by_strategy()    calculate_protocol_fee()
    │                                 │
    └────────────┬────────────────────┘
                 │
                 ▼
         Create FeeBreakdown
                 │
                 ▼
         Validate Breakdown
                 │
                 ▼
         Return to User
```

### 2. Fee Calculation With Corridor

```
User Request (with corridor)
    │
    ▼
calculate_fee_breakdown_with_corridor(amount, corridor)
    │
    ├─► Use corridor.strategy ───────┐
    │                                 │
    ├─► Use corridor.protocol_fee ───┤
    │   (or global if None)           │
    │                                 │
    ▼                                 ▼
calculate_fee_by_strategy()    calculate_protocol_fee()
    │                                 │
    └────────────┬────────────────────┘
                 │
                 ▼
         Create FeeBreakdown
         (with corridor info)
                 │
                 ▼
         Validate Breakdown
                 │
                 ▼
         Return to User
```

### 3. Remittance Creation Flow

```
create_remittance(sender, agent, amount)
    │
    ▼
Validate Request
    │
    ▼
fee_service::calculate_platform_fee(amount)
    │
    ├─► get_fee_strategy()
    │
    ▼
calculate_fee_by_strategy()
    │
    ▼
Return fee amount
    │
    ▼
Transfer tokens
    │
    ▼
Create Remittance record
(with calculated fee)
    │
    ▼
Return remittance_id
```

### 4. Payout Confirmation Flow

```
confirm_payout(remittance_id)
    │
    ▼
Get Remittance
    │
    ▼
fee_service::calculate_fees_with_breakdown(amount)
    │
    ├─► Platform fee calculation
    ├─► Protocol fee calculation
    │
    ▼
Verify stored fee matches
    │
    ▼
Transfer payout (net_amount)
    │
    ▼
Transfer protocol fee to treasury
    │
    ▼
Update accumulated fees
    │
    ▼
Mark as completed
```

## Module Dependencies

```
┌─────────────┐
│   lib.rs    │ ◄─── Main contract implementation
└──────┬──────┘
       │
       ├──► ┌──────────────┐
       │    │ fee_service  │ ◄─── NEW: Centralized fee logic
       │    └──────┬───────┘
       │           │
       │           ├──► ┌──────────────┐
       │           │    │ fee_strategy │ ◄─── Fee strategy enum
       │           │    └──────────────┘
       │           │
       │           └──► ┌──────────────┐
       │                │   storage    │ ◄─── Storage functions
       │                └──────────────┘
       │
       ├──► ┌──────────────┐
       │    │    types     │ ◄─── Data structures
       │    └──────────────┘
       │
       └──► ┌──────────────┐
            │  validation  │ ◄─── Input validation
            └──────────────┘
```

## Storage Schema

```
Instance Storage (Contract-level):
┌────────────────────────────────────┐
│ FeeStrategy                        │ ◄─── Global fee strategy
│ ProtocolFeeBps                     │ ◄─── Global protocol fee
│ Treasury                           │ ◄─── Treasury address
└────────────────────────────────────┘

Persistent Storage (Per-entity):
┌────────────────────────────────────┐
│ FeeCorridor("US", "MX")           │ ◄─── US → Mexico corridor
│ FeeCorridor("US", "PH")           │ ◄─── US → Philippines corridor
│ FeeCorridor("GB", "IN")           │ ◄─── UK → India corridor
│ ...                                │
└────────────────────────────────────┘
```

## Fee Strategy Decision Tree

```
                    Start
                      │
                      ▼
              Corridor provided?
                   /    \
                 Yes     No
                 /         \
                ▼           ▼
    Use corridor.strategy   Use global strategy
                \           /
                 \         /
                  ▼       ▼
              Which strategy type?
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
   Percentage       Flat        Dynamic
        │             │             │
        │             │             ▼
        │             │      Amount < 1000?
        │             │        /        \
        │             │      Yes         No
        │             │       │           │
        │             │       │      Amount < 10000?
        │             │       │        /        \
        │             │       │      Yes         No
        │             │       │       │           │
        ▼             ▼       ▼       ▼           ▼
   amount * bps   fixed    base_bps  base_bps/2  base_bps/4
   ─────────────  amount   * amount  * amount    * amount
      10000
        │             │       │       │           │
        └─────────────┴───────┴───────┴───────────┘
                      │
                      ▼
              Platform Fee Calculated
                      │
                      ▼
          Calculate Protocol Fee
                      │
                      ▼
          Create FeeBreakdown
                      │
                      ▼
              Validate & Return
```

## Component Responsibilities

### Fee Service (`fee_service.rs`)
**Responsibilities:**
- Calculate all fees (platform + protocol)
- Apply fee strategies
- Handle corridor logic
- Create fee breakdowns
- Validate calculations

**Does NOT:**
- Store data (delegates to storage module)
- Handle authentication (delegates to contract)
- Manage tokens (delegates to contract)

### Storage Module (`storage.rs`)
**Responsibilities:**
- Store/retrieve fee strategies
- Store/retrieve corridors
- Store/retrieve protocol fees
- Manage persistent data

**Does NOT:**
- Calculate fees
- Validate business logic
- Handle authentication

### Contract (`lib.rs`)
**Responsibilities:**
- Public API endpoints
- Authentication/authorization
- Token transfers
- Business logic orchestration
- Event emission

**Does NOT:**
- Calculate fees directly (delegates to fee_service)
- Duplicate fee logic

## Before vs After Architecture

### Before Refactor

```
┌─────────────────────────────────────┐
│           lib.rs                    │
│                                     │
│  create_remittance() {              │
│    fee = calculate_fee(...)  ◄──┐  │
│  }                              │  │
│                                 │  │
│  confirm_payout() {             │  │
│    protocol_fee = amount * bps  │  │ ◄─── Duplicated logic
│    payout = amount - fee - ...  │  │
│  }                              │  │
└─────────────────────────────────┘  │
                                     │
┌─────────────────────────────────┐  │
│      fee_strategy.rs            │  │
│                                 │  │
│  calculate_fee(...) {           │  │ ◄─── Duplicated logic
│    match strategy { ... }       │  │
│  }                              │  │
└─────────────────────────────────┘  │
                                     │
         No corridor support ────────┘
         No fee breakdowns
```

### After Refactor

```
┌─────────────────────────────────────┐
│           lib.rs                    │
│                                     │
│  create_remittance() {              │
│    fee = fee_service::              │
│          calculate_platform_fee()   │
│  }                                  │
│                                     │
│  confirm_payout() {                 │
│    breakdown = fee_service::        │
│      calculate_fees_with_breakdown()│
│  }                                  │
└─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│      fee_service.rs (NEW)           │
│                                     │
│  • calculate_fees_with_breakdown()  │ ◄─── Single source
│  • calculate_platform_fee()         │      of truth
│  • calculate_batch_fees()           │
│  • Corridor support                 │
│  • Complete breakdowns              │
└─────────────────────────────────────┘
```

## Key Improvements

1. **Centralization**: All fee logic in one module
2. **Transparency**: Complete fee breakdowns
3. **Flexibility**: Corridor-based configurations
4. **Maintainability**: Single place to update
5. **Testability**: Isolated module easy to test
6. **Correctness**: Built-in validation
7. **Security**: Checked arithmetic throughout
8. **Documentation**: Comprehensive docs

## Performance Characteristics

- **Fee Calculation**: O(1) - constant time
- **Corridor Lookup**: O(1) - single storage read
- **Batch Processing**: O(n) - linear in number of amounts
- **Storage Operations**: O(1) - direct key access
- **Memory Usage**: Minimal - no large data structures

## Security Model

```
┌─────────────────────────────────────┐
│         Security Layers             │
│                                     │
│  1. Authentication                  │
│     └─► require_auth()              │
│                                     │
│  2. Authorization                   │
│     └─► require_admin()             │
│                                     │
│  3. Input Validation                │
│     └─► validate_amount()           │
│     └─► validate_fee_bps()          │
│                                     │
│  4. Arithmetic Safety               │
│     └─► checked_mul()               │
│     └─► checked_div()               │
│     └─► checked_add()               │
│     └─► checked_sub()               │
│                                     │
│  5. Consistency Validation          │
│     └─► FeeBreakdown::validate()   │
└─────────────────────────────────────┘
```

## Conclusion

The refactored architecture provides:
- ✅ Clear separation of concerns
- ✅ Single responsibility per module
- ✅ No code duplication
- ✅ Comprehensive fee transparency
- ✅ Flexible corridor support
- ✅ Production-ready implementation

---

## Net Settlement Execution (#834)

### Overview

`execute_net_settlement` is the on-chain execution path for netting.rs. It moves only
the **net difference** between opposing agent flows instead of executing every individual
remittance transfer, dramatically reducing on-chain token transfer count.

### Authorization

Only addresses holding the **Admin role** (settlement operators) may call this function.
The caller must `require_auth()` and pass `require_role_admin()` before any state changes.

### Flow

```
operator calls execute_net_settlement(operator, [id1, id2, ...])
    │
    ├─ 1. Auth: operator.require_auth() + require_role_admin()
    ├─ 2. Guard: contract not paused, batch size 1–50
    ├─ 3. Load: fetch all Pending remittances, reject expired/settled
    │
    ├─ 4. Compute: netting::compute_net_settlements()
    │       Groups flows by (party_a, party_b) pair (address-sorted for determinism)
    │       Offsets opposing flows — e.g. A→B 100 and B→A 90 → net 10 A→B
    │
    ├─ 5. Validate: netting::validate_net_settlement() — fees must be conserved
    │
    ├─ 6. Execute net token transfers (contract → recipient, payout = net - fees)
    │       Accumulate fees into platform fee pool
    │       Emit settlement_completed event per net transfer
    │
    └─ 7. Finalize: mark each remittance Completed, set settlement hash,
              emit remittance_completed per remittance
              return BatchSettlementResult { settled_ids }
```

### Example

| Remittance | Direction | Amount | Fee |
|-----------|-----------|--------|-----|
| #1        | A → B     | 100    | 2   |
| #2        | B → A     | 90     | 1   |

**Result:** Single net transfer of **9** (= 10 net − 1 fee) from A to B.
Total fees collected: **3** (2 + 1).

### Key Properties

- **Single call**: all net transfers execute atomically in one contract invocation.
- **Deterministic**: address-pair ordering is canonical; same input always produces same output.
- **Fee-preserving**: total fees in = total fees out (validated before execution).
- **DoS-safe**: batch capped at `MAX_NETTING_BATCH_SIZE` (50).
