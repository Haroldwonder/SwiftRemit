"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const verifier_1 = require("../verifier");
const types_1 = require("../types");
(0, vitest_1.describe)('AssetVerifier', () => {
    let verifier;
    (0, vitest_1.beforeEach)(() => {
        verifier = new verifier_1.AssetVerifier();
    });
    (0, vitest_1.it)('should verify a well-known asset', async () => {
        const result = await verifier.verifyAsset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
        (0, vitest_1.expect)(result.asset_code).toBe('USDC');
        (0, vitest_1.expect)(result.status).toBeDefined();
        (0, vitest_1.expect)(result.reputation_score).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(result.reputation_score).toBeLessThanOrEqual(100);
        (0, vitest_1.expect)(result.sources).toHaveLength(4);
    });
    (0, vitest_1.it)('should mark asset as suspicious with low trustlines and no TOML', async () => {
        // Mock responses for a suspicious asset
        const result = await verifier.verifyAsset('SCAM', 'GXXX...');
        (0, vitest_1.expect)(result.status).toBe(types_1.VerificationStatus.Suspicious);
        (0, vitest_1.expect)(result.reputation_score).toBeLessThan(30);
    });
    (0, vitest_1.it)('should handle network errors gracefully', async () => {
        // Test with invalid issuer
        const result = await verifier.verifyAsset('TEST', 'INVALID');
        (0, vitest_1.expect)(result).toBeDefined();
        (0, vitest_1.expect)(result.status).toBe(types_1.VerificationStatus.Unverified);
    });
    (0, vitest_1.it)('should calculate reputation score correctly', async () => {
        const result = await verifier.verifyAsset('TEST', 'GXXX...');
        // Score should be average of verified sources
        const verifiedSources = result.sources.filter(s => s.verified);
        if (verifiedSources.length > 0) {
            const expectedScore = Math.round(verifiedSources.reduce((sum, s) => sum + s.score, 0) / verifiedSources.length);
            (0, vitest_1.expect)(result.reputation_score).toBe(expectedScore);
        }
    });
});
