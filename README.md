# SwiftRemit

Production-ready Soroban smart contract for USDC remittance platform on Stellar blockchain.

## Overview

SwiftRemit is an escrow-based remittance system that enables secure cross-border money transfers using USDC stablecoin. The platform connects senders with registered agents who handle fiat payouts, with the smart contract managing escrow, fee collection, and settlement.

## Features

- **Escrow-Based Transfers**: Secure USDC deposits held in contract until payout confirmation
- **Agent Network**: Registered agents handle fiat distribution off-chain
- **Automated Fee Collection**: Platform fees calculated and accumulated automatically
- **Lifecycle State Management**: Remittances tracked through 5 states (Pending, Processing, Completed, Cancelled, Failed) with enforced transitions
- **Authorization Security**: Role-based access control for all operations
- **Event Emission**: Comprehensive event logging for off-chain monitoring
- **Cancellation Support**: Senders can cancel pending remittances with full refund
- **Admin Controls**: Platform fee management and fee withdrawal capabilities

## Getting Started

### Prerequisites
- [Rust and Cargo](https://rustup.rs/)
- [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup)
- Target `wasm32-unknown-unknown`

### Build & Test
```bash
# Compile the contract
stellar contract build

# Run the test suite
cargo test
```

## Architecture

### Core Components

- **lib.rs**: Main contract implementation with all public functions
- **types.rs**: Data structures (Remittance, RemittanceStatus)
- **transitions.rs**: State transition validation and enforcement
- **storage.rs**: Persistent and instance storage management
- **errors.rs**: Custom error types for contract operations
- **events.rs**: Event emission functions for monitoring
- **test.rs**: Comprehensive test suite with 15+ test cases
- **test_transitions.rs**: Lifecycle transition tests

### Storage Model

- **Instance Storage**: Admin, USDC token, fee configuration, counters, accumulated fees
- **Persistent Storage**: Individual remittances, agent registrations

### Fee Calculation

Fees are calculated in basis points (bps):
- 250 bps = 2.5%
- 500 bps = 5.0%
- Formula: `fee = amount * fee_bps / 10000`

## Contract Functions

### Administrative Functions

- `initialize(admin, usdc_token, fee_bps)` - One-time contract initialization
- `register_agent(agent)` - Add agent to approved list (admin only)
- `remove_agent(agent)` - Remove agent from approved list (admin only)
- `update_fee(fee_bps)` - Update platform fee percentage (admin only)
- `withdraw_fees(to)` - Withdraw accumulated fees (admin only)

### User Functions

- `create_remittance(sender, agent, amount)` - Create new remittance (sender auth required)
- `start_processing(remittance_id)` - Mark remittance as being processed (agent auth required)
- `confirm_payout(remittance_id)` - Confirm fiat payout (agent auth required)
- `mark_failed(remittance_id)` - Mark payout as failed with refund (agent auth required)
- `cancel_remittance(remittance_id)` - Cancel pending remittance (sender auth required)

### Query Functions

- `get_remittance(remittance_id)` - Retrieve remittance details
- `get_accumulated_fees()` - Check total platform fees collected
- `is_agent(agent)` - Check if an address is a registered agent