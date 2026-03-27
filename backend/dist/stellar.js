"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeVerificationOnChain = storeVerificationOnChain;
exports.simulateSettlement = simulateSettlement;
exports.updateKycStatusOnChain = updateKycStatusOnChain;
const stellar_sdk_1 = require("@stellar/stellar-sdk");
const types_1 = require("./types");
const server = new stellar_sdk_1.SorobanRpc.Server(process.env.HORIZON_URL || 'https://soroban-testnet.stellar.org');
async function storeVerificationOnChain(verification) {
    const contractId = process.env.CONTRACT_ID;
    if (!contractId) {
        throw new Error('CONTRACT_ID not configured');
    }
    const adminSecret = process.env.ADMIN_SECRET_KEY;
    if (!adminSecret) {
        throw new Error('ADMIN_SECRET_KEY not configured');
    }
    const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminSecret);
    const contract = new stellar_sdk_1.Contract(contractId);
    // Get admin account
    const account = await server.getAccount(adminKeypair.publicKey());
    // Map status to contract enum
    let statusValue;
    switch (verification.status) {
        case types_1.VerificationStatus.Verified:
            statusValue = stellar_sdk_1.xdr.ScVal.scvSymbol('Verified');
            break;
        case types_1.VerificationStatus.Suspicious:
            statusValue = stellar_sdk_1.xdr.ScVal.scvSymbol('Suspicious');
            break;
        default:
            statusValue = stellar_sdk_1.xdr.ScVal.scvSymbol('Unverified');
    }
    // Build transaction
    const tx = new stellar_sdk_1.TransactionBuilder(account, {
        fee: '1000',
        networkPassphrase: stellar_sdk_1.Networks.TESTNET,
    })
        .addOperation(contract.call('set_asset_verification', (0, stellar_sdk_1.nativeToScVal)(verification.asset_code, { type: 'string' }), new stellar_sdk_1.Address(verification.issuer).toScVal(), statusValue, (0, stellar_sdk_1.nativeToScVal)(verification.reputation_score, { type: 'u32' }), (0, stellar_sdk_1.nativeToScVal)(verification.trustline_count, { type: 'u64' }), (0, stellar_sdk_1.nativeToScVal)(verification.has_toml, { type: 'bool' })))
        .setTimeout(30)
        .build();
    // Simulate transaction
    const simulated = await server.simulateTransaction(tx);
    if (stellar_sdk_1.SorobanRpc.Api.isSimulationError(simulated)) {
        throw new Error(`Simulation failed: ${simulated.error}`);
    }
    // Prepare and sign transaction
    const prepared = stellar_sdk_1.SorobanRpc.assembleTransaction(tx, simulated).build();
    prepared.sign(adminKeypair);
    // Submit transaction
    const result = await server.sendTransaction(prepared);
    // Wait for confirmation
    let status = await server.getTransaction(result.hash);
    while (status.status === 'NOT_FOUND') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await server.getTransaction(result.hash);
    }
    if (status.status === 'FAILED') {
        throw new Error(`Transaction failed: ${status.resultXdr}`);
    }
    console.log(`Stored verification on-chain for ${verification.asset_code}-${verification.issuer}`);
}
async function simulateSettlement(amount) {
    const contractId = process.env.CONTRACT_ID;
    if (!contractId)
        throw new Error('CONTRACT_ID not configured');
    const contract = new stellar_sdk_1.Contract(contractId);
    const keypair = stellar_sdk_1.Keypair.random();
    // Build a minimal source account for simulation (no signing needed)
    const sourceAccount = {
        accountId: () => keypair.publicKey(),
        sequenceNumber: () => '0',
        incrementSequenceNumber: () => { },
    };
    const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: stellar_sdk_1.Networks.TESTNET,
    })
        .addOperation(contract.call('calculate_fee_breakdown', (0, stellar_sdk_1.nativeToScVal)(amount, { type: 'i128' })))
        .setTimeout(30)
        .build();
    const simulated = await server.simulateTransaction(tx);
    if (stellar_sdk_1.SorobanRpc.Api.isSimulationError(simulated)) {
        return { would_succeed: false, payout_amount: '0', fee: '0', error_message: null };
    }
    const retval = simulated.result?.retval;
    if (!retval) {
        return { would_succeed: false, payout_amount: '0', fee: '0', error_message: null };
    }
    try {
        const entries = retval.map();
        const getI128 = (key) => {
            const entry = entries.find(e => e.key().sym() === key);
            if (!entry)
                return BigInt(0);
            const v = entry.val().i128();
            return (BigInt(v.hi().toString()) << BigInt(64)) | BigInt(v.lo().toString());
        };
        return {
            would_succeed: true,
            payout_amount: getI128('net_amount').toString(),
            fee: getI128('platform_fee').toString(),
            error_message: null,
        };
    }
    catch {
        return { would_succeed: false, payout_amount: '0', fee: '0', error_message: null };
    }
}
async function updateKycStatusOnChain(userId, approved) {
    const contractId = process.env.CONTRACT_ID;
    if (!contractId) {
        throw new Error('CONTRACT_ID not configured');
    }
    const adminSecret = process.env.ADMIN_SECRET_KEY;
    if (!adminSecret) {
        throw new Error('ADMIN_SECRET_KEY not configured');
    }
    const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminSecret);
    const contract = new stellar_sdk_1.Contract(contractId);
    // Get admin account
    const account = await server.getAccount(adminKeypair.publicKey());
    // Calculate expiry (1 year from now)
    const expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
    // Build transaction
    const tx = new stellar_sdk_1.TransactionBuilder(account, {
        fee: '1000',
        networkPassphrase: stellar_sdk_1.Networks.TESTNET,
    })
        .addOperation(contract.call('set_kyc_approved', new stellar_sdk_1.Address(userId).toScVal(), (0, stellar_sdk_1.nativeToScVal)(approved, { type: 'bool' }), (0, stellar_sdk_1.nativeToScVal)(expiry, { type: 'u64' })))
        .setTimeout(30)
        .build();
    // Simulate transaction
    const simulated = await server.simulateTransaction(tx);
    if (stellar_sdk_1.SorobanRpc.Api.isSimulationError(simulated)) {
        throw new Error(`Simulation failed: ${simulated.error}`);
    }
    // Prepare and sign transaction
    const prepared = stellar_sdk_1.SorobanRpc.assembleTransaction(tx, simulated).build();
    prepared.sign(adminKeypair);
    // Submit transaction
    const result = await server.sendTransaction(prepared);
    // Wait for confirmation
    let status = await server.getTransaction(result.hash);
    while (status.status === 'NOT_FOUND') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        status = await server.getTransaction(result.hash);
    }
    if (status.status === 'FAILED') {
        throw new Error(`Transaction failed: ${status.resultXdr}`);
    }
    console.log(`Updated KYC status on-chain for user ${userId}: ${approved ? 'approved' : 'revoked'}`);
}
