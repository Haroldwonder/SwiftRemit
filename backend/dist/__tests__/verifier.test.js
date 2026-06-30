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
    function mockChecks(results) {
        vitest_1.vi.spyOn(verifier, 'checkStellarExpert').mockResolvedValue({
            name: 'Stellar Expert',
            ...results.expert,
        });
        vitest_1.vi.spyOn(verifier, 'checkStellarToml').mockResolvedValue({
            name: 'Stellar TOML',
            ...results.toml,
        });
        vitest_1.vi.spyOn(verifier, 'checkTrustlines').mockResolvedValue({
            name: 'Trustline Analysis',
            ...results.trustline,
        });
        vitest_1.vi.spyOn(verifier, 'checkTransactionHistory').mockResolvedValue({
            name: 'Transaction History',
            ...results.history,
        });
    }
    (0, vitest_1.it)('should verify a well-known asset', async () => {
        mockChecks({
            expert: { verified: true, score: 80 },
            toml: { verified: true, score: 80 },
            trustline: { verified: true, score: 100, details: { count: 5000 } },
            history: { verified: true, score: 70, details: { total_transactions: 50, recent_transactions: 20 } },
        });
        const result = await verifier.verifyAsset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
        (0, vitest_1.expect)(result.asset_code).toBe('USDC');
        (0, vitest_1.expect)(result.status).toBeDefined();
        (0, vitest_1.expect)(result.reputation_score).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(result.reputation_score).toBeLessThanOrEqual(100);
        (0, vitest_1.expect)(result.sources).toHaveLength(4);
    });
    (0, vitest_1.it)('should mark asset as suspicious with low trustlines and no TOML', async () => {
        mockChecks({
            expert: { verified: false, score: 0 },
            toml: { verified: false, score: 0 },
            trustline: { verified: false, score: 20, details: { count: 1 } },
            history: { verified: false, score: 0, details: { total_transactions: 0, recent_transactions: 0 } },
        });
        const result = await verifier.verifyAsset('SCAM', 'GXXX...');
        (0, vitest_1.expect)(result.status).toBe(types_1.VerificationStatus.Suspicious);
        (0, vitest_1.expect)(result.reputation_score).toBeLessThan(30);
    });
    (0, vitest_1.it)('should handle network errors gracefully', async () => {
        vitest_1.vi.spyOn(verifier, 'checkStellarExpert').mockResolvedValue({
            name: 'Stellar Expert', verified: false, score: 0,
        });
        vitest_1.vi.spyOn(verifier, 'checkStellarToml').mockResolvedValue({
            name: 'Stellar TOML', verified: false, score: 0,
        });
        vitest_1.vi.spyOn(verifier, 'checkTrustlines').mockResolvedValue({
            name: 'Trustline Analysis', verified: false, score: 0, details: { count: 0 },
        });
        vitest_1.vi.spyOn(verifier, 'checkTransactionHistory').mockResolvedValue({
            name: 'Transaction History', verified: false, score: 0,
        });
        const result = await verifier.verifyAsset('TEST', 'INVALID');
        (0, vitest_1.expect)(result).toBeDefined();
        (0, vitest_1.expect)(result.status).toBe(types_1.VerificationStatus.Suspicious);
    });
    (0, vitest_1.it)('should calculate reputation score correctly', async () => {
        mockChecks({
            expert: { verified: true, score: 80 },
            toml: { verified: true, score: 60 },
            trustline: { verified: false, score: 20, details: { count: 2 } },
            history: { verified: true, score: 70, details: { total_transactions: 20, recent_transactions: 5 } },
        });
        const result = await verifier.verifyAsset('TEST', 'GXXX...');
        // Score should be average of verified sources
        const verifiedSources = result.sources.filter(s => s.verified);
        if (verifiedSources.length > 0) {
            const expectedScore = Math.round(verifiedSources.reduce((sum, s) => sum + s.score, 0) / verifiedSources.length);
            (0, vitest_1.expect)(result.reputation_score).toBe(expectedScore);
        }
    });
});
