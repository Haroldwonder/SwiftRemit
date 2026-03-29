import {
  Keypair,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Address,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { AssetVerification, VerificationStatus } from './types';
import { getCorrelationId } from './correlation-id';

const server = new SorobanRpc.Server(
  process.env.HORIZON_URL || 'https://soroban-testnet.stellar.org'
);

/**
 * Get correlation ID for logging
 */
function getLogContext(): { correlation_id?: string } {
  const correlationId = getCorrelationId();
  return correlationId ? { correlation_id: correlationId } : {};
}

export async function storeVerificationOnChain(
  verification: AssetVerification
): Promise<void> {
  const logContext = getLogContext();
  console.log('Storing verification on-chain', { 
    assetCode: verification.asset_code, 
    issuer: verification.issuer, 
    status: verification.status,
    ...logContext 
  });

  const contractId = process.env.CONTRACT_ID;
  if (!contractId) {
    console.log('CONTRACT_ID not configured', { ...logContext });
    throw new Error('CONTRACT_ID not configured');
  }

  const adminSecret = process.env.ADMIN_SECRET_KEY;
  if (!adminSecret) {
    console.log('ADMIN_SECRET_KEY not configured', { ...logContext });
    throw new Error('ADMIN_SECRET_KEY not configured');
  }

  const adminKeypair = Keypair.fromSecret(adminSecret);
  const contract = new Contract(contractId);

  // Get admin account
  const account = await server.getAccount(adminKeypair.publicKey());

  // Map status to contract enum
  let statusValue: xdr.ScVal;
  switch (verification.status) {
    case VerificationStatus.Verified:
      statusValue = xdr.ScVal.scvSymbol('Verified');
      break;
    case VerificationStatus.Suspicious:
      statusValue = xdr.ScVal.scvSymbol('Suspicious');
      break;
    default:
      statusValue = xdr.ScVal.scvSymbol('Unverified');
  }

  // Build transaction
  const tx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'set_asset_verification',
        nativeToScVal(verification.asset_code, { type: 'string' }),
        new Address(verification.issuer).toScVal(),
        statusValue,
        nativeToScVal(verification.reputation_score, { type: 'u32' }),
        nativeToScVal(verification.trustline_count, { type: 'u64' }),
        nativeToScVal(verification.has_toml, { type: 'bool' })
      )
    )
    .setTimeout(30)
    .build();

  console.log('Simulating transaction', { ...logContext });

  // Simulate transaction
  const simulated = await server.simulateTransaction(tx);
  
  if (SorobanRpc.Api.isSimulationError(simulated)) {
    console.log('Transaction simulation failed', { error: simulated.error, ...logContext });
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  console.log('Transaction simulation successful', { ...logContext });

  // Prepare and sign transaction
  const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
  prepared.sign(adminKeypair);

  console.log('Submitting transaction', { ...logContext });

  // Submit transaction
  const result = await server.sendTransaction(prepared);

  // Wait for confirmation
  let status = await server.getTransaction(result.hash);
  while (status.status === 'NOT_FOUND') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    status = await server.getTransaction(result.hash);
  }

  if (status.status === 'FAILED') {
    console.log('Transaction failed', { resultXdr: status.resultXdr, ...logContext });
    throw new Error(`Transaction failed: ${status.resultXdr}`);
  }

  console.log(`Stored verification on-chain for ${verification.asset_code}-${verification.issuer}`, { ...logContext });
}

export interface SettlementSimulationResult {
  would_succeed: boolean;
  payout_amount: string;
  fee: string;
  error_message: number | null;
}

export async function simulateSettlement(
  amount: number
): Promise<SettlementSimulationResult> {
  const logContext = getLogContext();
  console.log('Simulating settlement on-chain', { amount, ...logContext });

  const contractId = process.env.CONTRACT_ID;
  if (!contractId) {
    console.log('CONTRACT_ID not configured for settlement simulation', { ...logContext });
    throw new Error('CONTRACT_ID not configured');
  }

  const contract = new Contract(contractId);
  const keypair = Keypair.random();

  // Build a minimal source account for simulation (no signing needed)
  const sourceAccount = {
    accountId: () => keypair.publicKey(),
    sequenceNumber: () => '0',
    incrementSequenceNumber: () => {},
  } as any;

  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'calculate_fee_breakdown',
        nativeToScVal(amount, { type: 'i128' })
      )
    )
    .setTimeout(30)
    .build();

  console.log('Simulating settlement transaction', { amount, ...logContext });

  const simulated = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    console.log('Settlement simulation failed', { error: simulated.error, ...logContext });
    return { would_succeed: false, payout_amount: '0', fee: '0', error_message: null };
  }

  const retval = (simulated as SorobanRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  if (!retval) {
    console.log('No return value from settlement simulation', { ...logContext });
    return { would_succeed: false, payout_amount: '0', fee: '0', error_message: null };
  }

  try {
    const entries = retval.map()!;
    const getI128 = (key: string): bigint => {
      const entry = entries.find(e => e.key().sym() === key);
      if (!entry) return BigInt(0);
      const v = entry.val().i128();
      return (BigInt(v.hi().toString()) << BigInt(64)) | BigInt(v.lo().toString());
    };
    
    const result = {
      would_succeed: true,
      payout_amount: getI128('net_amount').toString(),
      fee: getI128('platform_fee').toString(),
      error_message: null,
    };

    console.log('Settlement simulation completed', { 
      amount, 
      result,
      ...logContext 
    });

    return result;
  } catch (error) {
    console.error('Error parsing settlement simulation result:', error, { amount, ...logContext });
    return { would_succeed: false, payout_amount: '0', fee: '0', error_message: null };
  }
}

export async function updateKycStatusOnChain(
  userId: string,
  approved: boolean
): Promise<void> {
  const logContext = getLogContext();
  console.log('Updating KYC status on-chain', { userId, approved, ...logContext });

  const contractId = process.env.CONTRACT_ID;
  if (!contractId) {
    console.log('CONTRACT_ID not configured for KYC update', { userId, approved, ...logContext });
    throw new Error('CONTRACT_ID not configured');
  }

  const adminSecret = process.env.ADMIN_SECRET_KEY;
  if (!adminSecret) {
    console.log('ADMIN_SECRET_KEY not configured for KYC update', { userId, approved, ...logContext });
    throw new Error('ADMIN_SECRET_KEY not configured');
  }

  const adminKeypair = Keypair.fromSecret(adminSecret);
  const contract = new Contract(contractId);

  // Get admin account
  const account = await server.getAccount(adminKeypair.publicKey());

  // Calculate expiry (1 year from now)
  const expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);

  // Build transaction
  const tx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'set_kyc_approved',
        new Address(userId).toScVal(),
        nativeToScVal(approved, { type: 'bool' }),
        nativeToScVal(expiry, { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build();

  console.log('Simulating KYC update transaction', { userId, approved, ...logContext });

  // Simulate transaction
  const simulated = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    console.log('KYC update simulation failed', { error: simulated.error, userId, approved, ...logContext });
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  console.log('KYC update simulation successful', { userId, approved, ...logContext });

  // Prepare and sign transaction
  const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
  prepared.sign(adminKeypair);

  console.log('Submitting KYC update transaction', { userId, approved, ...logContext });

  // Submit transaction
  const result = await server.sendTransaction(prepared);

  // Wait for confirmation
  let status = await server.getTransaction(result.hash);
  while (status.status === 'NOT_FOUND') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    status = await server.getTransaction(result.hash);
  }

  if (status.status === 'FAILED') {
    console.log('KYC update transaction failed', { resultXdr: status.resultXdr, userId, approved, ...logContext });
    throw new Error(`Transaction failed: ${status.resultXdr}`);
  }

  console.log(`Updated KYC status on-chain for user ${userId}: ${approved ? 'approved' : 'revoked'}`, { ...logContext });
}
