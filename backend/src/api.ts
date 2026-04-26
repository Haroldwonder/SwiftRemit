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
  saveAssetReport,
} from './database';
import { storeVerificationOnChain, simulateSettlement } from './stellar';
import { VerificationStatus, AnchorKycConfig } from './types';
import { KycUpsertService } from './kyc-upsert-service';
import { createTransferGuard, AuthenticatedRequest } from './transfer-guard';
import { getFxRateCache } from './fx-rate-cache';
import { correlationIdMiddleware, createLogger } from './correlation-id';
import { getMetricsService } from './metrics';
import { sanitizeInput } from './sanitizer';
import docsRouter from './routes/docs';
import { Sep24Service, Sep24InitiateRequest, Sep24ConfigError, Sep24AnchorError } from './sep24-service';

const app = express();
const fxRateCache = getFxRateCache();
const verifier = new AssetVerifier();
const logger = createLogger('api');
const pool = getPool();
const metricsService = getMetricsService(pool);

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Correlation ID middleware
app.use(correlationIdMiddleware);

const kycUpsertService = new KycUpsertService(pool);
const transferGuard = createTransferGuard(kycUpsertService);

// Initialize SEP-24 service
let sep24Service: Sep24Service | null = null;
async function getSep24ServiceInstance(): Promise<Sep24Service> {
  if (!sep24Service) {
    sep24Service = new Sep24Service(pool);
    await sep24Service.initialize();
  }
  return sep24Service;
}

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.',
});

app.use('/api/', limiter);

// Metrics endpoint (excluded from rate limiting)
app.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await metricsService.getMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  } catch (error) {
    logger.error('Error generating metrics', error);
    res.status(500).send('# Error generating metrics\n');
  }
});

// API documentation
app.use('/api/docs', docsRouter);

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

    // Sanitize input to prevent XSS attacks
    const sanitizedReason = sanitizeInput(reason);

    // Check if asset exists
    const existing = await getAssetVerification(assetCode, issuer);
    if (!existing) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Increment report count
    await reportSuspiciousAsset(assetCode, issuer);

    // Save the report with sanitized reason for audit trail
    await saveAssetReport(assetCode, issuer, sanitizedReason);

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

// Get current FX rate (cached)
app.get('/api/fx-rate/current', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;

    if (!from || typeof from !== 'string' || from.length > 10) {
      return res.status(400).json({ error: 'Invalid from currency' });
    }

    if (!to || typeof to !== 'string' || to.length > 10) {
      return res.status(400).json({ error: 'Invalid to currency' });
    }

    const rate = await fxRateCache.getCurrentRate(from.toUpperCase(), to.toUpperCase());

    res.json(rate);
  } catch (error) {
    console.error('Error fetching current FX rate:', error);
    res.status(500).json({ error: 'Failed to fetch current FX rate' });
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

// SEP-24: Initiate deposit/withdrawal flow
app.post('/api/anchor/initiate', async (req: Request, res: Response) => {
  try {
    const { user_id, anchor_id, direction, asset_code, amount, user_address, user_email } = req.body;

    // Validate required fields
    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing user_id' });
    }

    if (!anchor_id || typeof anchor_id !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing anchor_id' });
    }

    if (!direction || (direction !== 'deposit' && direction !== 'withdrawal')) {
      return res.status(400).json({ error: 'Invalid direction (must be deposit or withdrawal)' });
    }

    if (!asset_code || typeof asset_code !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing asset_code' });
    }

    if (!amount || typeof amount !== 'string' || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Invalid or missing amount' });
    }

    const service = await getSep24ServiceInstance();
    
    const request: Sep24InitiateRequest = {
      user_id,
      anchor_id,
      direction: direction as 'deposit' | 'withdrawal',
      asset_code,
      amount,
      user_address,
      user_email,
    };

    const result = await service.initiateFlow(request);

    res.json({
      success: true,
      transaction_id: result.transaction_id,
      url: result.url,
      message: result.message,
    });
  } catch (error) {
    if (error instanceof Sep24ConfigError) {
      return res.status(400).json({ error: error.message, code: 'CONFIG_ERROR' });
    }
    
    if (error instanceof Sep24AnchorError) {
      return res.status(error.statusCode || 502).json({ 
        error: error.message, 
        code: 'ANCHOR_ERROR' 
      });
    }
    
    console.error('Error initiating SEP-24 flow:', error);
    res.status(500).json({ error: 'Failed to initiate transaction' });
  }
});

// SEP-24: Get transaction status
app.get('/api/anchor/transaction/:transactionId', async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const service = await getSep24ServiceInstance();
    const transaction = await service.getTransactionStatus(transactionId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({
      success: true,
      transaction: {
        transaction_id: transaction.transaction_id,
        anchor_id: transaction.anchor_id,
        direction: transaction.direction,
        status: transaction.status,
        asset_code: transaction.asset_code,
        amount: transaction.amount,
        amount_in: transaction.amount_in,
        amount_out: transaction.amount_out,
        amount_fee: transaction.amount_fee,
        stellar_transaction_id: transaction.stellar_transaction_id,
        external_transaction_id: transaction.external_transaction_id,
        kyc_status: transaction.kyc_status,
        created_at: transaction.created_at,
        updated_at: transaction.updated_at,
      },
    });
  } catch (error) {
    console.error('Error getting transaction status:', error);
    res.status(500).json({ error: 'Failed to get transaction status' });
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

// Create remittance
app.post('/api/remittance', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sender, agent, amount, fee, expiry, memo } = req.body;

    if (!sender || typeof sender !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing sender' });
    }
    if (!agent || typeof agent !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing agent' });
    }
    if (!amount || typeof amount !== 'string' || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Invalid or missing amount' });
    }

    // Validate memo — optional, max 100 chars, plain text only
    let sanitizedMemo: string | undefined;
    if (memo !== undefined && memo !== null && memo !== '') {
      if (typeof memo !== 'string') {
        return res.status(400).json({ error: 'memo must be a string' });
      }
      if (memo.length > 100) {
        return res.status(400).json({ error: 'memo must not exceed 100 characters' });
      }
      sanitizedMemo = sanitizeInput(memo);
    }

    const remittanceId = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await pool.query(
      `INSERT INTO transactions
         (transaction_id, anchor_id, kind, status, amount_in, memo, created_at, updated_at)
       VALUES ($1, $2, 'withdrawal', 'pending_user_transfer_start', $3, $4, NOW(), NOW())`,
      [remittanceId, agent, amount, sanitizedMemo ?? null]
    );

    return res.status(201).json({
      success: true,
      remittance: {
        remittance_id: remittanceId,
        sender,
        agent,
        amount,
        fee: fee ?? null,
        expiry: expiry ?? null,
        memo: sanitizedMemo ?? null,
        status: 'pending_user_transfer_start',
      },
    });
  } catch (error) {
    logger.error('Error creating remittance', error);
    return res.status(500).json({ error: 'Failed to create remittance' });
  }
});

// Get remittance by ID
app.get('/api/remittance/:remittanceId', async (req: Request, res: Response) => {
  try {
    const { remittanceId } = req.params;

    const result = await pool.query(
      `SELECT transaction_id, anchor_id, status, amount_in, memo, created_at, updated_at
         FROM transactions WHERE transaction_id = $1`,
      [remittanceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Remittance not found' });
    }

    const row = result.rows[0];
    return res.json({
      remittance_id: row.transaction_id,
      agent: row.anchor_id,
      status: row.status,
      amount: row.amount_in,
      memo: row.memo ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (error) {
    logger.error('Error fetching remittance', error);
    return res.status(500).json({ error: 'Failed to fetch remittance' });
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

// Admin: list dead-letter queue entries
app.get('/api/webhooks/dead-letters', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { createWebhookStore } = await import('./webhooks/store');
    const store = createWebhookStore(pool);
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    const entries = await store.listDeadLetters(limit, offset);
    res.json({ entries, limit, offset });
  } catch (error) {
    logger.error('Error listing dead letters', error);
    res.status(500).json({ error: 'Failed to list dead-letter queue' });
  }
});

// Admin: replay a dead-letter entry
app.post('/api/webhooks/dead-letters/:id/replay', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid dead-letter id' });
    }

    const { createWebhookStore } = await import('./webhooks/store');
    const { WebhookDispatcher } = await import('./webhooks/dispatcher');
    const store = createWebhookStore(pool);
    const entries = await store.listDeadLetters(200, 0);
    const entry = entries.find(e => e.id === id);

    if (!entry) {
      return res.status(404).json({ error: 'Dead-letter entry not found' });
    }

    const metrics = getMetricsService(pool);
    const dispatcher = new WebhookDispatcher(store, logger, {}, () => metrics.incrementDeadLetterCount());
    await dispatcher.dispatch(entry.eventType, entry.payload);
    await store.markDeadLetterReplayed(id);

    res.json({ success: true, id });
  } catch (error) {
    logger.error('Error replaying dead letter', error);
    res.status(500).json({ error: 'Failed to replay dead-letter entry' });
  }
});

export default app;
