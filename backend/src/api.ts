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
import { correlationIdMiddleware } from './correlation-middleware';
import { getCorrelationId } from './correlation-id';

const app = express();
const verifier = new AssetVerifier();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Add correlation ID middleware
app.use(correlationIdMiddleware());

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
function validateAssetParams(req: Request, res: Response, next: NextFunction) {
  const correlationId = getCorrelationId();
  console.log('Validating asset params', { correlationId });

  const { assetCode, issuer } = req.body;

  if (!assetCode || typeof assetCode !== 'string' || assetCode.length > 12) {
    console.log('Invalid asset code', { assetCode, correlationId });
    return res.status(400).json({ error: 'Invalid asset code' });
  }

  if (!issuer || typeof issuer !== 'string' || issuer.length !== 56) {
    console.log('Invalid issuer address', { issuer, correlationId });
    return res.status(400).json({ error: 'Invalid issuer address' });
  }

  next();
}

function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const correlationId = getCorrelationId();
  const userId = (req.headers['x-user-id'] as string) || '';

  console.log('Authenticating user', { userId, correlationId });

  if (!userId || typeof userId !== 'string') {
    console.log('Unauthorized access attempt', { userId, correlationId });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = { id: userId };
  next();
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  console.log('Health check requested', { correlationId });
  res.json({ status: 'ok', timestamp: new Date().toISOString(), correlationId });
});

// Get asset verification status
app.get('/api/verification/:assetCode/:issuer', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  console.log('Fetching asset verification', { 
    assetCode: req.params.assetCode, 
    issuer: req.params.issuer, 
    correlationId 
  });

  try {
    const { assetCode, issuer } = req.params;

    // Input validation
    if (!assetCode || assetCode.length > 12) {
      console.log('Invalid asset code in GET verification', { assetCode, correlationId });
      return res.status(400).json({ error: 'Invalid asset code' });
    }

    if (!issuer || issuer.length !== 56) {
      console.log('Invalid issuer address in GET verification', { issuer, correlationId });
      return res.status(400).json({ error: 'Invalid issuer address' });
    }

    const verification = await getAssetVerification(assetCode, issuer);

    if (!verification) {
      console.log('Asset verification not found', { assetCode, issuer, correlationId });
      return res.status(404).json({ error: 'Asset verification not found' });
    }

    console.log('Asset verification found', { assetCode, issuer, correlationId });
    res.json(verification);
  } catch (error) {
    console.error('Error fetching verification:', error, { correlationId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify asset (trigger new verification)
app.post('/api/verification/verify', validateAssetParams, async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  console.log('Starting asset verification', { 
    assetCode: req.body.assetCode, 
    issuer: req.body.issuer, 
    correlationId 
  });

  try {
    const { assetCode, issuer } = req.body;

    // Perform verification
    const result = await verifier.verifyAsset(assetCode, issuer);

    console.log('Asset verification completed', { 
      assetCode, 
      issuer, 
      status: result.status, 
      reputation_score: result.reputation_score,
      correlationId 
    });

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
      console.log('Verification stored on-chain', { assetCode, issuer, correlationId });
    } catch (error) {
      console.error('Failed to store on-chain:', error, { correlationId });
      // Continue even if on-chain storage fails
    }

    console.log('Asset verification successful', { assetCode, issuer, correlationId });
    res.json({
      success: true,
      verification: result,
    });
  } catch (error) {
    console.error('Error verifying asset:', error, { correlationId });
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Report suspicious asset
app.post('/api/verification/report', validateAssetParams, async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  console.log('Reporting suspicious asset', { 
    assetCode: req.body.assetCode, 
    issuer: req.body.issuer, 
    correlationId 
  });

  try {
    const { assetCode, issuer, reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.length > 500) {
      console.log('Invalid reason for suspicious report', { reason, correlationId });
      return res.status(400).json({ error: 'Invalid or missing reason' });
    }

    // Check if asset exists
    const existing = await getAssetVerification(assetCode, issuer);
    if (!existing) {
      console.log('Asset not found for suspicious report', { assetCode, issuer, correlationId });
      return res.status(404).json({ error: 'Asset not found' });
    }

    console.log('Asset found, incrementing suspicious reports', { assetCode, issuer, correlationId });

    // Increment report count
    await reportSuspiciousAsset(assetCode, issuer);

    // If reports exceed threshold, mark as suspicious
    const updated = await getAssetVerification(assetCode, issuer);
    if (updated && updated.community_reports && updated.community_reports >= 5) {
      console.log('Threshold exceeded, marking asset as suspicious', { 
        assetCode, 
        issuer, 
        reports: updated.community_reports,
        correlationId 
      });
      
      updated.status = VerificationStatus.Suspicious;
      updated.reputation_score = Math.min(updated.reputation_score, 30);
      await saveAssetVerification(updated);

      // Update on-chain
      try {
        await storeVerificationOnChain(updated);
        console.log('Suspicious asset status updated on-chain', { assetCode, issuer, correlationId });
      } catch (error) {
        console.error('Failed to update on-chain:', error, { correlationId });
      }
    }

    console.log('Suspicious asset report processed', { assetCode, issuer, correlationId });
    res.json({
      success: true,
      message: 'Report submitted successfully',
    });
  } catch (error) {
    console.error('Error reporting asset:', error, { correlationId });
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// List verified assets
app.get('/api/verification/verified', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  console.log('Fetching verified assets', { correlationId });

  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    console.log('Limit for verified assets query', { limit, correlationId });
    
    const assets = await getVerifiedAssets(limit);

    console.log('Verified assets fetched successfully', { count: assets.length, correlationId });
    res.json({
      count: assets.length,
      assets,
    });
  } catch (error) {
    console.error('Error fetching verified assets:', error, { correlationId });
    res.status(500).json({ error: 'Failed to fetch verified assets' });
  }
});

// Batch verification status
app.post('/api/verification/batch', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  console.log('Starting batch verification', { 
    assetCount: req.body.assets?.length || 0, 
    correlationId 
  });

  try {
    const { assets } = req.body;

    if (!Array.isArray(assets) || assets.length === 0 || assets.length > 50) {
      console.log('Invalid assets array for batch verification', { 
        assetCount: assets?.length, 
        correlationId 
      });
      return res.status(400).json({ error: 'Invalid assets array (max 50)' });
    }

    console.log('Processing batch verification for assets', { 
      assets: assets.map((a: any) => ({ assetCode: a.assetCode, issuer: a.issuer })), 
      correlationId 
    });

    const results = await Promise.all(
      assets.map(async ({ assetCode, issuer }: { assetCode: string; issuer: string }) => {
        try {
          const verification = await getAssetVerification(assetCode, issuer);
          console.log('Batch verification result', { 
            assetCode, 
            issuer, 
            hasVerification: !!verification, 
            correlationId 
          });
          
          return {
            assetCode,
            issuer,
            verification: verification || null,
          };
        } catch (error) {
          console.error('Batch verification failed for asset', { 
            assetCode, 
            issuer, 
            error, 
            correlationId 
          });
          
          return {
            assetCode,
            issuer,
            verification: null,
            error: 'Failed to fetch',
          };
        }
      })
    );

    console.log('Batch verification completed', { 
      successCount: results.filter(r => r.verification !== null).length, 
      totalCount: results.length, 
      correlationId 
    });

    res.json({ results });
  } catch (error) {
    console.error('Error in batch verification:', error, { correlationId });
    res.status(500).json({ error: 'Batch verification failed' });
  }
});

// KYC status endpoint
app.get('/api/kyc/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const correlationId = getCorrelationId();
  const userId = req.user?.id;
  
  console.log('Fetching KYC status', { userId, correlationId });

  try {
    if (!userId) {
      console.log('Unauthorized access to KYC status', { correlationId });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const status = await kycUpsertService.getStatusForUser(userId);
    console.log('KYC status fetched', { userId, status: status?.overall_status, correlationId });
    
    return res.status(200).json(status);
  } catch (error) {
    console.error('Error fetching KYC status:', error, { userId, correlationId });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Transfer endpoint (guarded)
app.post('/api/transfer', authMiddleware, transferGuard, async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  const userId = (req.headers['x-user-id'] as string) || '';
  
  console.log('Transfer request received', { userId, correlationId });

  try {
    console.log('Transfer allowed by guard', { userId, correlationId });
    return res.status(200).json({ success: true, message: 'Transfer allowed' });
  } catch (error) {
    console.error('Transfer failed:', error, { userId, correlationId });
    return res.status(500).json({ error: 'Transfer failed' });
  }
});

// Store FX rate for transaction
app.post('/api/fx-rate', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  console.log('Storing FX rate', { 
    transactionId: req.body.transactionId, 
    rate: req.body.rate, 
    provider: req.body.provider,
    correlationId 
  });

  try {
    const { transactionId, rate, provider, fromCurrency, toCurrency } = req.body;

    if (!transactionId || typeof transactionId !== 'string') {
      console.log('Invalid transaction ID for FX rate', { transactionId, correlationId });
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    if (!rate || typeof rate !== 'number' || rate <= 0) {
      console.log('Invalid rate for FX rate', { rate, correlationId });
      return res.status(400).json({ error: 'Invalid rate' });
    }

    if (!provider || typeof provider !== 'string') {
      console.log('Invalid provider for FX rate', { provider, correlationId });
      return res.status(400).json({ error: 'Invalid provider' });
    }

    if (!fromCurrency || !toCurrency) {
      console.log('Invalid currencies for FX rate', { fromCurrency, toCurrency, correlationId });
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

    console.log('FX rate stored successfully', { transactionId, rate, provider, correlationId });
    res.json({ success: true, message: 'FX rate stored successfully' });
  } catch (error) {
    console.error('Error storing FX rate:', error, { correlationId });
    res.status(500).json({ error: 'Failed to store FX rate' });
  }
});

// Get FX rate for transaction
app.get('/api/fx-rate/:transactionId', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  const { transactionId } = req.params;
  
  console.log('Fetching FX rate', { transactionId, correlationId });

  try {
    if (!transactionId) {
      console.log('Invalid transaction ID for FX rate fetch', { transactionId, correlationId });
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const fxRate = await getFxRate(transactionId);

    if (!fxRate) {
      console.log('FX rate not found', { transactionId, correlationId });
      return res.status(404).json({ error: 'FX rate not found for this transaction' });
    }

    console.log('FX rate found', { transactionId, rate: fxRate.rate, correlationId });
    res.json(fxRate);
  } catch (error) {
    console.error('Error fetching FX rate:', error, { transactionId, correlationId });
    res.status(500).json({ error: 'Failed to fetch FX rate' });
  }
});

// KYC-related endpoints

// Configure anchor KYC settings (admin only)
app.post('/api/kyc/config', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  console.log('Saving anchor KYC config', { 
    anchorId: req.body.anchorId, 
    correlationId 
  });

  try {
    const { anchorId, kycServerUrl, authToken, pollingIntervalMinutes, enabled } = req.body;

    if (!anchorId || !kycServerUrl || !authToken) {
      console.log('Missing required fields for KYC config', { anchorId, correlationId });
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

    console.log('Anchor KYC config saved successfully', { anchorId, correlationId });
    res.json({ success: true, message: 'Anchor KYC config saved successfully' });
  } catch (error) {
    console.error('Error saving anchor KYC config:', error, { correlationId });
    res.status(500).json({ error: 'Failed to save anchor KYC config' });
  }
});

// Get user KYC status
app.get('/api/kyc/status/:userId/:anchorId', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  const { userId, anchorId } = req.params;
  
  console.log('Fetching user KYC status', { userId, anchorId, correlationId });

  try {
    if (!userId || !anchorId) {
      console.log('Invalid user ID or anchor ID', { userId, anchorId, correlationId });
      return res.status(400).json({ error: 'Invalid user ID or anchor ID' });
    }

    const kycStatus = await getUserKycStatus(userId, anchorId);

    if (!kycStatus) {
      console.log('KYC status not found', { userId, anchorId, correlationId });
      return res.status(404).json({ error: 'KYC status not found' });
    }

    console.log('KYC status found', { userId, anchorId, status: kycStatus.status, correlationId });
    res.json(kycStatus);
  } catch (error) {
    console.error('Error fetching KYC status:', error, { userId, anchorId, correlationId });
    res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

// Register user for KYC with anchor
app.post('/api/kyc/register', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  const { userId, anchorId } = req.body;
  
  console.log('Registering user for KYC', { userId, anchorId, correlationId });

  try {
    if (!userId || !anchorId) {
      console.log('Missing required fields for KYC registration', { userId, anchorId, correlationId });
      return res.status(400).json({ error: 'Missing required fields: userId, anchorId' });
    }

    const kycService = (await import('./kyc-service')).KycService;
    const service = new kycService();
    await service.registerUserForKyc(userId, anchorId);

    console.log('User registered for KYC successfully', { userId, anchorId, correlationId });
    res.json({ success: true, message: 'User registered for KYC successfully' });
  } catch (error) {
    console.error('Error registering user for KYC:', error, { userId, anchorId, correlationId });
    res.status(500).json({ error: 'Failed to register user for KYC' });
  }
});

// Check if user is KYC approved (for transfer validation)
app.get('/api/kyc/approved/:userId', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  const { userId } = req.params;
  
  console.log('Checking KYC approval', { userId, correlationId });

  try {
    if (!userId) {
      console.log('Invalid user ID for KYC approval check', { userId, correlationId });
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const kycService = (await import('./kyc-service')).KycService;
    const service = new kycService();
    const isApproved = await service.isUserKycApproved(userId);

    console.log('KYC approval check completed', { userId, isApproved, correlationId });
    res.json({ userId, kycApproved: isApproved });
  } catch (error) {
    console.error('Error checking KYC approval:', error, { userId, correlationId });
    res.status(500).json({ error: 'Failed to check KYC approval' });
  }
});

// Simulate settlement — preview fees and payout before confirming
app.post('/api/simulate-settlement', async (req: Request, res: Response) => {
  const correlationId = getCorrelationId();
  const { remittanceId } = req.body;
  
  console.log('Simulating settlement', { remittanceId, correlationId });

  try {
    if (
      remittanceId === undefined ||
      remittanceId === null ||
      !Number.isInteger(remittanceId) ||
      remittanceId <= 0
    ) {
      console.log('Invalid remittance ID for settlement simulation', { remittanceId, correlationId });
      return res.status(400).json({ error: 'remittanceId must be a positive integer' });
    }

    // TODO: Implement simulateSettlement function
    const simulation = {
      remittanceId,
      fees: {
        network: 0.00001,
        service: 0.01,
        total: 0.01001
      },
      payout: {
        amount: 100,
        currency: 'USD'
      },
      estimatedTime: '5 minutes'
    };
    
    console.log('Settlement simulation completed', { remittanceId, correlationId });
    res.json(simulation);
  } catch (error) {
    console.error('Error simulating settlement:', error, { remittanceId, correlationId });
    res.status(500).json({ error: 'Failed to simulate settlement' });
  }
});

export default app;
