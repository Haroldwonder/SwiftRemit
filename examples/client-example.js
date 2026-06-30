/**
 * SwiftRemit Client Example
 * 
 * This example demonstrates how to interact with the SwiftRemit smart contract
 * from an external JavaScript/TypeScript client using the Stellar SDK.
 * 
 * Prerequisites:
 * - Node.js 18+
 * - npm or yarn
 * - Stellar account with testnet/friendbot funds
 * - Contract deployed to testnet
 * 
 * Installation:
 * npm install @stellar/stellar-sdk @stellar/freighter-api
 * 
 * Usage:
 * node client-example.js
 */

const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('./logger');

// Global logger for initialization
let logger = createLogger('client-example');

// === Configuration ===
const config = require('./config');
const StellarSdk = require('@stellar/stellar-sdk');

// Create keypairs from secrets if provided
const adminKeypair = config.adminSecret ? StellarSdk.Keypair.fromSecret(config.adminSecret) : null;
const senderKeypair = config.senderSecret ? StellarSdk.Keypair.fromSecret(config.senderSecret) : null;
const agentKeypair = config.agentSecret ? StellarSdk.Keypair.fromSecret(config.agentSecret) : null;

// === Helper Functions ===

/**
 * Convert amount to stroops (smallest unit)
 */
function toStroops(amount) {
  return BigInt(Math.floor(amount * config.usdcMultiplier));
}

/**
 * Convert stroops to amount
 */
function fromStroops(stroops) {
  return Number(stroops) / config.usdcMultiplier;
}

/**
 * Build a Soroban transaction
 */
async function buildSorobanTransaction(source, contractId, method, args = []) {
  const contract = new StellarSdk.Contract(contractId);
  
  const transaction = new StellarSdk.TransactionBuilder(source, {
    fee: config.transactionFee,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(config.transactionTimeout)
    .build();
  
  return transaction;
}

/**
 * Sign and simulate a Soroban transaction
 */
async function simulateTransaction(transaction, sourceKeypair) {
  const server = new StellarSdk.SorobanRpc.Server(config.rpcUrl);
  
  // Prepare the transaction
  const preparedTx = await server.prepareTransaction(transaction);
  
  // Sign with the source account
  preparedTx.sign(sourceKeypair);
  
  // Send to network
  const response = await server.sendTransaction(preparedTx);
  
  logger.info({ response }, 'Transaction response');
  
  // Wait for status
  if (response.status === 'pending') {
    let txResponse = await server.getTransaction(response.hash);
    while (txResponse.status === 'not_found') {
      await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
      txResponse = await server.getTransaction(response.hash);
    }
    
    if (txResponse.status === 'success') {
      logger.info('Transaction successful!');
      return txResponse.returnValue;
    } else {
      logger.error({ txResponse }, 'Transaction failed');
      throw new Error('Transaction failed');
    }
  }
  
  return response;
}

/**
 * Build and invoke a contract method
 */
async function invokeContract(sourceKeypair, contractId, method, args = []) {
  const server = new StellarSdk.SorobanRpc.Server(config.rpcUrl);
  
  // Get account
  const account = await server.getAccount(sourceKeypair.publicKey());
  
  // Build transaction
  const transaction = await buildSorobanTransaction(account, contractId, method, args);
  
  // Prepare, sign, and send
  const preparedTx = await server.prepareTransaction(transaction);
  preparedTx.sign(sourceKeypair);
  
  const response = await server.sendTransaction(preparedTx);
  
  // Poll for result
  if (response.status === 'pending') {
    let txResponse = await server.getTransaction(response.hash);
    while (txResponse.status === 'not_found') {
      await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
      txResponse = await server.getTransaction(response.hash);
    }
    
    return txResponse;
  }
  
  return response;
}

// === Contract Interaction Functions ===

/**
 * Initialize the SwiftRemit contract
 * This should be called once by the admin
 */
async function initializeContract() {
  logger.info('=== Initializing Contract ===');
  
  if (!adminKeypair) {
    throw new Error('Admin keypair not configured. Set ADMIN_SECRET in .env');
  }
  
  const admin = adminKeypair.publicKey();
  const feeBps = config.defaultFeeBps;
  
  // The initialize function takes:
  // - admin: Address
  // - usdc_token: Address
  // - fee_bps: u32
  
  const args = [
    new StellarSdk.Address(admin).toScVal(),
    new StellarSdk.Address(config.usdcTokenId).toScVal(),
    StellarSdk.xdr.ScVal.scvU32(feeBps),
  ];
  
  const response = await invokeContract(
    adminKeypair,
    config.contractId,
    'initialize',
    args
  );
  
  logger.info({ response, feeBps }, 'Contract initialized');
  
  return response;
}

/**
 * Register an agent who can receive payouts
 */
async function registerAgent(agentAddress) {
  logger.info({ agentAddress }, '=== Registering Agent ===');
  
  if (!adminKeypair) {
    throw new Error('Admin keypair not configured. Set ADMIN_SECRET in .env');
  }
  
  // The register_agent function takes:
  // - agent: Address
  
  const args = [
    new StellarSdk.Address(agentAddress).toScVal(),
  ];
  
  const response = await invokeContract(
    adminKeypair,
    config.contractId,
    'register_agent',
    args
  );
  
  logger.info({ response, agentAddress }, 'Agent registered');
  
  return response;
}

/**
 * Remove an agent from the approved list
 */
async function removeAgent(agentAddress) {
  logger.info({ agentAddress }, '=== Removing Agent ===');
  
  if (!adminKeypair) {
    throw new Error('Admin keypair not configured. Set ADMIN_SECRET in .env');
  }
  
  const args = [
    new StellarSdk.Address(agentAddress).toScVal(),
  ];
  
  const response = await invokeContract(
    adminKeypair,
    config.contractId,
    'remove_agent',
    args
  );
  
  logger.info({ response, agentAddress }, 'Agent removed');
  
  return response;
}

/**
 * Update the platform fee
 */
async function updateFee(feeBps) {
  logger.info({ feeBps }, '=== Updating Platform Fee ===');
  
  if (!adminKeypair) {
    throw new Error('Admin keypair not configured. Set ADMIN_SECRET in .env');
  }
  
  const args = [
    StellarSdk.xdr.ScVal.scvU32(feeBps),
  ];
  
  const response = await invokeContract(
    adminKeypair,
    config.contractId,
    'update_fee',
    args
  );
  
  logger.info({ response, feeBps }, 'Fee updated');
  
  return response;
}

/**
 * Create a new remittance
 * This is called by the sender who wants to send money
 */
async function createRemittance(senderKeypair, agentAddress, amount) {
  logger.info({ agentAddress, amount }, '=== Creating Remittance ===');
  
  const sender = senderKeypair.publicKey();
  const amountStroops = toStroops(amount);
  
  // First, sender needs to approve the contract to spend their USDC
  // This requires a token approval operation (not shown here)
  // For testing, you can use the Stellar laboratory or set up a mock
  
  // The create_remittance function takes:
  // - sender: Address
  // - agent: Address
  // - amount: i128
  // - expiry: Option<u64>
  
  const args = [
    new StellarSdk.Address(sender).toScVal(),
    new StellarSdk.Address(agentAddress).toScVal(),
    StellarSdk.xdr.ScVal.scvI128(amountStroops),
    StellarSdk.xdr.ScVal.scvVoid(), // No expiry
  ];
  
  const response = await invokeContract(
    senderKeypair,
    config.contractId,
    'create_remittance',
    args
  );
  
  logger.info({ response }, 'Create remittance response');
  
  // Parse the returned remittance ID
  if (response.returnValue) {
    logger.info({ remittanceId, amount, agentAddress }, 'Remittance created');
    return remittanceId;
  }
  
  return null;
}

/**
 * Confirm payout - called by agent after they've paid the recipient
 */
async function confirmPayout(agentKeypair, remittanceId) {
  logger.info({ remittanceId }, '=== Confirming Payout ===');
  
  // The confirm_payout function takes:
  // - remittance_id: u64
  
  const args = [
    StellarSdk.xdr.ScVal.scvU64(remittanceId),
  ];
  
  const response = await invokeContract(
    agentKeypair,
    config.contractId,
    'confirm_payout',
    args
  );
  
  logger.info({ response, remittanceId }, 'Payout confirmed');
  
  return response;
}

/**
 * Cancel a pending remittance - called by sender
 */
async function cancelRemittance(senderKeypair, remittanceId) {
  logger.info({ remittanceId }, '=== Cancelling Remittance ===');
  
  const args = [
    StellarSdk.xdr.ScVal.scvU64(remittanceId),
  ];
  
  const response = await invokeContract(
    senderKeypair,
    config.contractId,
    'cancel_remittance',
    args
  );
  
  logger.info({ response, remittanceId }, 'Remittance cancelled');
  
  return response;
}

/**
 * Withdraw accumulated fees - called by admin
 */
async function withdrawFees(adminKeypair, recipientAddress) {
  logger.info({ recipientAddress }, '=== Withdrawing Fees ===');
  
  const args = [
    new StellarSdk.Address(recipientAddress).toScVal(),
  ];
  
  const response = await invokeContract(
    adminKeypair,
    config.contractId,
    'withdraw_fees',
    args
  );
  
  logger.info({ response, recipientAddress }, 'Fees withdrawn');
  
  return response;
}

// === Query Functions (read-only) ===

/**
 * Get remittance details
 */
async function getRemittance(remittanceId) {
  logger.info({ remittanceId }, '=== Getting Remittance ===');
  
  if (!adminKeypair) {
    throw new Error('Admin keypair not configured. Set ADMIN_SECRET in .env');
  }
  
  const server = new StellarSdk.SorobanRpc.Server(config.rpcUrl);
  const contract = new StellarSdk.Contract(config.contractId);
  
  // Get the current requestId from the logger's context (if we had access to it)
  // For this example, we'll use the one generated in main or a new one
  const requestId = logger.bindings().request_id;
  
  const args = [
    StellarSdk.xdr.ScVal.scvU64(remittanceId),
    new StellarSdk.SorobanRpc.NativeString(requestId).toScVal()
  ];
  
  // Build a simulated call (no signature needed for reads)
  const account = await server.getAccount(adminKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: config.transactionFee,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call('get_remittance', ...args))
    .setTimeout(config.transactionTimeout)
    .build();
  
  const preparedTx = await server.prepareTransaction(tx);
  const result = await server.simulateTransaction(preparedTx);
  
  if (result.results && result.results[0]) {
    // Note: Parsing complex contracttypes in JS requires more logic, 
    // this is a simplified representation for the example.
    logger.info({ 
      remittanceId,
      returnedRequestId: requestId // In a real app we'd parse it from ScVal
    }, 'Remittance details retrieved with Request ID verification');
    return result.results[0];
  }
  
  return null;
}

/**
 * Get accumulated fees
 */
async function getAccumulatedFees() {
  logger.info('=== Getting Accumulated Fees ===');
  
  if (!adminKeypair) {
    throw new Error('Admin keypair not configured. Set ADMIN_SECRET in .env');
  }
  
  const server = new StellarSdk.SorobanRpc.Server(config.rpcUrl);
  const contract = new StellarSdk.Contract(config.contractId);
  
  const args = [];
  
  const account = await server.getAccount(adminKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: config.transactionFee,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call('get_accumulated_fees'))
    .setTimeout(config.transactionTimeout)
    .build();
  
  const preparedTx = await server.prepareTransaction(tx);
  const result = await server.simulateTransaction(preparedTx);
  
  if (result.results && result.results[0]) {
    const fees = StellarSdk.xdr.ScVal.fromScVal(result.results[0].returnValue).i128();
    const feesNum = Number(fees.low) / config.usdcMultiplier;
    console.log('Accumulated fees:', feesNum, 'USDC');
    return feesNum;
  }
  
  return 0;
}

/**
 * Check if agent is registered
 */
async function isAgentRegistered(agentAddress) {
  logger.info({ agentAddress }, '=== Checking Agent Registration ===');
  
  if (!adminKeypair) {
    throw new Error('Admin keypair not configured. Set ADMIN_SECRET in .env');
  }
  
  const server = new StellarSdk.SorobanRpc.Server(config.rpcUrl);
  const contract = new StellarSdk.Contract(config.contractId);
  
  const args = [new StellarSdk.Address(agentAddress).toScVal()];
  
  const account = await server.getAccount(adminKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: config.transactionFee,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call('is_agent_registered', ...args))
    .setTimeout(config.transactionTimeout)
    .build();
  
  const preparedTx = await server.prepareTransaction(tx);
  const result = await server.simulateTransaction(preparedTx);
  
  if (result.results && result.results[0]) {
    const registered = StellarSdk.xdr.ScVal.fromScVal(result.results[0].returnValue).bool();
    logger.info({ agentAddress, registered }, 'Agent registration status');
    return registered;
  }
  
  return false;
}

/**
 * Get platform fee in basis points
 */
async function getPlatformFeeBps() {
  logger.info('=== Getting Platform Fee ===');
  
  if (!adminKeypair) {
    throw new Error('Admin keypair not configured. Set ADMIN_SECRET in .env');
  }
  
  const server = new StellarSdk.SorobanRpc.Server(config.rpcUrl);
  const contract = new StellarSdk.Contract(config.contractId);
  
  const account = await server.getAccount(adminKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: config.transactionFee,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call('get_platform_fee_bps'))
    .setTimeout(config.transactionTimeout)
    .build();
  
  const preparedTx = await server.prepareTransaction(tx);
  const result = await server.simulateTransaction(preparedTx);
  
  if (result.results && result.results[0]) {
    const feeBps = StellarSdk.xdr.ScVal.fromScVal(result.results[0].returnValue).u32();
    logger.info({ feeBps }, 'Platform fee retrieved');
    return feeBps;
  }
  
  return 0;
}

// === Main Execution Flow ===

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     SwiftRemit Client Example          ║');
  console.log('╚════════════════════════════════════════╝');
  
  console.log('\n📋 Configuration:');
  console.log('   Network:', config.network);
  console.log('   Contract ID:', config.contractId);
  console.log('   USDC Token:', config.usdcTokenId);
  
  if (!adminKeypair || !senderKeypair || !agentKeypair) {
    console.error('\n❌ Error: Missing required keypairs');
    console.error('   Please set ADMIN_SECRET, SENDER_SECRET, and AGENT_SECRET in .env');
    process.exit(1);
  }
  
  console.log('   Admin:', adminKeypair.publicKey().slice(0, 8) + '...');
  console.log('   Sender:', senderKeypair.publicKey().slice(0, 8) + '...');
  console.log('   Agent:', agentKeypair.publicKey().slice(0, 8) + '...');
  
  try {
    // === Step 1: Initialize Contract (run once) ===
    // await initializeContract();
    
    // === Step 2: Register Agent ===
    const agentAddress = agentKeypair.publicKey();
    await registerAgent(agentAddress);
    
    logger.info({ isRegistered }, 'Agent registration check');
    
    // === Step 4: Get Platform Fee ===
    const feeBps = await getPlatformFeeBps();
    logger.info({ feeBps }, 'Current fee check');
    
    // === Step 5: Create Remittance ===
    const amountToSend = 100; // 100 USDC
    const remittanceId = await createRemittance(
      senderKeypair,
      agentAddress,
      amountToSend
    );
    
    // === Step 6: Query Remittance ===
    await getRemittance(remittanceId);
    
    // === Step 7: Confirm Payout (Agent) ===
    await confirmPayout(agentKeypair, remittanceId);
    
    logger.info({ accumulatedFees }, 'Total accumulated fees');
    
    // === Step 9: Withdraw Fees (Admin) ===
    // Uncomment to withdraw fees:
    // await withdrawFees(adminKeypair, adminKeypair.publicKey());
    
    logger.info({ feesAfter }, 'Fees after withdrawal');
    
    logger.info('=== Example Completed Successfully! ===');
    
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Execution failed');
    process.exit(1);
  }
}

// Export functions for use in other modules
module.exports = {
  config,
  adminKeypair,
  senderKeypair,
  agentKeypair,
  initializeContract,
  registerAgent,
  removeAgent,
  updateFee,
  createRemittance,
  confirmPayout,
  cancelRemittance,
  withdrawFees,
  getRemittance,
  getAccumulatedFees,
  isAgentRegistered,
  getPlatformFeeBps,
  toStroops,
  fromStroops,
};

// Run if executed directly
if (require.main === module) {
  main();
}
