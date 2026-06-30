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

const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('./logger');
let logger = createLogger('net-settlement-example');

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
  logger.info('=== Example 1: Simple Offset ===');

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

  logger.info({
    remittances: [
      { from: 'Alice', to: 'Bob', amount: 100 },
      { from: 'Bob', to: 'Alice', amount: 90 }
    ],
    expected_net: 'Alice → Bob: 10 USDC'
  }, 'Remittances to settle');

  try {
    const result = await batchSettleWithNetting(entries);
    logger.info({
      settled_count: result.settled_ids.length,
      settled_ids: result.settled_ids,
      transfers_executed: 1,
      gas_savings: '~50%'
    }, 'Settlement successful');
  } catch (error) {
    logger.error({ error: error.message }, 'Settlement failed');
  }
}

/**
 * Example 2: Complete Offset
 * 
 * Demonstrates complete offsetting where net transfer is zero.
 */
async function exampleCompleteOffset() {
  logger.info('=== Example 2: Complete Offset ===');

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

  logger.info({
    remittances: [
      { from: 'Alice', to: 'Bob', amount: 100 },
      { from: 'Bob', to: 'Alice', amount: 100 }
    ],
    expected_net: 'None (complete offset)'
  }, 'Remittances to settle');

  try {
    const result = await batchSettleWithNetting(entries);
    logger.info({
      settled_count: result.settled_ids.length,
      settled_ids: result.settled_ids,
      transfers_executed: 0,
      gas_savings: '~100%'
    }, 'Settlement successful');
  } catch (error) {
    logger.error({ error: error.message }, 'Settlement failed');
  }
}

/**
 * Example 3: Multiple Parties
 * 
 * Demonstrates netting with multiple parties in a triangle pattern.
 */
async function exampleMultipleParties() {
  logger.info('=== Example 3: Multiple Parties ===');

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

  logger.info({
    remittances: [
      { from: 'Alice', to: 'Bob', amount: 100 },
      { from: 'Bob', to: 'Charlie', amount: 50 },
      { from: 'Charlie', to: 'Alice', amount: 30 }
    ],
    expected_net: '3 net transfers'
  }, 'Remittances to settle');

  try {
    const result = await batchSettleWithNetting(entries);
    logger.info({
      settled_count: result.settled_ids.length,
      settled_ids: result.settled_ids,
      transfers_executed: 3
    }, 'Settlement successful');
  } catch (error) {
    logger.error({ error: error.message }, 'Settlement failed');
  }
}

/**
 * Example 4: Large Batch with Maximum Netting
 * 
 * Demonstrates efficient batch processing with high netting ratio.
 */
async function exampleLargeBatch() {
  logger.info('=== Example 4: Large Batch ===');

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

  logger.info({
    count: 10,
    patterns: [
      '5 × Alice → Bob: 100 USDC each',
      '5 × Bob → Alice: 100 USDC each'
    ],
    expected_net: 'None (complete offset)'
  }, 'Remittances to settle');

  try {
    const result = await batchSettleWithNetting(entries);
    logger.info({
      settled_count: result.settled_ids.length,
      transfers_executed: 0,
      gas_savings: '~100%',
      efficiency: '100%'
    }, 'Settlement successful');
  } catch (error) {
    logger.error({ error: error.message }, 'Settlement failed');
  }
}

/**
 * Example 5: Error Handling
 * 
 * Demonstrates proper error handling for common issues.
 */
async function exampleErrorHandling() {
  logger.info('=== Example 5: Error Handling ===');

  // Test 1: Empty batch
  logger.info('Test 1: Empty batch');
  try {
    await batchSettleWithNetting([]);
    logger.error('Should have thrown error');
  } catch (error) {
    logger.info({ error: error.message }, 'Correctly rejected empty batch');
  }

  // Test 2: Duplicate IDs
  logger.info('Test 2: Duplicate IDs');
  try {
    const entries = [
      { remittance_id: 1n },
      { remittance_id: 1n }, // Duplicate
    ];
    await batchSettleWithNetting(entries);
    logger.error('Should have thrown error');
  } catch (error) {
    logger.info({ error: error.message }, 'Correctly rejected duplicate IDs');
  }

  // Test 3: Batch too large
  logger.info('Test 3: Batch exceeds maximum size');
  try {
    const entries = [];
    for (let i = 0; i < 51; i++) {
      entries.push({ remittance_id: BigInt(i) });
    }
    await batchSettleWithNetting(entries);
    logger.error('Should have thrown error');
  } catch (error) {
    logger.info({ error: error.message }, 'Correctly rejected oversized batch');
  }
}

/**
 * Example 6: Monitoring and Analytics
 * 
 * Demonstrates how to monitor settlements and calculate efficiency metrics.
 */
async function exampleMonitoring() {
  logger.info('=== Example 6: Monitoring and Analytics ===');

  // Subscribe to settlement events
  logger.info('Subscribing to settlement events...');

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

    logger.info({
      sender,
      recipient,
      amount,
      timestamp: new Date(timestamp * 1000).toISOString()
    }, 'Net Settlement Event');
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

    logger.info({
      remittance_id,
      sender,
      agent,
      amount
    }, 'Remittance Completed');
  });

  logger.info('Listening for events...');
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
  logger.info({ metrics }, 'Netting Efficiency Metrics');
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
  const requestId = process.env.REQUEST_ID || uuidv4();
  logger = createLogger('net-settlement-example', requestId);
  logger.info('=== SwiftRemit Net Settlement Examples ===');

  try {
    // Run examples
    await exampleSimpleOffset();
    await exampleCompleteOffset();
    await exampleMultipleParties();
    await exampleLargeBatch();
    await exampleErrorHandling();

    // Display sample metrics
    logger.info('=== Sample Metrics ===');
    const metrics1 = calculateMetrics(10, 2);
    displayMetrics(metrics1);

    const metrics2 = calculateMetrics(50, 5);
    displayMetrics(metrics2);

    // Uncomment to run monitoring example
    // await exampleMonitoring();

  } catch (error) {
    logger.error({ error: error.message }, 'Error running examples');
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
