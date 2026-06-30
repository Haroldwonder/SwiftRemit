import {
  Keypair,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Address,
  nativeToScVal,
} from '@stellar/stellar-sdk';

const server = new SorobanRpc.Server(
  process.env.HORIZON_URL || 'https://soroban-testnet.stellar.org'
);

export interface KycOnChainResult {
  success: boolean;
  error?: string;
}

/**
 * Call set_kyc_approved on the Soroban contract.
 * user_id is expected to be a Stellar public key (G...).
 * Returns a structured result instead of throwing.
 */
export async function setKycApprovedOnChain(
  userStellarAddress: string,
  approved: boolean,
  expiresAt?: Date
): Promise<KycOnChainResult> {
  const contractId = process.env.CONTRACT_ID;
  const adminSecret = process.env.ADMIN_SECRET_KEY;

  if (!contractId || !adminSecret) {
    console.warn('CONTRACT_ID or ADMIN_SECRET_KEY not configured — skipping on-chain KYC sync');
    return { success: true };
  }

  try {
    const adminKeypair = Keypair.fromSecret(adminSecret);
    const contract = new Contract(contractId);
    const account = await server.getAccount(adminKeypair.publicKey());

    // expiry as unix timestamp (u64), default 0 if not provided
    const expiryTs = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0;

    const tx = new TransactionBuilder(account, {
      fee: '1000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        contract.call(
          'set_kyc_approved',
          new Address(userStellarAddress).toScVal(),
          nativeToScVal(approved, { type: 'bool' }),
          nativeToScVal(expiryTs, { type: 'u64' })
        )
      )
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      return { success: false, error: `Simulation failed: ${simulated.error}` };
    }

    const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
    prepared.sign(adminKeypair);

    const result = await server.sendTransaction(prepared);
    let status = await server.getTransaction(result.hash);
    while (status.status === 'NOT_FOUND') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      status = await server.getTransaction(result.hash);
    }

    if (status.status === 'FAILED') {
      return { success: false, error: `set_kyc_approved transaction failed: ${status.resultXdr}` };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
