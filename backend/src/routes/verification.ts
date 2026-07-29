import { Router, Request, Response } from 'express';
import { AssetVerifier } from '../verifier';
import {
  getAssetVerification,
  saveAssetVerification,
  reportSuspiciousAsset,
  getVerifiedAssets,
  saveAssetReport,
} from '../database';
import { storeVerificationOnChain } from '../stellar';
import { VerificationStatus } from '../types';
import { sanitizeInput } from '../sanitizer';

const verifier = new AssetVerifier();

function validateAssetParams(req: Request, res: Response, next: Function) {
  const { assetCode, issuer } = req.body;
  if (!assetCode || typeof assetCode !== 'string' || assetCode.length > 12) {
    return res.status(400).json({ error: 'Invalid asset code' });
  }
  if (!issuer || typeof issuer !== 'string' || issuer.length !== 56) {
    return res.status(400).json({ error: 'Invalid issuer address' });
  }
  req.body.assetCode = sanitizeInput(assetCode);
  req.body.issuer = sanitizeInput(issuer);
  next();
}

export function createVerificationRouter(): Router {
  const router = Router();

  // GET /api/verification/verified
  router.get('/verified', async (_req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(_req.query.limit as string) || 100, 500);
      const assets = await getVerifiedAssets(limit);
      res.json({ count: assets.length, assets });
    } catch (error) {
      console.error('Error fetching verified assets:', error);
      res.status(500).json({ error: 'Failed to fetch verified assets' });
    }
  });

  // POST /api/verification/verify
  router.post('/verify', validateAssetParams, async (req: Request, res: Response) => {
    try {
      const { assetCode, issuer } = req.body;
      const result = await verifier.verifyAsset(assetCode, issuer);
      const verification = {
        asset_code: result.asset_code,
        issuer: result.issuer,
        status: result.status,
        reputation_score: result.reputation_score,
        last_verified: new Date(),
        trustline_count: result.trustline_count,
        has_toml: result.has_toml,
        stellar_expert_verified: result.sources.find(s => s.name === 'Stellar Expert')?.verified,
        toml_data: result.sources.find(s => s.name === 'Stellar TOML')?.details,
        community_reports: 0,
      };
      await saveAssetVerification(verification);
      try { await storeVerificationOnChain(verification); } catch { /* best-effort */ }
      res.json({ success: true, verification: result });
    } catch (error) {
      console.error('Error verifying asset:', error);
      res.status(500).json({ error: 'Verification failed' });
    }
  });

  // POST /api/verification/report
  router.post('/report', validateAssetParams, async (req: Request, res: Response) => {
    try {
      const { assetCode, issuer, reason } = req.body;
      if (!reason || typeof reason !== 'string' || reason.length > 500) {
        return res.status(400).json({ error: 'Invalid or missing reason' });
      }
      const sanitizedReason = sanitizeInput(reason);
      const existing = await getAssetVerification(assetCode, issuer);
      if (!existing) return res.status(404).json({ error: 'Asset not found' });
      await reportSuspiciousAsset(assetCode, issuer);
      await saveAssetReport(assetCode, issuer, sanitizedReason);
      const updated = await getAssetVerification(assetCode, issuer);
      if (updated && updated.community_reports && updated.community_reports >= 5) {
        updated.status = VerificationStatus.Suspicious;
        updated.reputation_score = Math.min(updated.reputation_score, 30);
        await saveAssetVerification(updated);
        try { await storeVerificationOnChain(updated); } catch { /* best-effort */ }
      }
      res.json({ success: true, message: 'Report submitted successfully' });
    } catch (error) {
      console.error('Error reporting asset:', error);
      res.status(500).json({ error: 'Failed to submit report' });
    }
  });

  // POST /api/verification/batch
  router.post('/batch', async (req: Request, res: Response) => {
    try {
      const { assets } = req.body;
      if (!Array.isArray(assets) || assets.length === 0 || assets.length > 50) {
        return res.status(400).json({ error: 'Invalid assets array (max 50)' });
      }
      const results = await Promise.all(
        assets.map(async ({ assetCode, issuer }) => {
          try {
            return { assetCode, issuer, verification: (await getAssetVerification(assetCode, issuer)) || null };
          } catch {
            return { assetCode, issuer, verification: null, error: 'Failed to fetch' };
          }
        }),
      );
      res.json({ results });
    } catch (error) {
      console.error('Error in batch verification:', error);
      res.status(500).json({ error: 'Batch verification failed' });
    }
  });

  // GET /api/verification/:assetCode/:issuer
  router.get('/:assetCode/:issuer', async (req: Request, res: Response) => {
    try {
      const { assetCode, issuer } = req.params;
      if (!assetCode || assetCode.length > 12) return res.status(400).json({ error: 'Invalid asset code' });
      if (!issuer || issuer.length !== 56) return res.status(400).json({ error: 'Invalid issuer address' });
      const verification = await getAssetVerification(assetCode, issuer);
      if (!verification) return res.status(404).json({ error: 'Asset verification not found' });
      res.json(verification);
    } catch (error) {
      console.error('Error fetching verification:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
