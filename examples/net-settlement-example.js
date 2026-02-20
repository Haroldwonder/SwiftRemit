/**
 * Net Settlement Example for SwiftRemit
 * 
 * This example demonstrates how to use the batch settlement with netting
 * functionality to optimize on-chain transfers by offsetting opposing flows.
 */

const {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
} = require('@stellar/stellar-sdk');

// Configuration
const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  contractId: process.env.CONTRACT_ID,
};

// Initialize RPC server
const server = new SorobanRpc.Server(config.rpcUrl);

/**
 * Example 1: Simple Offset
 * 
 * Demonstrates basic netting between two parties with opposing transfers.
 */
async function exampleSimpleOffset() {
  console.log('\n=== Example 1: Simple Offset ===\n');

  // Scenario:
  // - Alice sends 100 USDC to Bob
  // - Bob sends 90 USDC to Alice
  // Expected: Net transfer of 10 USDC from Alice to Bob

  const remittanceIds = [
    1n, // Alice -> Bob: 100
    2n, // Bob -> Alice: 90
  ];

  const entries = remittanceIds.map(id => ({
    remittance_id: id
  }));

  console.log('Remittances to settle:');
  console.log('  1. Alice → Bob: 100 USDC');
  console.log('  2. Bob → Alice: 90 USDC');
  console.log('\nExpected net transfer: Alice → Bob: 10 USDC');

  try {
    const result = await batchSettleWithNetting(entries);
    console.log(`\n✓ Successfully settled ${result.settled_ids.length} remittances`);
    console.log(`  Settled IDs: ${result.settled_ids.join(', ')}`);
    console.log('  Net transfers executed: 1 (instead of 2)');
    console.log('  Gas savings: ~50%');
  } catch (error) {
    console.error('✗ Error:', error.message);
  }
}

/**
 * Example 2: Complete Offset
 * 
 * Demonstrates complete offsetting where net transfer is zero.
 */
async function exampleCompleteOffset() {
  console.log('\n=== Example 2: Complete Offset ===\n');

  // Scenario:
  // - Alice sends 100 USDC to Bob
  // - Bob sends 100 USDC to Alice
  // Expected: No net transfer (complete offset)

  const remittanceIds = [
    3n, // Alice -> Bob: 100
    4n, // Bob -> Alice: 100
  ];

  const entries = remittanceIds.map(id => ({
    remittance_id: id
  }));

  console.log('Remittances to settle:');
  console.log('  3. Alice → Bob: 100 USDC');
  console.log('  4. Bob → Alice: 100 USDC');
  console.log('\nExpected net transfer: None (complete offset)');

  try {
    const result = await batchSettleWithNetting(entries);
    console.log(`\n✓ Successfully settled ${result.settled_ids.length} remittances`);
    console.log(`  Settled IDs: ${result.settled_ids.join(', ')}`);
    console.log('  Net transfers executed: 0 (complete offset)');
    console.log('  Gas savings: ~100%');
    console.log('  Note: Fees still collected from both remittances');
  } catch (error) {
    console.error('✗ Error:', error.message);
  }
}

/**
 * Example 3: Multiple Parties
 * 
 * Demonstrates netting with multiple parties in a triangle pattern.
 */
async function exampleMultipleParties() {
  console.log('\n=== Example 3: Multiple Parties ===\n');

  // Scenario:
  // - Alice sends 100 USDC to Bob
  // - Bob sends 50 USDC to Charlie
  // - Charlie sends 30 USDC to Alice
  // Expected: Three separate net transfers (one per pair)

  const remittanceIds = [
    5n, // Alice -> Bob: 100
    6n, // Bob -> Charlie: 50
    7n, // Charlie -> Alice: 30
  ];

  const entries = remittanceIds.map(id => ({
    remittance_id: id
  }));

  console.log('Remittances to settle:');
  console.log('  5. Alice → Bob: 100 USDC');
  console.log('  6. Bob → Charlie: 50 USDC');
  console.log('  7. Charlie → Alice: 30 USDC');
  console.log('\nExpected: 3 net transfers (no offsetting between different pairs)');

  try {
    const result = await batchSettleWithNetting(entries);
    console.log(`\n✓ Successfully settled ${result.settled_ids.length} remittances`);
    console.log(`  Settled IDs: ${result.settled_ids.join(', ')}`);
    console.log('  Net transfers executed: 3');
  } catch (error) {
    console.error('✗ Error:', error.message);
  }
}

/**
 * Example 4: Large Batch with Maximum Netting
 * 
 * Demonstrates efficient batch processing with high netting ratio.
 */
async function exampleLargeBatch() {
  console.log('\n=== Example 4: Large Batch ===\n');

  // Scenario:
  // - 10 remittances: 5 from Alice to Bob, 5 from Bob to Alice
  // - All amounts are 100 USDC
  // Expected: Complete offset (no net transfer)

  const remittanceIds = [];
  for (let i = 8; i < 18; i++) {
    remittanceIds.push(BigInt(i));
  }

  const entries = remittanceIds.map(id => ({
    remittance_id: id
  }));

  console.log('Remittances to settle: 10 remittances');
  console.log('  5 × Alice → Bob: 100 USDC each');
  console.log('  5 × Bob → Alice: 100 USDC each');
  console.log('\nExpected net transfer: None (complete offset)');

  try {
    const result = await batchSettleWithNetting(entries);
    console.log(`\n✓ Successfully settled ${result.settled_ids.length} remittances`);
    console.log('  Net transfers executed: 0 (complete offset)');
    console.log('  Gas savings: ~100%');
    console.log('  Netting efficiency: 100%');
  } catch (error) {
    console.error('✗ Error:', error.message);
  }
}

/**
 * Example 5: Error Handling
 * 
 * Demonstrates proper error handling for common issues.
 */
async function exampleErrorHandling() {
  console.log('\n=== Example 5: Error Handling ===\n');

  // Test 1: Empty batch
  console.log('Test 1: Empty batch');
  try {
    await batchSettleWithNetting([]);
    console.log('✗ Should have thrown error');
  } catch (error) {
    console.log('✓ Correctly rejected empty batch');
    console.log(`  Error: ${error.message}`);
  }

  // Test 2: Duplicate IDs
  console.log('\nTest 2: Duplicate IDs');
  try {
    const entries = [
      { remittance_id: 1n },
      { remittance_id: 1n }, // Duplicate
    ];
    await batchSettleWithNetting(entries);
    console.log('✗ Should have thrown error');
  } catch (error) {
    console.log('✓ Correctly rejected duplicate IDs');
    console.log(`  Error: ${error.message}`);
  }

  // Test 3: Batch too large
  console.log('\nTest 3: Batch exceeds maximum size');
  try {
    const entries = [];
    for (let i = 0; i < 51; i++) {
      entries.push({ remittance_id: BigInt(i) });
    }
    await batchSettleWithNetting(entries);
    console.log('✗ Should have thrown error');
  } catch (error) {
    console.log('✓ Correctly rejected oversized batch');
    console.log(`  Error: ${error.message}`);
  }
}

/**
 * Example 6: Monitoring and Analytics
 * 
 * Demonstrates how to monitor settlements and calculate efficiency metrics.
 */
async function exampleMonitoring() {
  console.log('\n=== Example 6: Monitoring and Analytics ===\n');

  // Subscribe to settlement events
  console.log('Subscribing to settlement events...\n');

  const currentLedger = await server.getLatestLedger();

  // Listen for net settlement events
  const settlementStream = server.getEvents({
    contractIds: [config.contractId],
    topics: [['settle', 'complete']],
    startLedger: currentLedger.sequence,
  });

  settlementStream.on('message', (event) => {
    const [
      schema_version,
      sequence,
      timestamp,
      sender,
      recipient,
      token,
      amount,
    ] = event.value;

    console.log('Net Settlement Event:');
    console.log(`  Sender: ${sender}`);
    console.log(`  Recipient: ${recipient}`);
    console.log(`  Amount: ${amount}`);
    console.log(`  Timestamp: ${new Date(timestamp * 1000).toISOString()}`);
  });

  // Listen for remittance completion events
  const remittanceStream = server.getEvents({
    contractIds: [config.contractId],
    topics: [['remit', 'complete']],
    startLedger: currentLedger.sequence,
  });

  remittanceStream.on('message', (event) => {
    const [
      schema_version,
      sequence,
      timestamp,
      remittance_id,
      sender,
      agent,
      token,
      amount,
    ] = event.value;

    console.log('Remittance Completed:');
    console.log(`  ID: ${remittance_id}`);
    console.log(`  Sender: ${sender}`);
    console.log(`  Agent: ${agent}`);
    console.log(`  Amount: ${amount}`);
  });

  console.log('Listening for events... (Press Ctrl+C to stop)');
}

/**
 * Calculate netting efficiency metrics
 */
function calculateMetrics(originalCount, netTransferCount) {
  const savedTransfers = originalCount - netTransferCount;
  const efficiency = (savedTransfers / originalCount) * 100;
  const gasPerTransfer = 30000;
  const gasSaved = savedTransfers * gasPerTransfer;

  return {
    originalCount,
    netTransferCount,
    savedTransfers,
    efficiency: efficiency.toFixed(2),
    gasSaved,
  };
}

/**
 * Display metrics
 */
function displayMetrics(metrics) {
  console.log('\nNetting Efficiency Metrics:');
  console.log(`  Original transfers: ${metrics.originalCount}`);
  console.log(`  Net transfers: ${metrics.netTransferCount}`);
  console.log(`  Saved transfers: ${metrics.savedTransfers}`);
  console.log(`  Efficiency: ${metrics.efficiency}%`);
  console.log(`  Gas saved: ~${metrics.gasSaved.toLocaleString()} units`);
}

/**
 * Helper function to call batch_settle_with_netting
 */
async function batchSettleWithNetting(entries) {
  // This is a placeholder - actual implementation would use Stellar SDK
  // to build and submit the transaction
  
  const contract = new Contract(config.contractId);
  
  // Build transaction
  const account = await server.getAccount(sourceKeypair.publicKey());
  
  const transaction = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      contract.call('batch_settle_with_netting', {
        entries: entries,
      })
    )
    .setTimeout(30)
    .build();

  // Sign and submit
  transaction.sign(sourceKeypair);
  const response = await server.sendTransaction(transaction);

  // Wait for confirmation
  let status = await server.getTransaction(response.hash);
  while (status.status === 'PENDING' || status.status === 'NOT_FOUND') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    status = await server.getTransaction(response.hash);
  }

  if (status.status === 'SUCCESS') {
    // Parse result
    const result = status.returnValue;
    return {
      settled_ids: result.settled_ids,
    };
  } else {
    throw new Error(`Transaction failed: ${status.status}`);
  }
}

/**
 * Main function to run all examples
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     SwiftRemit Net Settlement Examples                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    // Run examples
    await exampleSimpleOffset();
    await exampleCompleteOffset();
    await exampleMultipleParties();
    await exampleLargeBatch();
    await exampleErrorHandling();

    // Display sample metrics
    console.log('\n=== Sample Metrics ===\n');
    const metrics1 = calculateMetrics(10, 2);
    displayMetrics(metrics1);

    const metrics2 = calculateMetrics(50, 5);
    displayMetrics(metrics2);

    // Uncomment to run monitoring example
    // await exampleMonitoring();

  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  batchSettleWithNetting,
  calculateMetrics,
  displayMetrics,
};
