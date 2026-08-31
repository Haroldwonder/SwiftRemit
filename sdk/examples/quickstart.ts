// Runnable end-to-end example: connect wallet → create remittance → monitor status → confirm payout.
// See ../../GETTING_STARTED.md for the required .env values and a step-by-step walkthrough.
import { SwiftRemitClient, toStroops, fromStroops, parseU64ReturnValue } from "../src";
import { Keypair } from "@stellar/stellar-sdk";
import * as dotenv from "dotenv";

dotenv.config();

const client = new SwiftRemitClient({
  contractId: process.env.CONTRACT_ID!,
  networkPassphrase: process.env.NETWORK_PASSPHRASE!,
  rpcUrl: process.env.SOROBAN_RPC_URL!,
});

const senderKeypair = Keypair.fromSecret(process.env.SENDER_SECRET!);
const agentKeypair = Keypair.fromSecret(process.env.AGENT_SECRET!);

async function main() {
  const agentAddress = agentKeypair.publicKey();
  const isRegistered = await client.isAgentRegistered(senderKeypair.publicKey(), agentAddress);
  if (!isRegistered) {
    throw new Error(`Agent ${agentAddress} is not registered. Ask an admin to call registerAgent().`);
  }
  console.log("✓ Agent is registered");

  const amount = toStroops(50); // 50 USDC in stroops
  const quote = await client.estimateFee(
    amount,
    { currency: "USD", country: "US" },
    senderKeypair.publicKey()
  );
  console.log(`Fee quote: ${fromStroops(quote.totalFee)} USDC, net: ${fromStroops(quote.netAmount)} USDC`);

  // NOTE: the contract pulls USDC from the sender via token.transfer_from, so the
  // sender must approve the contract to spend amount + fee first, using the USDC
  // SAC's `approve` method. Omitted here — see the Stellar SAC docs.

  console.log("Creating remittance…");
  const tx = await client.createRemittance({
    sender: senderKeypair.publicKey(),
    agent: agentAddress,
    amount,
    token: process.env.USDC_TOKEN!,
  });
  const result = await client.submitTransaction(tx, senderKeypair);
  console.log("✓ Remittance created, tx hash:", result.hash);

  // create_remittance returns the new ID as the transaction's return value.
  // Do not use getRemittanceCount() here — it reports the contract's current
  // counter, which concurrent senders may already have advanced past.
  const remittanceId = parseU64ReturnValue(result);
  console.log("Remittance ID:", remittanceId.toString());

  console.log("Polling for status…");
  let remittance = await client.getRemittance(senderKeypair.publicKey(), remittanceId);
  const maxPolls = 10;
  for (let i = 0; i < maxPolls && remittance.status === "Pending"; i++) {
    console.log(`  status: ${remittance.status} (poll ${i + 1}/${maxPolls})`);
    await new Promise((r) => setTimeout(r, 3000));
    remittance = await client.getRemittance(senderKeypair.publicKey(), remittanceId);
  }

  if (remittance.status !== "Processing" && remittance.status !== "Pending") {
    console.log("Remittance reached terminal status:", remittance.status);
    return;
  }

  console.log("Agent confirming payout…");
  const confirmTx = await client.confirmPayout(agentAddress, remittanceId);
  const confirmResult = await client.submitTransaction(confirmTx, agentKeypair);
  console.log("✓ Payout confirmed, tx hash:", confirmResult.hash);

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
