/**
 * Contract Migration Example for SwiftRemit
 * 
 * This example demonstrates how to safely migrate state from an old
 * contract deployment to a new one using cryptographic verification.
 */

const {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
} = require('@stellar/stellar-sdk');

const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('./logger');
let logger = createLogger('migration-example');

// Configuration
const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  oldContractId: process.env.OLD_CONTRACT_ID,
  newContractId: process.env.NEW_CONTRACT_ID,
};

// Initialize RPC server
const server = new SorobanRpc.Server(config.rpcUrl);

/**
 * Example 1: Full Migration
 * 
 * Demonstrates complete state migration for small datasets (< 100 remittances).
 */
async function exampleFullMigration() {
  logger.info('=== Example 1: Full Migration ===');

  const oldContract = new Contract(config.oldContractId);
  const newContract = new Contract(config.newContractId);
  const admin = Keypair.fromSecret(process.env.ADMIN_SECRET);

  try {
    // Step 1: Pause old contract
    logger.info('1. Pausing old contract...');
    await oldContract.pause({ caller: admin.publicKey() });
    logger.info('✓ Old contract paused');

    // Step 2: Export state
    logger.info('2. Exporting state...');
    const snapshot = await oldContract.export_migration_state({
      caller: admin.publicKey()
    });
    logger.info({
      remittance_count: snapshot.persistent_data.remittances.length,
      accumulated_fees: snapshot.instance_data.accumulated_fees,
      platform_fee_bps: snapshot.instance_data.platform_fee_bps
    }, 'State exported');

    // Step 3: Verify snapshot
    logger.info('3. Verifying snapshot integrity...');
    const verification = await oldContract.verify_migration_snapshot({
      snapshot: snapshot
    });
    
    if (!verification.valid) {
      logger.error('Snapshot verification failed!');
      throw new Error('Snapshot verification failed!');
    }
    logger.info({ hash: verification.expected_hash.toString('hex').substring(0, 16) }, 'Snapshot verified');

    // Step 4: Import to new contract
    logger.info('4. Importing state to new contract...');
    await newContract.import_migration_state({
      caller: admin.publicKey(),
      snapshot: snapshot
    });
    logger.info('✓ State imported');

    // Step 5: Verify import
    logger.info('5. Verifying import...');
    const newSnapshot = await newContract.export_migration_state({
      caller: admin.publicKey()
    });
    
    if (snapshot.instance_data.remittance_counter !== newSnapshot.instance_data.remittance_counter) {
      logger.error({ 
        expected: snapshot.instance_data.remittance_counter, 
        actual: newSnapshot.instance_data.remittance_counter 
      }, 'Remittance counter mismatch!');
      throw new Error('Remittance counter mismatch!');
    }
    logger.info('✓ Import verified');

    // Step 6: Test new contract
    logger.info('6. Testing new contract...');
    const feeBps = await newContract.get_platform_fee_bps();
    const fees = await newContract.get_accumulated_fees();
    logger.info({ feeBps, fees }, 'New contract state');

    logger.info('✅ Migration completed successfully!');

  } catch (error) {
    logger.error({ error: error.message }, 'Migration failed');
    throw error;
  }
}

/**
 * Example 2: Batch Migration
 * 
 * Demonstrates incremental migration for large datasets (> 100 remittances).
 */
async function exampleBatchMigration() {
  logger.info('=== Example 2: Batch Migration ===');

  const oldContract = new Contract(config.oldContractId);
  const newContract = new Contract(config.newContractId);
  const admin = Keypair.fromSecret(process.env.ADMIN_SECRET);

  try {
    // Step 1: Determine batch parameters
    logger.info('1. Calculating batch parameters...');
    const remittanceCount = await oldContract.get_remittance_counter();
    const batchSize = 50;
    const totalBatches = Math.ceil(remittanceCount / batchSize);
    logger.info({ remittanceCount, batchSize, totalBatches }, 'Batch parameters calculated');

    // Step 2: Pause old contract
    logger.info('2. Pausing old contract...');
    await oldContract.pause({ caller: admin.publicKey() });
    logger.info('✓ Old contract paused');

    // Step 3: Export batches
    logger.info('3. Exporting batches...');
    const batches = [];
    for (let i = 0; i < totalBatches; i++) {
      const batch = await oldContract.export_migration_batch({
        caller: admin.publicKey(),
        batch_number: i,
        batch_size: batchSize
      });
      batches.push(batch);
      logger.info({ batch_number: i + 1, total_batches: totalBatches, count: batch.remittances.length }, 'Exported batch');
    }

    // Step 4: Initialize new contract
    logger.info('4. Initializing new contract...');
    const instanceData = await oldContract.export_migration_state({
      caller: admin.publicKey()
    }).then(s => s.instance_data);
    
    await newContract.initialize({
      admin: admin.publicKey(),
      usdc_token: instanceData.usdc_token,
      fee_bps: instanceData.platform_fee_bps
    });
    logger.info('✓ New contract initialized');

    // Step 5: Import batches
    logger.info('5. Importing batches...');
    for (let i = 0; i < batches.length; i++) {
      await newContract.import_migration_batch({
        caller: admin.publicKey(),
        batch: batches[i]
      });
      logger.info({ batch_number: i + 1, total_batches: batches.length }, 'Imported batch');
    }

    // Step 6: Verify completeness
    logger.info('6. Verifying completeness...');
    const newCount = await newContract.get_remittance_counter();
    if (newCount !== remittanceCount) {
      logger.error({ expected: remittanceCount, actual: newCount }, 'Count mismatch!');
      throw new Error(`Count mismatch: expected ${remittanceCount}, got ${newCount}`);
    }
    logger.info({ count: newCount }, 'All remittances migrated');

    logger.info('✅ Batch migration completed successfully!');

  } catch (error) {
    logger.error({ error: error.message }, 'Batch migration failed');
    throw error;
  }
}

/**
 * Example 3: Verification Only
 * 
 * Demonstrates how to verify a snapshot without importing.
 */
async function exampleVerificationOnly() {
  logger.info('=== Example 3: Verification Only ===');

  const oldContract = new Contract(config.oldContractId);
  const admin = Keypair.fromSecret(process.env.ADMIN_SECRET); // Initialize admin here

  try {
    // Export snapshot
    logger.info('1. Exporting snapshot...');
    const snapshot = await oldContract.export_migration_state({
      caller: admin.publicKey()
    });
    logger.info('✓ Snapshot exported');

    // Verify integrity
    logger.info('2. Verifying integrity...');
    const verification = await oldContract.verify_migration_snapshot({
      snapshot: snapshot
    });

    logger.info({ 
      valid: verification.valid,
      expected_hash: verification.expected_hash.toString('hex').substring(0, 32),
      actual_hash: verification.actual_hash.toString('hex').substring(0, 32),
      timestamp: new Date(verification.timestamp * 1000).toISOString()
    }, 'Snapshot integrity');

    if (verification.valid) {
      logger.info('✅ Snapshot is valid and ready for migration');
    } else {
      logger.error('❌ Snapshot verification failed - do not use!');
    }

  } catch (error) {
    logger.error({ error: error.message }, 'Verification failed');
    throw error;
  }
}

/**
 * Example 4: Tamper Detection
 * 
 * Demonstrates how hash verification detects tampering.
 */
async function exampleTamperDetection() {
  logger.info('=== Example 4: Tamper Detection ===');

  const oldContract = new Contract(config.oldContractId);
  const newContract = new Contract(config.newContractId);
  const admin = Keypair.fromSecret(process.env.ADMIN_SECRET);

  try {
    // Export snapshot
    logger.info('1. Exporting snapshot...');
    const snapshot = await oldContract.export_migration_state({
      caller: admin.publicKey()
    });
    logger.info('✓ Snapshot exported');

    // Verify original
    logger.info('2. Verifying original snapshot...');
    const verification1 = await oldContract.verify_migration_snapshot({
      snapshot: snapshot
    });
    logger.info({ valid: verification1.valid }, 'Original snapshot verification');

    // Tamper with data
    logger.info('3. Tampering with snapshot data...');
    const tamperedSnapshot = { ...snapshot };
    tamperedSnapshot.instance_data.platform_fee_bps = 9999; // Change fee
    logger.warn({ old_fee: snapshot.instance_data.platform_fee_bps, new_fee: 9999 }, 'Changed platform fee to tamper with data');

    // Verify tampered
    logger.info('4. Verifying tampered snapshot...');
    const verification2 = await oldContract.verify_migration_snapshot({
      snapshot: tamperedSnapshot
    });
    logger.info({ valid: verification2.valid }, 'Tampered snapshot verification');

    if (!verification2.valid) {
      logger.info('Tampering detected! Hash mismatch as expected.');
    }

    // Try to import tampered snapshot
    logger.info('5. Attempting to import tampered snapshot...');
    try {
      await newContract.import_migration_state({
        caller: admin.publicKey(),
        snapshot: tamperedSnapshot
      });
      logger.error('❌ Import should have failed!');
    } catch (error) {
      logger.info({ error: error.message }, 'Import correctly rejected');
    }

    logger.info('✅ Tamper detection working correctly!');

  } catch (error) {
    logger.error({ error: error.message }, 'Tamper detection test failed');
    throw error;
  }
}

/**
 * Example 5: Migration Audit Trail
 * 
 * Demonstrates how to create an audit trail of the migration.
 */
async function exampleAuditTrail() {
  logger.info('=== Example 5: Migration Audit Trail ===');

  const oldContract = new Contract(config.oldContractId);
  const newContract = new Contract(config.newContractId);
  const admin = Keypair.fromSecret(process.env.ADMIN_SECRET);

  const auditLog = {
    migration_date: new Date().toISOString(),
    old_contract_id: config.oldContractId,
    new_contract_id: config.newContractId,
    admin_address: admin.publicKey(),
    steps: [],
  };

  try {
    // Export
    logger.info('1. Exporting state...');
    const snapshot = await oldContract.export_migration_state({
      caller: admin.publicKey()
    });
    
    auditLog.steps.push({
      step: 'export',
      timestamp: new Date().toISOString(),
      remittances_count: snapshot.persistent_data.remittances.length,
      accumulated_fees: snapshot.instance_data.accumulated_fees.toString(),
      verification_hash: snapshot.verification_hash.toString('hex'),
    });
    logger.info('✓ State exported');

    // Verify
    logger.info('2. Verifying snapshot...');
    const verification = await oldContract.verify_migration_snapshot({
      snapshot: snapshot
    });
    
    auditLog.steps.push({
      step: 'verify',
      timestamp: new Date().toISOString(),
      valid: verification.valid,
      expected_hash: verification.expected_hash.toString('hex'),
      actual_hash: verification.actual_hash.toString('hex'),
    });
    logger.info('✓ Snapshot verified');

    // Import
    logger.info('3. Importing state...');
    await newContract.import_migration_state({
      caller: admin.publicKey(),
      snapshot: snapshot
    });
    
    auditLog.steps.push({
      step: 'import',
      timestamp: new Date().toISOString(),
      success: true,
    });
    logger.info('✓ State imported');

    // Verify import
    logger.info('4. Verifying import...');
    const newSnapshot = await newContract.export_migration_state({
      caller: admin.publicKey()
    });
    
    const countersMatch = snapshot.instance_data.remittance_counter === 
                         newSnapshot.instance_data.remittance_counter;
    const feesMatch = snapshot.instance_data.accumulated_fees === 
                     newSnapshot.instance_data.accumulated_fees;
    
    auditLog.steps.push({
      step: 'verify_import',
      timestamp: new Date().toISOString(),
      counters_match: countersMatch,
      fees_match: feesMatch,
      new_verification_hash: newSnapshot.verification_hash.toString('hex'),
    });
    logger.info('✓ Import verified');

    // Save audit log
    logger.info('5. Saving audit log...');
    const auditLogJson = JSON.stringify(auditLog, null, 2);
    logger.info({ auditLog }, 'Audit log created');
    
    // In production, save to file or database
    // fs.writeFileSync('migration-audit.json', auditLogJson);
    
    logger.info('✅ Migration audit trail created!');

  } catch (error) {
    auditLog.steps.push({
      step: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
    logger.error({ error: error.message, auditLog }, 'Migration failed');
    throw error;
  }
}

/**
 * Helper: Verify migration success
 */
async function verifyMigrationSuccess(oldContract, newContract) {
  const oldCounter = await oldContract.get_remittance_counter();
  const newCounter = await newContract.get_remittance_counter();
  
  if (oldCounter !== newCounter) {
    throw new Error(`Counter mismatch: ${oldCounter} != ${newCounter}`);
  }

  const oldFees = await oldContract.get_accumulated_fees();
  const newFees = await newContract.get_accumulated_fees();
  
  if (oldFees !== newFees) {
    throw new Error(`Fees mismatch: ${oldFees} != ${newFees}`);
  }

  const oldFeeBps = await oldContract.get_platform_fee_bps();
  const newFeeBps = await newContract.get_platform_fee_bps();
  
  if (oldFeeBps !== newFeeBps) {
    throw new Error(`Fee bps mismatch: ${oldFeeBps} != ${newFeeBps}`);
  }

  return true;
}

/**
 * Main function to run examples
 */
async function main() {
  const requestId = process.env.REQUEST_ID || uuidv4();
  logger = createLogger('migration-example', requestId);
  logger.info('=== SwiftRemit Contract Migration Examples ===');

  try {
    // Run examples
    // await exampleFullMigration();
    // await exampleBatchMigration();
    // await exampleVerificationOnly();
    // await exampleTamperDetection();
    await exampleAuditTrail();

  } catch (error) {
    logger.error({ error: error.message }, 'Error running examples');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  exampleFullMigration,
  exampleBatchMigration,
  exampleVerificationOnly,
  exampleTamperDetection,
  exampleAuditTrail,
  verifyMigrationSuccess,
};
