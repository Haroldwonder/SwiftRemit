# SwiftRemit Examples

This directory contains examples demonstrating how to interact with the SwiftRemit smart contract from external clients.

## Quick Start

### Prerequisites

- **Node.js 18+** - [Install Node.js](https://nodejs.org/)
- **npm or yarn** - Package manager
- **Stellar account** - Account on testnet or mainnet
- **Deployed contract** - SwiftRemit contract deployed to the network
- **USDC tokens** - Test USDC for the sender account

### Installation

1. Navigate to the examples directory:

```bash
cd examples
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your contract addresses and account secrets.

### Run the Example

```bash
node client-example.js
```

## Example Flow

The [`client-example.js`](client-example.js) demonstrates the complete SwiftRemit interaction flow:

### 1. Administrative Functions

```javascript
// Initialize contract (run once)
await initializeContract();

// Register an agent
await registerAgent(agentAddress);

// Update platform fee
await updateFee(250); // 2.5%
```

### 2. User Functions

```javascript
// Create a remittance (sender calls)
const remittanceId = await createRemittance(
  senderKeypair,
  agentAddress,
  100 // 100 USDC
);

// Confirm payout (agent calls after fiat payment)
await confirmPayout(agentKeypair, remittanceId);

// Cancel pending remittance (sender calls)
await cancelRemittance(senderKeypair, remittanceId);
```

### 3. Query Functions

```javascript
// Get remittance details
const remittance = await getRemittance(remittanceId);

// Check accumulated fees
const fees = await getAccumulatedFees();

// Verify agent registration
const registered = await isAgentRegistered(agentAddress);

// Get current fee
const feeBps = await getPlatformFeeBps();
```

## Complete Usage Example

Here's a full example of a typical remittance flow:

```javascript
const StellarSdk = require('@stellar/stellar-sdk');

// 1. Setup accounts
const server = new StellarSdk.SorobanRpc.Server('https://soroban-testnet.stellar.org:443');
const adminKeypair = StellarSdk.Keypair.fromSecret('SC...');
const senderKeypair = StellarSdk.Keypair.fromSecret('SC...');
const agentKeypair = StellarSdk.Keypair.fromSecret('SC...');

const contractId = 'CD...';
const usdcTokenId = 'CD...';

// 2. Admin registers agent
await registerAgent(adminKeypair, agentKeypair.publicKey());

// 3. Sender creates remittance
const remittanceId = await createRemittance(
  senderKeypair,
  agentKeypair.publicKey(),
  100 // 100 USDC
);
console.log('Remittance ID:', remittanceId);

// 4. Agent confirms after fiat payout
await confirmPayout(agentKeypair, remittanceId);

// 5. Admin withdraws fees
await withdrawFees(adminKeypair, adminKeypair.publicKey());
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SWIFTREMIT_CONTRACT_ID` | Deployed contract address |
| `USDC_TOKEN_ID` | USDC token contract address |
| `ADMIN_SECRET` | Admin account secret (test only!) |
| `SENDER_SECRET` | Sender account secret (test only!) |
| `AGENT_SECRET` | Agent account secret (test only!) |

## Testing on Testnet

1. **Get test accounts**: Use [Stellar Laboratory](https://laboratory.stellar.org/) or [Friendbot](https://friendbot.stellar.org/)

2. **Deploy contract**: Follow the [deployment guide](../DEPLOYMENT.md)

3. **Get test USDC**: For testing, you may need to deploy a mock USDC token or use the built-in token functionality

4. **Run example**: Execute `node client-example.js`

## Error Handling

The contract returns specific error codes for different failure scenarios. For the complete, up-to-date list of all error codes (79+ codes covering initialization, validation, settlement, KYC, authorization, and more), see [src/errors.rs](../src/errors.rs) in the contract source.

**Common errors you may encounter:**

```javascript
try {
  await createRemittance(senderKeypair, agentAddress, amount);
} catch (error) {
  // Common error codes:
  // 1 - AlreadyInitialized
  // 2 - NotInitialized
  // 3 - InvalidAmount
  // 5 - AgentNotRegistered
  // 15 - UserBlacklisted
  // 17 - KycNotApproved
  // 21 - DailySendLimitExceeded
  // 36 - Overflow
  
  // For the full error catalogue, see src/errors.rs
  console.error('Contract error:', error);
}
```

## Fee Calculation

Fees are calculated in basis points (bps):

```
250 bps = 2.5%
500 bps = 5.0%
1000 bps = 10%

Fee = amount * fee_bps / 10000
```

Example:
- Amount: 100 USDC
- Fee: 250 bps (2.5%)
- Fee charged: 2.5 USDC
- Agent receives: 97.5 USDC

## Event Monitoring

The contract emits events for each operation. You can monitor these using Stellar SDK:

```javascript
const server = new StellarSdk.SorobanRpc.Server('https://soroban-testnet.stellar.org:443');

// Subscribe to contract events
const events = await server.getContractEvents(
  contractId,
  { topics: ['remit', 'created'], limit: 10 }
);

// Common event topics (topics are emitted as tuples like ["remit", "created"]):
// - ["remit", "created"]: New remittance created
// - ["remit", "completed"]: Payout confirmed
// - ["remit", "cancelled"]: Remittance cancelled
// - ["agent", "registered"]: Agent registered
// - ["admin", "paused"]: Contract paused
```

**For the complete event catalogue**, including all event topics, data structures, schema versioning, and payload shapes, see [docs/EVENTS.md](../docs/EVENTS.md).

## Additional Resources

- [Stellar SDK Documentation](https://developers.stellar.org/docs)
- [Soroban Documentation](https://developers.stellar.org/docs/soroban)
- [Stellar Laboratory](https://laboratory.stellar.org/)
- [Contract API Reference](../API.md)
- [Deployment Guide](../DEPLOYMENT.md)

## Troubleshooting

### "Transaction simulation failed"
- Check that the contract is deployed
- Verify account has enough XLM for fees
- Ensure proper authentication

### "InvalidAmount"
- Amount must be greater than 0
- Check USDC token decimals

### "AgentNotRegistered"
- Ensure agent is registered first using admin account
- Check the agent address is correct

### "Insufficient balance"
- Sender needs USDC balance
- Use test token or faucet

## Support

- [GitHub Issues](https://github.com/richardiyamura/SwiftRemit/issues)
- [Stellar Discord](https://discord.gg/stellar)
- [Documentation](../README.md)
