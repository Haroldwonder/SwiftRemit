import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { AssetVerifier } from './verifier';
import {
  getAssetVerification,
  saveAssetVerification,
  reportSuspiciousAsset,
  getVerifiedAssets,
  saveFxRate,
  getFxRate,
  saveAnchorKycConfig,
  getUserKycStatus,
  saveUserKycStatus,
  getPool,
} from './database';
import { storeVerificationOnChain } from './stellar';
import { VerificationStatus, AnchorKycConfig } from './types';
import { KycUpsertService } from './kyc-upsert-service';
import { createTransferGuard, AuthenticatedRequest } from './transfer-guard';

const app = express();
const verifier = new AssetVerifier();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

const pool = getPool();
const kycUpsertService = new KycUpsertService(pool);
const transferGuard = createTransferGuard(kycUpsertService);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.',
});

app.use('/api/', limiter);

// Input validation middleware
function validateAssetParams(req: Request, res: Response, next: Function) {
  const { assetCode, issuer } = req.body;

  if (!assetCode || typeof assetCode !== 'string' || assetCode.length > 12) {
    return res.status(400).json({ error: 'Invalid asset code' });
  }

  if (!issuer || typeof issuer !== 'string' || issuer.length !== 56) {
    return res.status(400).json({ error: 'Invalid issuer address' });
  }

  next();
}

function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = (req.headers['x-user-id'] as string) || '';

  if (!userId || typeof userId !== 'string') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = { id: userId };
  next();
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get asset verification status
app.get('/api/verification/:assetCode/:issuer', async (req: Request, res: Response) => {
  try {
    const { assetCode, issuer } = req.params;

    // Input validation
    if (!assetCode || assetCode.length > 12) {
      return res.status(400).json({ error: 'Invalid asset code' });
    }

    if (!issuer || issuer.length !== 56) {
      return res.status(400).json({ error: 'Invalid issuer address' });
    }

    const verification = await getAssetVerification(assetCode, issuer);

    if (!verification) {
      return res.status(404).json({ error: 'Asset verification not found' });
    }

    res.json(verification);
  } catch (error) {
    console.error('Error fetching verification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify asset (trigger new verification)
app.post('/api/verification/verify', validateAssetParams, async (req: Request, res: Response) => {
  try {
    const { assetCode, issuer } = req.body;

    // Perform verification
    const result = await verifier.verifyAsset(assetCode, issuer);

    // Save to database
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

    // Store on-chain
    try {
      await storeVerificationOnChain(verification);
    } catch (error) {
      console.error('Failed to store on-chain:', error);
      // Continue even if on-chain storage fails
    }

    res.json({
      success: true,
      verification: result,
    });
  } catch (error) {
    console.error('Error verifying asset:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Report suspicious asset
app.post('/api/verification/report', validateAssetParams, async (req: Request, res: Response) => {
  try {
    const { assetCode, issuer, reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.length > 500) {
      return res.status(400).json({ error: 'Invalid or missing reason' });
    }

    // Check if asset exists
    const existing = await getAssetVerification(assetCode, issuer);
    if (!existing) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Increment report count
    await reportSuspiciousAsset(assetCode, issuer);

    // If reports exceed threshold, mark as suspicious
    const updated = await getAssetVerification(assetCode, issuer);
    if (updated && updated.community_reports && updated.community_reports >= 5) {
      updated.status = VerificationStatus.Suspicious;
      updated.reputation_score = Math.min(updated.reputation_score, 30);
      await saveAssetVerification(updated);

      // Update on-chain
      try {
        await storeVerificationOnChain(updated);
      } catch (error) {
        console.error('Failed to update on-chain:', error);
      }
    }

    res.json({
      success: true,
      message: 'Report submitted successfully',
    });
  } catch (error) {
    console.error('Error reporting asset:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// List verified assets
app.get('/api/verification/verified', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const assets = await getVerifiedAssets(limit);

    res.json({
      count: assets.length,
      assets,
    });
  } catch (error) {
    console.error('Error fetching verified assets:', error);
    res.status(500).json({ error: 'Failed to fetch verified assets' });
  }
});

// Batch verification status
app.post('/api/verification/batch', async (req: Request, res: Response) => {
  try {
    const { assets } = req.body;

    if (!Array.isArray(assets) || assets.length === 0 || assets.length > 50) {
      return res.status(400).json({ error: 'Invalid assets array (max 50)' });
    }

    const results = await Promise.all(
      assets.map(async ({ assetCode, issuer }) => {
        try {
          const verification = await getAssetVerification(assetCode, issuer);
          return {
            assetCode,
            issuer,
            verification: verification || null,
          };
        } catch (error) {
          return {
            assetCode,
            issuer,
            verification: null,
            error: 'Failed to fetch',
          };
        }
      })
    );

    res.json({ results });
  } catch (error) {
    console.error('Error in batch verification:', error);
    res.status(500).json({ error: 'Batch verification failed' });
  }
});

// KYC status endpoint
app.get('/api/kyc/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const status = await kycUpsertService.getStatusForUser(userId);
    return res.status(200).json(status);
  } catch (error) {
    console.error('Error fetching KYC status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Transfer endpoint (guarded)
app.post('/api/transfer', authMiddleware, transferGuard, async (req: Request, res: Response) => {
  return res.status(200).json({ success: true, message: 'Transfer allowed' });
});

// Store FX rate for transaction
app.post('/api/fx-rate', async (req: Request, res: Response) => {
  try {
    const { transactionId, rate, provider, fromCurrency, toCurrency } = req.body;

    if (!transactionId || typeof transactionId !== 'string') {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    if (!rate || typeof rate !== 'number' || rate <= 0) {
      return res.status(400).json({ error: 'Invalid rate' });
    }

    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    if (!fromCurrency || !toCurrency) {
      return res.status(400).json({ error: 'Invalid currencies' });
    }

    await saveFxRate({
      transaction_id: transactionId,
      rate,
      provider,
      timestamp: new Date(),
      from_currency: fromCurrency,
      to_currency: toCurrency,
    });

    res.json({ success: true, message: 'FX rate stored successfully' });
  } catch (error) {
    console.error('Error storing FX rate:', error);
    res.status(500).json({ error: 'Failed to store FX rate' });
  }
});

// Get FX rate for transaction
app.get('/api/fx-rate/:transactionId', async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const fxRate = await getFxRate(transactionId);

    if (!fxRate) {
      return res.status(404).json({ error: 'FX rate not found for this transaction' });
    }

    res.json(fxRate);
  } catch (error) {
    console.error('Error fetching FX rate:', error);
    res.status(500).json({ error: 'Failed to fetch FX rate' });
  }
});

// KYC-related endpoints

// Configure anchor KYC settings (admin only)
app.post('/api/kyc/config', async (req: Request, res: Response) => {
  try {
    const { anchorId, kycServerUrl, authToken, pollingIntervalMinutes, enabled } = req.body;

    if (!anchorId || !kycServerUrl || !authToken) {
      return res.status(400).json({ error: 'Missing required fields: anchorId, kycServerUrl, authToken' });
    }

    const config: AnchorKycConfig = {
      anchor_id: anchorId,
      kyc_server_url: kycServerUrl,
      auth_token: authToken,
      polling_interval_minutes: pollingIntervalMinutes || 60,
      enabled: enabled !== false,
    };

    await saveAnchorKycConfig(config);

    res.json({ success: true, message: 'Anchor KYC config saved successfully' });
  } catch (error) {
    console.error('Error saving anchor KYC config:', error);
    res.status(500).json({ error: 'Failed to save anchor KYC config' });
  }
});

// Get user KYC status
app.get('/api/kyc/status/:userId/:anchorId', async (req: Request, res: Response) => {
  try {
    const { userId, anchorId } = req.params;

    if (!userId || !anchorId) {
      return res.status(400).json({ error: 'Invalid user ID or anchor ID' });
    }

    const kycStatus = await getUserKycStatus(userId, anchorId);

    if (!kycStatus) {
      return res.status(404).json({ error: 'KYC status not found' });
    }

    res.json(kycStatus);
  } catch (error) {
    console.error('Error fetching KYC status:', error);
    res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

// Register user for KYC with anchor
app.post('/api/kyc/register', async (req: Request, res: Response) => {
  try {
    const { userId, anchorId } = req.body;

    if (!userId || !anchorId) {
      return res.status(400).json({ error: 'Missing required fields: userId, anchorId' });
    }

    const kycService = (await import('./kyc-service')).KycService;
    const service = new kycService();
    await service.registerUserForKyc(userId, anchorId);

    res.json({ success: true, message: 'User registered for KYC successfully' });
  } catch (error) {
    console.error('Error registering user for KYC:', error);
    res.status(500).json({ error: 'Failed to register user for KYC' });
  }
});

// Check if user is KYC approved (for transfer validation)
app.get('/api/kyc/approved/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const kycService = (await import('./kyc-service')).KycService;
    const service = new kycService();
    const isApproved = await service.isUserKycApproved(userId);

    res.json({ userId, kycApproved: isApproved });
  } catch (error) {
    console.error('Error checking KYC approval:', error);
    res.status(500).json({ error: 'Failed to check KYC approval' });
  }
});

// Simulate settlement — preview fees and payout before confirming
app.post('/api/simulate-settlement', async (req: Request, res: Response) => {
  try {
    const { remittanceId } = req.body;

    if (
      remittanceId === undefined ||
      remittanceId === null ||
      !Number.isInteger(remittanceId) ||
      remittanceId <= 0
    ) {
      return res.status(400).json({ error: 'remittanceId must be a positive integer' });
    }

    const simulation = await simulateSettlement(remittanceId);
    res.json(simulation);
  } catch (error) {
    console.error('Error simulating settlement:', error);
    res.status(500).json({ error: 'Failed to simulate settlement' });
  }
});

export default app;
