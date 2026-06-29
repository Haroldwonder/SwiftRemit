# @swiftremit/sdk

TypeScript/JavaScript client SDK for the **SwiftRemit** Soroban smart contract on Stellar.

> **New to SwiftRemit?** See the [Quickstart guide](./QUICKSTART.md) for a complete end-to-end Node.js example.

## Installation

```bash
npm install @swiftremit/sdk @stellar/stellar-sdk
```

## Quick Start

```typescript
import { SwiftRemitClient, Networks, RpcUrls, toStroops } from "@swiftremit/sdk";
import { Keypair } from "@stellar/stellar-sdk";

const client = new SwiftRemitClient({
  contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  networkPassphrase: Networks.TESTNET,
  rpcUrl: RpcUrls.TESTNET,
});

// Query remittance
const remittance = await client.getRemittance(
  "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  1n
);
console.log(remittance);

// Create remittance
const senderKeypair = Keypair.fromSecret("SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const tx = await client.createRemittance({
  sender: senderKeypair.publicKey(),
  agent: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  amount: toStroops(100), // 100 USDC
});

const result = await client.submitTransaction(tx, senderKeypair);
console.log("Remittance created:", result.hash);
```

## Features

- ✅ Fully typed TypeScript interfaces
- ✅ All contract functions wrapped (read & write)
- ✅ Automatic XDR conversion
- ✅ Transaction simulation & assembly
- ✅ Helper utilities (`toStroops`, `fromStroops`)
- ✅ Real-time event subscription via Horizon SSE (`subscribeToRemittanceEvents`)

## API Reference

### Client Initialization

```typescript
const client = new SwiftRemitClient({
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  fee?: string; // optional, defaults to BASE_FEE
});
```

### Query Methods (Read-Only)

All query methods require a `sourceAddress` for simulation:

- `getRemittance(sourceAddress, remittanceId)` → `Remittance`
- `getRemittancesBySender(sourceAddress, sender, offset, limit)` → `bigint[]`
- `getAccumulatedFees(sourceAddress)` → `bigint`
- `isAgentRegistered(sourceAddress, agent)` → `boolean`
- `isTokenWhitelisted(sourceAddress, token)` → `boolean`
- `getPlatformFeeBps(sourceAddress)` → `number`
- `getRemittanceCount(sourceAddress)` → `bigint`
- `getTotalVolume(sourceAddress)` → `bigint`
- `getAdminCount(sourceAddress)` → `number`
- `health(sourceAddress)` → `HealthStatus`
- `getAgentStats(sourceAddress, agent)` → `AgentStats`
- `getAgentReputation(sourceAddress, agent)` → `number`
- `getCircuitBreakerStatus(sourceAddress)` → `CircuitBreakerStatus`
- `getAgentDailyCap(sourceAddress, agent)` → `bigint`
- `getDisputeWindow(sourceAddress)` → `bigint`

### Write Methods (Return Prepared Transaction)

All write methods return a `Transaction` that must be signed and submitted:

**Admin Functions:**
- `initialize(admin, params)` — One-time contract setup
- `registerAgent(admin, agent, kycHash?)` — Register new agent
- `removeAgent(admin, agent)` — Remove agent
- `updateFee(admin, feeBps)` — Update platform fee
- `withdrawFees(admin, to)` — Withdraw platform fees
- `setDailyLimit(admin, currency, country, limit)` — Set send limits
- `setAgentDailyCap(admin, agent, cap)` — Set agent withdrawal cap
- `addAdmin(caller, newAdmin)` — Add new admin
- `resolveDispute(admin, remittanceId, inFavourOfSender)` — Resolve dispute

**User Functions:**
- `createRemittance(params)` — Create new remittance
- `batchCreateRemittances(sender, entries)` — Batch create
- `confirmPayout(agent, remittanceId, proof?, recipientDetailsHash?)` — Confirm payout
- `confirmPartialPayout(agent, remittanceId, amount)` — Partial payout
- `cancelRemittance(sender, remittanceId)` — Cancel pending remittance
- `markFailed(agent, remittanceId)` — Mark as failed
- `raiseDispute(sender, remittanceId, evidenceHash)` — Raise dispute
- `processExpiredRemittances(caller, remittanceIds)` — Batch refund expired

**Integrator Functions:**
- `withdrawIntegratorFees(integrator, to)` — Withdraw integrator fees

### Utilities

```typescript
import { toStroops, fromStroops, USDC_MULTIPLIER } from "@swiftremit/sdk";

toStroops(100);      // 100 USDC → 1_000_000_000n stroops
fromStroops(1_000_000_000n); // → 100 USDC
```

## Governance

The SDK exposes four methods for interacting with the on-chain governance module.

### Types

```typescript
type ProposalState = "Pending" | "Approved" | "Executed" | "Expired";

type ProposalAction =
  | { UpdateFee: number }
  | { RegisterAgent: string }
  | { RemoveAgent: string }
  | { AddAdmin: string }
  | { RemoveAdmin: string }
  | { UpdateQuorum: number }
  | { UpdateTimelock: bigint };

interface Proposal {
  id: bigint;
  proposer: string;
  action: ProposalAction;
  state: ProposalState;
  createdAt: bigint;
  expiry: bigint;
  approvalCount: number;
  approvalTimestamp: bigint | null;
}
```

### Methods

```typescript
// Fetch a single proposal by ID (read-only)
const proposal = await client.getProposal(sourceAddress, 0n);
console.log(proposal.state); // "Pending"

// Fetch all Pending and Approved proposals (iterates IDs until NotFound)
const active = await client.getActiveProposals(sourceAddress);

// Cast an approval vote (admin only) — returns a prepared Transaction
const voteTx = await client.voteOnProposal(adminAddress, 0n);
await client.submitTransaction(voteTx, adminKeypair);

// Execute an approved proposal after the timelock (admin only)
const execTx = await client.executeProposal(adminAddress, 0n);
await client.submitTransaction(execTx, adminKeypair);
```

## Types

All contract types are exported:

```typescript
import type {
  Remittance,
  RemittanceStatus,
  AgentStats,
  CircuitBreakerStatus,
  HealthStatus,
  FeeBreakdown,
  BatchCreateEntry,
  CreateRemittanceParams,
  SettlementConfig,
} from "@swiftremit/sdk";
```

## Real-Time Event Subscription

Subscribe to contract events without polling `getRemittance` repeatedly:

```typescript
import { SwiftRemitClient, Networks, RpcUrls } from "@swiftremit/sdk";

const client = new SwiftRemitClient({
  contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  networkPassphrase: Networks.TESTNET,
  rpcUrl: RpcUrls.TESTNET,
});

// Subscribe to all events for a specific remittance
const unsubscribe = client.subscribeToRemittanceEvents(
  (event) => {
    console.log(`[${event.type}] remittance #${event.remittanceId} at ledger ${event.ledger}`);
    if (event.type === "completed") {
      console.log("Payout confirmed!");
      unsubscribe(); // stop listening once done
    }
  },
  { remittanceId: 42n } // optional filter
);

// Subscribe to all events (no filter)
const unsubAll = client.subscribeToRemittanceEvents((event) => {
  console.log(event);
});

// Stop the subscription
unsubAll();
```

### Event types

| `event.type` | Trigger |
|---|---|
| `created` | New remittance created |
| `completed` | Payout confirmed and settled |
| `cancelled` | Remittance cancelled by sender |
| `failed` | Payout marked as failed |
| `disputed` | Dispute raised on a failed remittance |

### Filtering

Pass a `SubscribeOptions` object as the second argument:

```typescript
// Filter by remittance ID
client.subscribeToRemittanceEvents(cb, { remittanceId: 42n });

// Resume from a saved cursor (paging token)
client.subscribeToRemittanceEvents(cb, { cursor: "1234567890-0" });
```

The subscription reconnects automatically with exponential back-off (1 s → 30 s) on stream disconnect.

## Example: Full Remittance Flow

```typescript
import { SwiftRemitClient, Networks, RpcUrls, toStroops } from "@swiftremit/sdk";
import { Keypair } from "@stellar/stellar-sdk";

const client = new SwiftRemitClient({
  contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  networkPassphrase: Networks.TESTNET,
  rpcUrl: RpcUrls.TESTNET,
});

const sender = Keypair.fromSecret("SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const agent = Keypair.fromSecret("SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

// 1. Create remittance
const createTx = await client.createRemittance({
  sender: sender.publicKey(),
  agent: agent.publicKey(),
  amount: toStroops(100),
});
const createResult = await client.submitTransaction(createTx, sender);
console.log("Created:", createResult.hash);

// 2. Agent confirms payout
const confirmTx = await client.confirmPayout(agent.publicKey(), 1n);
const confirmResult = await client.submitTransaction(confirmTx, agent);
console.log("Confirmed:", confirmResult.hash);

// 3. Query final state
const remittance = await client.getRemittance(sender.publicKey(), 1n);
console.log("Status:", remittance.status); // "Completed"
```

## Example: Batch Remittance Creation

Use `batchCreateRemittances` to submit up to `MAX_BATCH_SIZE` (50) remittances
in a single transaction. Each entry can optionally include `currency` and
`country` metadata for corridor-level daily-limit tracking.

```typescript
import {
  SwiftRemitClient,
  MAX_BATCH_SIZE,
  Networks,
  RpcUrls,
  toStroops,
} from "@swiftremit/sdk";
import type { BatchCreateEntry } from "@swiftremit/sdk";
import { Keypair } from "@stellar/stellar-sdk";

const client = new SwiftRemitClient({
  contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  networkPassphrase: Networks.TESTNET,
  rpcUrl: RpcUrls.TESTNET,
});

const sender = Keypair.fromSecret("SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const agentAddress = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const entries: BatchCreateEntry[] = [
  { agent: agentAddress, amount: toStroops(50),  currency: "USDC", country: "NG" },
  { agent: agentAddress, amount: toStroops(75),  currency: "USDC", country: "GH" },
  { agent: agentAddress, amount: toStroops(100), currency: "USDC", country: "KE" },
];

// Client-side validation: throws if entries.length > MAX_BATCH_SIZE (50)
const batchTx = await client.batchCreateRemittances(sender.publicKey(), entries);
const result = await client.submitTransaction(batchTx, sender);
console.log("Batch submitted:", result.hash);
```

## License

MIT

## React Native

A React Native wrapper is available in `sdk/react-native/`. It wraps the core TypeScript SDK with:

- A `SwiftRemitSigner` interface so any wallet (expo-secure-store, react-native-keychain, WalletConnect) can be plugged in without changing call sites.
- `SwiftRemitRNClient` — extends `SwiftRemitClient` with a `submitSigned(tx)` method that signs via the injected signer.
- React hooks: `useCreateRemittance`, `useNetworkToggle`.

### Installation

```bash
npm install @swiftremit/react-native-sdk @swiftremit/sdk @stellar/stellar-sdk
# or
yarn add @swiftremit/react-native-sdk @swiftremit/sdk @stellar/stellar-sdk
```

### Quick Start

```typescript
import { SwiftRemitRNClient, Networks, RpcUrls, toStroops } from '@swiftremit/react-native-sdk';
import * as SecureStore from 'expo-secure-store';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

// 1. Implement the signer using expo-secure-store
const signer = {
  async getPublicKey() {
    return (await SecureStore.getItemAsync('stellar_public_key')) ?? '';
  },
  async signTransaction(xdr: string, { networkPassphrase }: { networkPassphrase: string }) {
    const secret = await SecureStore.getItemAsync('stellar_secret_key');
    if (!secret) throw new Error('No key stored');
    const keypair = Keypair.fromSecret(secret);
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    tx.sign(keypair);
    return tx.toXDR();
  },
};

// 2. Create the client
const client = new SwiftRemitRNClient({
  contractId: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  networkPassphrase: Networks.TESTNET,
  rpcUrl: RpcUrls.TESTNET,
  signer,
});

// 3. Create a remittance — sign and submit in one call
const address = await client.getAddress();
const tx = await client.createRemittance({
  sender: address,
  agent: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  amount: toStroops(100),
});
const result = await client.submitSigned(tx);
console.log('Remittance created:', result.hash);
```

### Hooks

```tsx
import { useCreateRemittance, useNetworkToggle, toStroops } from '@swiftremit/react-native-sdk';

function SendScreen({ client }) {
  const { createRemittance, loading, error } = useCreateRemittance(client);
  const { network, toggle } = useNetworkToggle('testnet');

  return (
    <>
      <Button title={`Network: ${network}`} onPress={toggle} />
      <Button
        title={loading ? 'Sending…' : 'Send 100 USDC'}
        disabled={loading}
        onPress={() =>
          createRemittance({
            sender: '...',
            agent: '...',
            amount: toStroops(100),
          })
        }
      />
      {error && <Text>{error.message}</Text>}
    </>
  );
}
```
