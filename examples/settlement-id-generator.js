/**
 * SwiftRemit Deterministic Settlement ID Generator
 * 
 * Reference implementation for external systems (banks, anchors, APIs)
 * to generate identical settlement IDs as the SwiftRemit smart contract.
 * 
 * This implementation follows the canonical specification in:
 * DETERMINISTIC_HASHING_SPEC.md
 * 
 * @version 1.0.0
 * @schema_version 1
 */

import { Address } from '@stellar/stellar-sdk';
import crypto from 'crypto';

/**
 * Schema version for hash computation.
 * Must match the version in the smart contract.
 */
export const HASH_SCHEMA_VERSION = 1;

/**
 * Compute a deterministic settlement ID from remittance parameters.
 * 
 * This function produces identical output to the SwiftRemit smart contract's
 * compute_settlement_id() function when given the same inputs.
 * 
 * @param {number} remittanceId - Unique remittance counter ID (u64)
 * @param {string} senderAddress - Stellar address of sender (G... or C...)
 * @param {string} agentAddress - Stellar address of agent (G... or C...)
 * @param {bigint} amount - Payment amount in stroops (i128)
 * @param {bigint} fee - Fee amount in stroops (i128)
 * @param {number|null} expiry - Optional Unix timestamp (u64), null for no expiry
 * @returns {Buffer} 32-byte settlement ID (SHA-256 hash)
 * 
 * @example
 * const settlementId = computeSettlementId(
 *   1,                                    // remittance_id
 *   'GABC...XYZ',                        // sender
 *   'GDEF...UVW',                        // agent
 *   10000000n,                           // 1 USDC (7 decimals)
 *   250000n,                             // 0.025 USDC fee
 *   1735689600                           // expiry timestamp
 * );
 * console.log('Settlement ID:', settlementId.toString('hex'));
 */
export function computeSettlementId(
    remittanceId,
    senderAddress,
    agentAddress,
    amount,
    fee,
    expiry
) {
    // Validate inputs
    if (!Number.isInteger(remittanceId) || remittanceId < 0) {
        throw new Error('remittanceId must be a non-negative integer');
    }
    if (typeof senderAddress !== 'string' || !senderAddress.startsWith('G') && !senderAddress.startsWith('C')) {
        throw new Error('senderAddress must be a valid Stellar address');
    }
    if (typeof agentAddress !== 'string' || !agentAddress.startsWith('G') && !agentAddress.startsWith('C')) {
        throw new Error('agentAddress must be a valid Stellar address');
    }
    if (typeof amount !== 'bigint') {
        throw new Error('amount must be a bigint');
    }
    if (typeof fee !== 'bigint') {
        throw new Error('fee must be a bigint');
    }
    if (expiry !== null && (!Number.isInteger(expiry) || expiry < 0)) {
        throw new Error('expiry must be null or a non-negative integer');
    }

    const buffers = [];

    // Field 1: remittance_id (u64, big-endian, 8 bytes)
    const remittanceIdBuf = Buffer.alloc(8);
    remittanceIdBuf.writeBigUInt64BE(BigInt(remittanceId));
    buffers.push(remittanceIdBuf);

    // Field 2: sender address (XDR-encoded)
    const sender = Address.fromString(senderAddress);
    const senderXdr = sender.toXDRObject().toXDR();
    buffers.push(senderXdr);

    // Field 3: agent address (XDR-encoded)
    const agent = Address.fromString(agentAddress);
    const agentXdr = agent.toXDRObject().toXDR();
    buffers.push(agentXdr);

    // Field 4: amount (i128, big-endian, 16 bytes)
    buffers.push(i128ToBigEndian(amount));

    // Field 5: fee (i128, big-endian, 16 bytes)
    buffers.push(i128ToBigEndian(fee));

    // Field 6: expiry (u64, big-endian, 8 bytes, 0 if null)
    const expiryValue = expiry ?? 0;
    const expiryBuf = Buffer.alloc(8);
    expiryBuf.writeBigUInt64BE(BigInt(expiryValue));
    buffers.push(expiryBuf);

    // Concatenate all buffers
    const input = Buffer.concat(buffers);

    // Compute SHA-256 hash
    const hash = crypto.createHash('sha256').update(input).digest();

    return hash; // 32 bytes
}

/**
 * Convert a signed 128-bit integer to big-endian byte representation.
 * 
 * @param {bigint} value - The i128 value to encode
 * @returns {Buffer} 16-byte buffer in big-endian format
 * @private
 */
function i128ToBigEndian(value) {
    const buf = Buffer.alloc(16);
    const isNegative = value < 0n;
    const absValue = isNegative ? -value : value;
    
    // Split into high and low 64-bit parts
    const high = absValue >> 64n;
    const low = absValue & 0xFFFFFFFFFFFFFFFFn;
    
    // Write as big-endian (most significant bytes first)
    buf.writeBigUInt64BE(high, 0);
    buf.writeBigUInt64BE(low, 8);
    
    // Apply two's complement for negative numbers
    if (isNegative) {
        // Invert all bits
        for (let i = 0; i < 16; i++) {
            buf[i] = ~buf[i] & 0xFF;
        }
        // Add 1
        let carry = 1;
        for (let i = 15; i >= 0; i--) {
            const sum = buf[i] + carry;
            buf[i] = sum & 0xFF;
            carry = sum >> 8;
        }
    }
    
    return buf;
}

/**
 * Verify that a computed settlement ID matches an expected hash.
 * 
 * @param {Buffer} computed - The computed settlement ID
 * @param {Buffer|string} expected - Expected hash (Buffer or hex string)
 * @returns {boolean} True if hashes match
 * 
 * @example
 * const computed = computeSettlementId(...);
 * const onChainHash = '0x1234...'; // from blockchain
 * if (verifySettlementId(computed, onChainHash)) {
 *   console.log('Settlement ID verified!');
 * }
 */
export function verifySettlementId(computed, expected) {
    const expectedBuf = typeof expected === 'string' 
        ? Buffer.from(expected.replace('0x', ''), 'hex')
        : expected;
    
    return computed.equals(expectedBuf);
}

/**
 * Convert USDC amount (with decimals) to stroops.
 * USDC uses 7 decimal places.
 * 
 * @param {number} usdcAmount - Amount in USDC (e.g., 1.5 for 1.5 USDC)
 * @returns {bigint} Amount in stroops
 * 
 * @example
 * const stroops = usdcToStroops(1.5); // 15000000n
 */
export function usdcToStroops(usdcAmount) {
    const USDC_DECIMALS = 7;
    const multiplier = 10 ** USDC_DECIMALS;
    return BigInt(Math.floor(usdcAmount * multiplier));
}

/**
 * Convert stroops to USDC amount (with decimals).
 * 
 * @param {bigint} stroops - Amount in stroops
 * @returns {number} Amount in USDC
 * 
 * @example
 * const usdc = stroopsToUsdc(15000000n); // 1.5
 */
export function stroopsToUsdc(stroops) {
    const USDC_DECIMALS = 7;
    const divisor = 10 ** USDC_DECIMALS;
    return Number(stroops) / divisor;
}

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

/**
 * Example 1: Basic settlement ID generation
 */
export function example1_basicUsage() {
    console.log('=== Example 1: Basic Settlement ID Generation ===\n');
    
    const settlementId = computeSettlementId(
        1,                                          // remittance_id
        'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',  // sender
        'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',  // agent
        usdcToStroops(100),                        // 100 USDC
        usdcToStroops(2.5),                        // 2.5 USDC fee (2.5%)
        null                                        // no expiry
    );
    
    console.log('Settlement ID (hex):', settlementId.toString('hex'));
    console.log('Settlement ID (base64):', settlementId.toString('base64'));
    console.log();
}

/**
 * Example 2: Settlement with expiry
 */
export function example2_withExpiry() {
    console.log('=== Example 2: Settlement with Expiry ===\n');
    
    const expiryDate = new Date('2025-12-31T23:59:59Z');
    const expiryTimestamp = Math.floor(expiryDate.getTime() / 1000);
    
    const settlementId = computeSettlementId(
        42,
        'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
        'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
        usdcToStroops(500),
        usdcToStroops(12.5),
        expiryTimestamp
    );
    
    console.log('Remittance ID:', 42);
    console.log('Amount:', '500 USDC');
    console.log('Fee:', '12.5 USDC');
    console.log('Expiry:', expiryDate.toISOString());
    console.log('Settlement ID:', settlementId.toString('hex'));
    console.log();
}

/**
 * Example 3: Verify determinism (same inputs → same hash)
 */
export function example3_verifyDeterminism() {
    console.log('=== Example 3: Verify Determinism ===\n');
    
    const params = {
        remittanceId: 123,
        sender: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
        agent: 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
        amount: usdcToStroops(1000),
        fee: usdcToStroops(25),
        expiry: 1735689600
    };
    
    const hash1 = computeSettlementId(
        params.remittanceId,
        params.sender,
        params.agent,
        params.amount,
        params.fee,
        params.expiry
    );
    
    const hash2 = computeSettlementId(
        params.remittanceId,
        params.sender,
        params.agent,
        params.amount,
        params.fee,
        params.expiry
    );
    
    console.log('Hash 1:', hash1.toString('hex'));
    console.log('Hash 2:', hash2.toString('hex'));
    console.log('Hashes match:', hash1.equals(hash2) ? '✅ YES' : '❌ NO');
    console.log();
}

/**
 * Example 4: Cross-system verification
 */
export function example4_crossSystemVerification() {
    console.log('=== Example 4: Cross-System Verification ===\n');
    
    // Simulate receiving settlement data from blockchain
    const onChainData = {
        remittanceId: 999,
        sender: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
        agent: 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
        amount: usdcToStroops(750),
        fee: usdcToStroops(18.75),
        expiry: null,
        settlementIdFromChain: null // Will be computed
    };
    
    // Compute expected settlement ID
    const computedId = computeSettlementId(
        onChainData.remittanceId,
        onChainData.sender,
        onChainData.agent,
        onChainData.amount,
        onChainData.fee,
        onChainData.expiry
    );
    
    // Simulate on-chain settlement ID (in real scenario, fetch from blockchain)
    onChainData.settlementIdFromChain = computedId;
    
    // Verify
    const isValid = verifySettlementId(computedId, onChainData.settlementIdFromChain);
    
    console.log('Computed Settlement ID:', computedId.toString('hex'));
    console.log('On-Chain Settlement ID:', onChainData.settlementIdFromChain.toString('hex'));
    console.log('Verification:', isValid ? '✅ VALID' : '❌ INVALID');
    console.log();
}

/**
 * Example 5: Batch processing for reconciliation
 */
export function example5_batchReconciliation() {
    console.log('=== Example 5: Batch Reconciliation ===\n');
    
    const remittances = [
        { id: 1, sender: 'GABC...', agent: 'GDEF...', amount: 100n, fee: 2n, expiry: null },
        { id: 2, sender: 'GABC...', agent: 'GXYZ...', amount: 200n, fee: 5n, expiry: null },
        { id: 3, sender: 'GHIJ...', agent: 'GDEF...', amount: 150n, fee: 3n, expiry: 1735689600 },
    ];
    
    console.log('Processing', remittances.length, 'remittances...\n');
    
    const settlementIds = remittances.map(r => {
        const id = computeSettlementId(r.id, r.sender, r.agent, r.amount, r.fee, r.expiry);
        return {
            remittanceId: r.id,
            settlementId: id.toString('hex'),
            amount: stroopsToUsdc(r.amount),
            fee: stroopsToUsdc(r.fee)
        };
    });
    
    console.table(settlementIds);
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    example1_basicUsage();
    example2_withExpiry();
    example3_verifyDeterminism();
    example4_crossSystemVerification();
    example5_batchReconciliation();
}
