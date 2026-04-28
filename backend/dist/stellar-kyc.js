"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setKycApprovedOnChain = setKycApprovedOnChain;
const stellar_sdk_1 = require("@stellar/stellar-sdk");
const server = new stellar_sdk_1.SorobanRpc.Server(process.env.HORIZON_URL || 'https://soroban-testnet.stellar.org');
/**
 * Call set_kyc_approved on the Soroban contract.
 * user_id is expected to be a Stellar public key (G...).
 * Throws on failure — callers must handle and not roll back the DB write.
 */
async function setKycApprovedOnChain(userStellarAddress, approved, expiresAt) {
    const contractId = process.env.CONTRACT_ID;
    const adminSecret = process.env.ADMIN_SECRET_KEY;
    if (!contractId || !adminSecret) {
        console.warn('CONTRACT_ID or ADMIN_SECRET_KEY not configured — skipping on-chain KYC sync');
        return;
    }
    const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminSecret);
    const contract = new stellar_sdk_1.Contract(contractId);
    const account = await server.getAccount(adminKeypair.publicKey());
    // expiry as unix timestamp (u64), default 0 if not provided
    const expiryTs = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0;
    const tx = new stellar_sdk_1.TransactionBuilder(account, {
        fee: '1000',
        networkPassphrase: stellar_sdk_1.Networks.TESTNET,
    })
        .addOperation(contract.call('set_kyc_approved', new stellar_sdk_1.Address(userStellarAddress).toScVal(), (0, stellar_sdk_1.nativeToScVal)(approved, { type: 'bool' }), (0, stellar_sdk_1.nativeToScVal)(expiryTs, { type: 'u64' })))
        .setTimeout(30)
        .build();
    const simulated = await server.simulateTransaction(tx);
    if (stellar_sdk_1.SorobanRpc.Api.isSimulationError(simulated)) {
        throw new Error(`Simulation failed: ${simulated.error}`);
    }
    const prepared = stellar_sdk_1.SorobanRpc.assembleTransaction(tx, simulated).build();
    prepared.sign(adminKeypair);
    const result = await server.sendTransaction(prepared);
    let status = await server.getTransaction(result.hash);
    while (status.status === 'NOT_FOUND') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await server.getTransaction(result.hash);
    }
    if (status.status === 'FAILED') {
        throw new Error(`set_kyc_approved transaction failed: ${status.resultXdr}`);
    }
}
