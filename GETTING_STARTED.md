# Getting Started with SwiftRemit

This is the single entry point for integrating with SwiftRemit: install the SDK, connect a
wallet, check limits, quote a fee, create a remittance, track its status, and handle errors —
start to finish, against Stellar testnet.

If you're contributing to SwiftRemit itself (running the full stack locally), see
[CONTRIBUTING.md](CONTRIBUTING.md) instead.

## 1. Install

```bash
npm install @swiftremit/sdk @stellar/stellar-sdk
```

## 2. Configure

Create a `.env` file with:

```
CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SENDER_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
AGENT_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
USDC_TOKEN=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

Get a funded testnet keypair from the [Stellar Friendbot](https://friendbot.stellar.org/?addr=YOUR_ADDRESS)
if you don't have one.

## 3. Connect and check limits

```typescript
import { SwiftRemitClient } from "@swiftremit/sdk";
import { Keypair } from "@stellar/stellar-sdk";
import * as dotenv from "dotenv";

dotenv.config();

const client = new SwiftRemitClient({
  contractId: process.env.CONTRACT_ID!,
  networkPassphrase: process.env.NETWORK_PASSPHRASE!,
  rpcUrl: process.env.SOROBAN_RPC_URL!,
});

const sender = Keypair.fromSecret(process.env.SENDER_SECRET!);
const agent = Keypair.fromSecret(process.env.AGENT_SECRET!).publicKey();

const isRegistered = await client.isAgentRegistered(sender.publicKey(), agent);
if (!isRegistered) throw new Error(`Agent ${agent} is not registered — ask an admin to register it.`);

const limitStatus = await client.getDailyLimitStatus(sender.publicKey(), sender.publicKey(), "USD", "US");
console.log(`Daily limit remaining: ${limitStatus.remaining} (resets ${limitStatus.resetsAt.toISOString()})`);
```

## 4. Quote the fee

```typescript
import { toStroops, fromStroops } from "@swiftremit/sdk";

const amount = toStroops(50); // 50 USDC
const quote = await client.estimateFee(amount, { currency: "USD", country: "US" }, sender.publicKey());
console.log(`Fee: ${fromStroops(quote.totalFee)} USDC, you send: ${fromStroops(quote.netAmount)} USDC net`);
```

## 5. Create the remittance

The contract pulls USDC from the sender via the token's SAC `approve`/`transfer_from` flow, so
approve the contract for `amount + fee` before calling `createRemittance`. See the
[Stellar SAC docs](https://developers.stellar.org/docs/tokens/stellar-asset-contract) for the
approval call.

```typescript
const tx = await client.createRemittance({
  sender: sender.publicKey(),
  agent,
  amount,
  token: process.env.USDC_TOKEN!,
});
const result = await client.submitTransaction(tx, sender);
console.log("Remittance created, tx hash:", result.hash);

const remittanceId = await client.getRemittanceCount(sender.publicKey());
```

## 6. Track status

```typescript
let remittance = await client.getRemittance(sender.publicKey(), remittanceId);
while (remittance.status === "Pending") {
  await new Promise((r) => setTimeout(r, 3000));
  remittance = await client.getRemittance(sender.publicKey(), remittanceId);
}
console.log("Status:", remittance.status);
```

## 7. Handle errors

| Error | Cause | Fix |
|---|---|---|
| `AgentNotRegistered` | Agent address not in contract | Admin calls `registerAgent()` |
| `InsufficientFunds` | Sender balance too low | Fund the account or reduce amount |
| `KycExpired` (code 23) | Sender KYC has expired | Renew KYC via your anchor |
| `DailyLimitExceeded` | Corridor daily cap hit | Wait for reset or use a different corridor |
| `Simulation failed` | RPC or contract error | Check `SOROBAN_RPC_URL` and `CONTRACT_ID` |

For the full error/code list, see [src/errors.rs](src/errors.rs) or [API.md](API.md).

---

## Agent-side flow

Agents confirm payouts to recipients and are the counterparty registered by an admin.

1. **Registration** — an admin calls `registerAgent(admin, agentAddress)`. There is no
   self-service agent registration; contact the deploying admin.
2. **KYC** — agent identity/compliance checks happen off-chain via your anchor integration; see
   [ANCHOR_QUICKSTART.md](ANCHOR_QUICKSTART.md) for the anchor-facing SEP-24 flow.
3. **Confirming payouts** — once a remittance is `Pending`/`Processing` and the agent has paid the
   recipient off-chain, the agent confirms on-chain:
   ```typescript
   const confirmTx = await client.confirmPayout(agent, remittanceId);
   await client.submitTransaction(confirmTx, agentKeypair);
   ```
4. **Disputes** — either party can raise a dispute before the dispute window closes:
   ```typescript
   const disputeTx = await client.raiseDispute(sender.publicKey(), remittanceId, evidenceHash);
   await client.submitTransaction(disputeTx, sender);
   ```
   An admin resolves it with `client.resolveDispute(admin, remittanceId, inFavourOfSender)`.

## Admin-side flow

1. **Initialization** — one-time contract setup:
   ```typescript
   const initTx = await client.initialize(adminAddress, usdcTokenAddress, feeBps);
   await client.submitTransaction(initTx, adminKeypair);
   ```
2. **Agent registration** — `client.registerAgent(admin, agentAddress)` /
   `client.removeAgent(admin, agentAddress)`.
3. **Fee configuration** — `client.updateFee(admin, feeBps)` for the platform fee; corridor caps
   via `client.setDailyLimit(...)` and `client.setAgentDailyCap(...)`.
4. **Withdrawal** — `client.withdrawFees(admin, to)` and
   `client.withdrawIntegratorFees(admin, to, integrator)` sweep accumulated fees.

Full method reference: [sdk/src/client.ts](sdk/src/client.ts). Contract-level details:
[API.md](API.md) and [src/lib.rs](src/lib.rs).

## Running the sample app

A minimal runnable end-to-end script (sender flow) lives at
[sdk/examples/quickstart.ts](sdk/examples/quickstart.ts) — create the `.env` from step 2 inside
`sdk/`, fill in funded testnet secrets, then run:

```bash
cd sdk
npx tsx examples/quickstart.ts
```

## Setting up local testnet infrastructure

If you need to deploy your own contract instance to testnet (rather than using an existing
`CONTRACT_ID`), see [TESTNET_SETUP_GUIDE.md](TESTNET_SETUP_GUIDE.md).
