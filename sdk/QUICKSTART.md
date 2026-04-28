# SwiftRemit SDK — Quickstart

End-to-end Node.js example: connect wallet → create remittance → monitor status → confirm payout.

## Prerequisites

```bash
npm install @swiftremit/sdk @stellar/stellar-sdk
```

Set the following environment variables (or copy `.env.testnet` from the repo root):

```
CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SENDER_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
AGENT_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
USDC_TOKEN=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

## Complete example

```typescript
import { SwiftRemitClient, toStroops, fromStroops } from "@swiftremit/sdk";
import { Keypair, Asset, TransactionBuilder, Networks, Operation } from "@stellar/stellar-sdk";
import * as dotenv from "dotenv";

dotenv.config();

const client = new SwiftRemitClient({
  contractId: process.env.CONTRACT_ID!,
  networkPassphrase: process.env.NETWORK_PASSPHRASE!,
  rpcUrl: process.env.SOROBAN_RPC_URL!,
});

const senderKeypair = Keypair.fromSecret(process.env.SENDER_SECRET!);
const agentKeypair  = Keypair.fromSecret(process.env.AGENT_SECRET!);

async function main() {
  // ── 1. Check agent is registered ──────────────────────────────────────────
  const agentAddress = agentKeypair.publicKey();
  const isRegistered = await client.isAgentRegistered(senderKeypair.publicKey(), agentAddress);
  if (!isRegistered) {
    throw new Error(`Agent ${agentAddress} is not registered. Ask an admin to call registerAgent().`);
  }
  console.log("✓ Agent is registered");

  // ── 2. Approve USDC spend (SAC allowance) ─────────────────────────────────
  // The contract pulls USDC from the sender via token.transfer_from, so the
  // sender must approve the contract to spend the amount + fee first.
  // This step uses the Stellar Asset Contract (SAC) for USDC.
  const amount = toStroops(50); // 50 USDC in stroops
  console.log(`Approving ${fromStroops(amount)} USDC for contract…`);
  // NOTE: In a real app use the USDC SAC's `approve` method here.
  // Omitted for brevity — see the Stellar docs for SAC token approval.

  // ── 3. Create remittance ───────────────────────────────────────────────────
  console.log("Creating remittance…");
  let tx;
  try {
    tx = await client.createRemittance({
      sender: senderKeypair.publicKey(),
      agent: agentAddress,
      amount,
      token: process.env.USDC_TOKEN,
    });
  } catch (err: any) {
    console.error("createRemittance failed:", err.message ?? err);
    throw err;
  }

  const result = await client.submitTransaction(tx, senderKeypair);
  console.log("✓ Remittance created, tx hash:", result.hash);

  // ── 4. Resolve the remittance ID from the transaction ─────────────────────
  // The contract emits a `remittance_created` event; the ID is also returned
  // as the transaction return value. Here we fetch the latest count as a proxy.
  const count = await client.getRemittanceCount(senderKeypair.publicKey());
  const remittanceId = count; // newest ID = current count (1-indexed)
  console.log("Remittance ID:", remittanceId.toString());

  // ── 5. Poll for status changes ─────────────────────────────────────────────
  console.log("Polling for status…");
  let remittance = await client.getRemittance(senderKeypair.publicKey(), remittanceId);
  const maxPolls = 10;
  for (let i = 0; i < maxPolls; i++) {
    console.log(`  status: ${remittance.status} (poll ${i + 1}/${maxPolls})`);
    if (remittance.status !== "Pending") break;
    await new Promise((r) => setTimeout(r, 3000));
    remittance = await client.getRemittance(senderKeypair.publicKey(), remittanceId);
  }

  if (remittance.status !== "Processing" && remittance.status !== "Pending") {
    console.log("Remittance reached terminal status:", remittance.status);
    return;
  }

  // ── 6. Agent confirms payout ───────────────────────────────────────────────
  console.log("Agent confirming payout…");
  try {
    const confirmTx = await client.confirmPayout(agentAddress, remittanceId);
    const confirmResult = await client.submitTransaction(confirmTx, agentKeypair);
    console.log("✓ Payout confirmed, tx hash:", confirmResult.hash);
  } catch (err: any) {
    console.error("confirmPayout failed:", err.message ?? err);
    throw err;
  }

  // ── 7. Verify completion ───────────────────────────────────────────────────
  const final = await client.getRemittance(senderKeypair.publicKey(), remittanceId);
  if (final.status !== "Completed") {
    throw new Error(`Expected Completed, got ${final.status}`);
  }
  console.log("✓ Remittance completed successfully");
  console.log(`  Amount: ${fromStroops(final.amount)} USDC`);
  console.log(`  Fee:    ${fromStroops(final.fee)} USDC`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

## Running against testnet

```bash
cp .env.testnet .env
# Fill in SENDER_SECRET and AGENT_SECRET with funded testnet keypairs
npx ts-node quickstart.ts
```

Get testnet funds from the [Stellar Friendbot](https://friendbot.stellar.org/?addr=YOUR_ADDRESS).

## Error handling reference

| Error | Cause | Fix |
|---|---|---|
| `AgentNotRegistered` | Agent address not in contract | Admin calls `registerAgent()` |
| `InsufficientFunds` | Sender balance too low | Fund the account or reduce amount |
| `KycExpired` (code 23) | Sender KYC has expired | Renew KYC via your anchor |
| `DailyLimitExceeded` | Corridor daily cap hit | Wait for reset or use a different corridor |
| `Simulation failed` | RPC or contract error | Check `SOROBAN_RPC_URL` and `CONTRACT_ID` |
