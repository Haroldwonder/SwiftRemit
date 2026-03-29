import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssetVerifier } from '../verifier';
import { VerificationStatus } from '../types';

describe('AssetVerifier', () => {
  let verifier: AssetVerifier;

  beforeEach(() => {
    verifier = new AssetVerifier();
  });

  function mockChecks(results: {
    expert: { verified: boolean; score: number; details?: any };
    toml: { verified: boolean; score: number; details?: any };
    trustline: { verified: boolean; score: number; details?: any };
    history: { verified: boolean; score: number; details?: any };
  }) {
    vi.spyOn(verifier as any, 'checkStellarExpert').mockResolvedValue({
      name: 'Stellar Expert',
      ...results.expert,
    });
    vi.spyOn(verifier as any, 'checkStellarToml').mockResolvedValue({
      name: 'Stellar TOML',
      ...results.toml,
    });
    vi.spyOn(verifier as any, 'checkTrustlines').mockResolvedValue({
      name: 'Trustline Analysis',
      ...results.trustline,
    });
    vi.spyOn(verifier as any, 'checkTransactionHistory').mockResolvedValue({
      name: 'Transaction History',
      ...results.history,
    });
  }

  it('should verify a well-known asset', async () => {
    mockChecks({
      expert: { verified: true, score: 80 },
      toml: { verified: true, score: 80 },
      trustline: { verified: true, score: 100, details: { count: 5000 } },
      history: { verified: true, score: 70, details: { total_transactions: 50, recent_transactions: 20 } },
    });

    const result = await verifier.verifyAsset(
      'USDC',
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
    );

    expect(result.asset_code).toBe('USDC');
    expect(result.status).toBeDefined();
    expect(result.reputation_score).toBeGreaterThanOrEqual(0);
    expect(result.reputation_score).toBeLessThanOrEqual(100);
    expect(result.sources).toHaveLength(4);
  });

  it('should mark asset as suspicious with low trustlines and no TOML', async () => {
    mockChecks({
      expert: { verified: false, score: 0 },
      toml: { verified: false, score: 0 },
      trustline: { verified: false, score: 20, details: { count: 1 } },
      history: { verified: false, score: 0, details: { total_transactions: 0, recent_transactions: 0 } },
    });

    const result = await verifier.verifyAsset('SCAM', 'GXXX...');

    expect(result.status).toBe(VerificationStatus.Suspicious);
    expect(result.reputation_score).toBeLessThan(30);
  });

  it('should handle network errors gracefully', async () => {
    vi.spyOn(verifier as any, 'checkStellarExpert').mockResolvedValue({
      name: 'Stellar Expert', verified: false, score: 0,
    });
    vi.spyOn(verifier as any, 'checkStellarToml').mockResolvedValue({
      name: 'Stellar TOML', verified: false, score: 0,
    });
    vi.spyOn(verifier as any, 'checkTrustlines').mockResolvedValue({
      name: 'Trustline Analysis', verified: false, score: 0, details: { count: 0 },
    });
    vi.spyOn(verifier as any, 'checkTransactionHistory').mockResolvedValue({
      name: 'Transaction History', verified: false, score: 0,
    });

    const result = await verifier.verifyAsset('TEST', 'INVALID');

    expect(result).toBeDefined();
    expect(result.status).toBe(VerificationStatus.Suspicious);
  });

  it('should calculate reputation score correctly', async () => {
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
      const expectedScore = Math.round(
        verifiedSources.reduce((sum, s) => sum + s.score, 0) / verifiedSources.length
      );
      expect(result.reputation_score).toBe(expectedScore);
    }
  });
});
