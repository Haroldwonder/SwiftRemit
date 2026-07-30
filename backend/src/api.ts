import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { AssetVerifier } from './verifier';
import crypto from 'crypto';
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
  getWebhookSubscriberById,
  rotateWebhookSecret,
  getEnabledAnchors,
  getLatestAnchorHealth,
} from './database';
import { storeVerificationOnChain, simulateSettlement } from './stellar';
import { VerificationStatus, AnchorKycConfig } from './types';
import { KycUpsertService } from './kyc-upsert-service';
import { createTransferGuard, AuthenticatedRequest } from './transfer-guard';
import { AgentKycService } from './agent-kyc-service';
import { getFxRateCache } from './fx-rate-cache';
import { getAnchorCircuitBreaker } from './anchor-circuit-breaker';
import { correlationIdMiddleware, createLogger } from './correlation-id';
import { getMetricsService } from './metrics';
import { apiKeyRateLimiter } from './middleware/api-key-rate-limit';

import { createHealthRouter }       from './routes/health';
import { createVerificationRouter } from './routes/verification';
import { createKycRouter }          from './routes/kyc';
import { createFxRouter }           from './routes/fx';
import { createAnchorRouter }       from './routes/anchor';
import { createRemittanceRouter }   from './routes/remittance';
import { createAdminRouter }        from './routes/admin';
import { createWebhooksRouter }     from './routes/webhooks';
import docsRouter                   from './routes/docs';
import { createComplianceRouter }   from './routes/compliance';

// ─── App & shared services ───────────────────────────────────────────────────

const app    = express();
const pool   = getPool();
const logger = createLogger('api');

const fxRateCache    = getFxRateCache();
const metricsService = getMetricsService(pool);

async function logAdminAction(req: Request, action: string, target: string | null = null, params: Record<string, unknown> | null = null) {
  const auditService = new AdminAuditLogService(pool);
  await auditService.log({
    admin_address: (req.headers['x-user-id'] as string) || 'unknown',
    action,
    target,
    params_json: params,
    tx_hash: null,
    ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? null,
  });
}

fxRateCache.setMetricsObserver((from, to, stalenessSeconds) => {
  metricsService.setFxRateStalenessMetric(from, to, stalenessSeconds);
});
getFailoverFxService().setMetricsObserver({
  onProviderFailure: provider => metricsService.recordFxProviderFailure(provider),
  onFailover: () => metricsService.recordFxProviderFailover(),
  onRateRejected: (_pair, reason) => metricsService.recordFxRateRejected(reason),
});

// ─── Security & parsing middleware ───────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

// ─── Rate limiters ───────────────────────────────────────────────────────────

function makeRateLimiter(max: number, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      const retryAfter = Math.ceil(windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      metricsService.incrementRateLimitExceeded(req.path);
      res.status(429).json({ error: 'Too many requests', retryAfter });
    },
  });
}

const publicLimiter  = makeRateLimiter(100);   // 100 req/min — public endpoints
const webhookLimiter = makeRateLimiter(1000);  // 1 000 req/min — anchor callbacks
const adminLimiter   = makeRateLimiter(20);    // 20 req/min — admin endpoints

// Middleware-level rate limits (must be registered before routers)
app.use('/api/webhook',    webhookLimiter);
app.use('/api/kyc/config', adminLimiter);
app.use('/api/',           apiKeyRateLimiter);
app.use('/api/',           publicLimiter);

// ─── Metrics (excluded from rate limiting) ───────────────────────────────────

app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const metrics = await metricsService.getMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  } catch (error) {
    logger.error('Error generating metrics', error instanceof Error ? error : new Error(String(error)));
    res.status(500).send('# Error generating metrics\n');
  }
});

// ─── Routers — each instantiated once ────────────────────────────────────────

const remittanceRouter = createRemittanceRouter(pool);  // registers event listener once
const adminRouter      = createAdminRouter(pool);
const kycRouter        = createKycRouter(pool);

app.use('/health',           createHealthRouter(pool));
app.use('/api/docs',         docsRouter);
app.use('/api/compliance',   createComplianceRouter(pool));
app.use('/api/verification', createVerificationRouter());
app.use('/api/kyc',          kycRouter);
app.use('/api/transfer',     kycRouter);          // POST /api/transfer lives in kyc router
app.use('/api/fx-rate',      createFxRouter());
app.use('/api/anchor',       createAnchorRouter(pool));
app.use('/api/remittance',         remittanceRouter);
app.use('/api/simulate-settlement', remittanceRouter);  // POST /api/simulate-settlement
app.use('/api/events',             remittanceRouter);   // GET /api/events
app.use('/api/admin',        adminLimiter, adminRouter);
app.use('/api/webhooks',     adminLimiter, adminRouter);  // POST /api/webhooks/:id/rotate-secret
app.use('/webhooks',         webhookLimiter, createWebhooksRouter());

// ── Developer API Key Management (SR-043) ────────────────────────────────────

const apiKeyStore = new ApiKeyStore(pool);

/**
 * Helper: resolve the caller's identity from the Authorization header.
 * In production this would verify a JWT; here we extract the bearer token
 * value as the owner_id so tests can pass any string they like.
 */
function resolveOwnerId(req: Request): string | null {
  const auth = req.headers.authorization as string | undefined;
  if (!auth) return null;
  if (auth.startsWith('Bearer ')) return auth.slice(7) || null;
  return null;
}

/**
 * POST /api/developers/keys
 * Create a scoped API key. The full secret is returned once and never again.
 * Requires a Bearer token (owner identity).
 */
app.post('/api/developers/keys', adminLimiter, async (req: Request, res: Response) => {
  const ownerId = resolveOwnerId(req);
  if (!ownerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, scopes, tier, expires_at } = req.body as Record<string, unknown>;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: '`name` is required' });
  }

  if (!Array.isArray(scopes) || scopes.length === 0) {
    return res.status(400).json({ error: '`scopes` must be a non-empty array' });
  }

  const invalidScopes = (scopes as string[]).filter(
    (s) => !(ALL_SCOPES as readonly string[]).includes(s),
  );
  if (invalidScopes.length > 0) {
    return res.status(400).json({
      error: `Invalid scope(s): ${invalidScopes.join(', ')}`,
      valid_scopes: ALL_SCOPES,
    });
  }

// Get all webhook subscribers (Admin view)
app.get('/api/webhooks', adminLimiter, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, url, secret, previous_secret, secret_rotated_at, active, created_at, updated_at
       FROM webhook_subscribers
       ORDER BY created_at DESC`
    );
    // map DB rows to frontend interface
    const subscriptions = result.rows.map(row => ({
      id: row.id,
      url: row.url,
      events: [], // this mock app doesn't have events in DB schema it seems!
      secret: row.secret,
      secret_rotated_at: row.secret_rotated_at,
      has_previous_secret: !!row.previous_secret,
    }));

    await logAdminAction(req, 'list_webhooks', null, { count: subscriptions.length });

    res.status(200).json(subscriptions);
  } catch (error) {
    logger.error('Failed to get webhook subscribers', { error });
    res.status(500).json({ error: 'Internal server error' });
  }

  let expiresAtDate: Date | null | undefined;
  if (expires_at !== undefined && expires_at !== null) {
    expiresAtDate = new Date(expires_at as string);
    if (isNaN(expiresAtDate.getTime())) {
      return res.status(400).json({ error: '`expires_at` must be a valid ISO 8601 date' });
    }
  }

  try {
    const { newSecret, rotatedAt } = await rotateWebhookSecret(id);
    const subscriber = await getWebhookSubscriberById(id);

    await logAdminAction(req, 'rotate_webhook_secret', id);

    // Notify subscriber of new secret via a signed delivery (best-effort)
    if (subscriber?.url) {
      try {
        const timestamp = Date.now().toString();
        const notificationBody = JSON.stringify({
          event: 'webhook.secret_rotated',
          subscriber_id: id,
          new_secret: newSecret,
          rotated_at: rotatedAt.toISOString(),
          grace_period_hours: 24,
        });
        const signature = crypto
          .createHmac('sha256', newSecret)
          .update(`${timestamp}.${notificationBody}`)
          .digest('hex');

        await fetch(subscriber.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-event-type': 'webhook.secret_rotated',
            'x-webhook-timestamp': timestamp,
            'x-webhook-signature': signature,
          },
          body: notificationBody,
        });
      } catch (notifyErr) {
        logger.warn('Failed to notify subscriber of secret rotation', { id, error: notifyErr });
      }
    }

    return res.status(200).json({
      subscriber_id: id,
      secret_rotated_at: rotatedAt.toISOString(),
      grace_period_hours: 24,
      message: 'Secret rotated. Previous secret accepted for 24 hours.',
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Webhook subscriber not found')) {
      return res.status(404).json({ error: 'Webhook subscriber not found' });
    }
    logger.error('Failed to rotate webhook secret', error);
    return res.status(500).json({ error: 'Failed to rotate webhook secret' });
  }
});

// Get asset verification status
app.get('/api/verification/:assetCode/:issuer', async (req: Request, res: Response) => {
  try {
    const assetCode = req.params.assetCode as string;
    const issuer = req.params.issuer as string;

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
      transaction_id: sanitizeInput(transactionId),
      rate,
      provider: sanitizeInput(provider),
      timestamp: new Date(),
      from_currency: sanitizeInput(String(fromCurrency)),
      to_currency: sanitizeInput(String(toCurrency)),
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
    const transactionId = req.params.transactionId as string;

    if (!transactionId) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const fxRate = await getFxRate(transactionId);

    if (!fxRate) {
      return res.status(404).json({ error: 'FX rate not found for this transaction' });
    }

    res.json({
      ...fxRate,
      fx_rate_source: fxRate.provider,
    });
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
      anchor_id: sanitizeInput(anchorId),
      kyc_server_url: sanitizeInput(kycServerUrl),
      auth_token: authToken,
      polling_interval_minutes: pollingIntervalMinutes || 60,
      enabled: enabled !== false,
    };

    await saveAnchorKycConfig(config);

    await logAdminAction(req, 'configure_kyc', anchorId, { kycServerUrl, pollingIntervalMinutes, enabled });

    res.json({ success: true, message: 'Anchor KYC config saved successfully' });
  } catch (error) {
    console.error('Error saving anchor KYC config:', error);
    res.status(500).json({ error: 'Failed to save anchor KYC config' });
  }
});

// Get user KYC status
app.get('/api/kyc/status/:userId/:anchorId', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const anchorId = req.params.anchorId as string;

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

    const sanitizedUserId = sanitizeInput(userId);
    const sanitizedAnchorId = sanitizeInput(anchorId);

    const kycService = (await import('./kyc-service')).KycService;
    const service = new kycService();
    await service.registerUserForKyc(sanitizedUserId, sanitizedAnchorId);

    await logAdminAction(req, 'register_kyc_user', sanitizedUserId, { anchorId: sanitizedAnchorId });

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
      user_id: sanitizeInput(user_id),
      anchor_id: sanitizeInput(anchor_id),
      direction: direction as 'deposit' | 'withdrawal',
      asset_code: sanitizeInput(asset_code),
      amount,
      user_address: user_address ? sanitizeInput(String(user_address)) : user_address,
      user_email: user_email ? sanitizeInput(String(user_email)) : user_email,
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
    const transactionId = req.params.transactionId as string;

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
    const userId = req.params.userId as string;

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
    const fromCurrency = typeof req.body.fromCurrency === 'string' ? req.body.fromCurrency : req.body.from_currency;
    const toCurrency = typeof req.body.toCurrency === 'string' ? req.body.toCurrency : req.body.to_currency;
    const maxStalenessSeconds = Number.parseInt(
      String(req.body.fxRateMaxStalenessSeconds ?? req.body.fx_rate_max_staleness_seconds ?? process.env.FX_RATE_MAX_STALENESS_SECONDS ?? '3600'),
      10
    );

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

    if (typeof fromCurrency === 'string' && fromCurrency && typeof toCurrency === 'string' && toCurrency) {
      try {
        const fxRate = await fxRateCache.getCurrentRate(fromCurrency.toUpperCase(), toCurrency.toUpperCase());
        if (fxRate.stale && typeof fxRate.stalenessSeconds === 'number' && fxRate.stalenessSeconds > (Number.isFinite(maxStalenessSeconds) ? maxStalenessSeconds : 3600)) {
          return res.status(409).json({
            error: `FX rate is stale beyond the allowed maximum (${Number.isFinite(maxStalenessSeconds) ? maxStalenessSeconds : 3600}s)`,
            fx_rate_source: fxRate.fx_rate_source || fxRate.provider,
            fx_rate_staleness_seconds: fxRate.stalenessSeconds,
          });
        }
      } catch (error) {
        logger.error('Failed to resolve FX rate for remittance', error);
        return res.status(503).json({ error: 'Unable to obtain a valid FX rate' });
      }
    }

    const remittanceId = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await pool.query(
      `INSERT INTO transactions
         (transaction_id, anchor_id, kind, status, amount_in, memo, created_at, updated_at)
       VALUES ($1, $2, 'withdrawal', 'pending_user_transfer_start', $3, $4, NOW(), NOW())`,
      [remittanceId, agent, amount, sanitizedMemo ?? null]
    );

    // Auto-flag for compliance if amount exceeds any configured threshold
    try {
      const { autoFlagIfAboveThreshold } = await import('./routes/compliance');
      await autoFlagIfAboveThreshold(pool, remittanceId, parseFloat(amount), 'USD');
    } catch { /* compliance tables may not exist in all environments */ }

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

// Admin audit log
app.get('/api/admin/audit-log', async (req: Request, res: Response) => {
  try {
    const auditService = new AdminAuditLogService(pool);
    const q = req.query as any;
    const limit = Math.min(Number(q.limit) || 50, 200);

    // Decode opaque cursor (base64-encoded JSON {id, created_at})
    let cursorCondition = '';
    const params: unknown[] = [];
    let idx = 1;

    if (q.admin_address) { params.push(q.admin_address); cursorCondition += ` AND admin_address = $${idx++}`; }
    if (q.action)        { params.push(q.action);        cursorCondition += ` AND action = $${idx++}`; }
    if (q.from)          { params.push(new Date(q.from)); cursorCondition += ` AND created_at >= $${idx++}`; }
    if (q.to)            { params.push(new Date(q.to));   cursorCondition += ` AND created_at <= $${idx++}`; }

    if (q.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(q.cursor, 'base64').toString('utf8'));
        params.push(decoded.created_at);
        params.push(decoded.id);
        cursorCondition += ` AND (created_at < $${idx} OR (created_at = $${idx} AND id < $${idx + 1}))`;
        idx += 2;
      } catch {
        return res.status(400).json({ error: 'Invalid cursor' });
      }
    }

    const where = cursorCondition ? `WHERE 1=1 ${cursorCondition}` : '';
    params.push(limit + 1); // fetch one extra to detect next page
    const rows = await pool.query(
      `SELECT * FROM admin_audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT $${idx}`,
      params
    );

    const hasMore = rows.rows.length > limit;
    const entries = hasMore ? rows.rows.slice(0, limit) : rows.rows;

    let nextCursor: string | null = null;
    if (hasMore) {
      const last = entries[entries.length - 1];
      nextCursor = Buffer.from(JSON.stringify({ id: last.id, created_at: last.created_at })).toString('base64');
    }

    await logAdminAction(req, 'list_admin_audit_log', null, {
      action: q.action ?? null,
      admin_address: q.admin_address ?? null,
      limit,
      cursor: Boolean(q.cursor),
    });

    res.json({ limit, cursor: q.cursor ?? null, next_cursor: nextCursor, entries });
  } catch (error) {
    logger.error('Error fetching audit log', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// Background job monitoring dashboard (#866)
app.get('/api/admin/jobs', adminLimiter, async (req: Request, res: Response) => {
  try {
    const summaries = await getJobSummaries(pool);
    await logAdminAction(req, 'view_admin_jobs', null, { job_count: summaries.length });
    res.json({ jobs: summaries });
  } catch (error) {
    logger.error('Error fetching job summaries', error);
    res.status(500).json({ error: 'Failed to fetch job summaries' });
  }
});

// Per-anchor circuit breaker state, gating anchor calls (SR-031)
app.get('/api/admin/anchors/health', adminLimiter, async (req: Request, res: Response) => {
  try {
    const q = req.query as any;
    const from  = new Date(q.from as string);
    const to    = new Date(q.to   as string);
    const adminAddress = q.admin_address as string | undefined;
    const action       = q.action        as string | undefined;

    // Build parameterised WHERE clause
    const baseParams: unknown[] = [from, to];
    let extraWhere = '';
    if (adminAddress) { baseParams.push(adminAddress); extraWhere += ` AND admin_address = $${baseParams.length}`; }
    if (action)       { baseParams.push(action);        extraWhere += ` AND action = $${baseParams.length}`; }

    const baseWhere = `WHERE created_at >= $1 AND created_at <= $2${extraWhere}`;

    await logAdminAction(req, 'export_admin_audit_log', null, {
      from: q.from as string,
      to: q.to as string,
      admin_address: adminAddress ?? null,
      action: action ?? null,
    });

    // Check row count before streaming — hard cap at AUDIT_LOG_EXPORT_ROW_CAP
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM admin_audit_log ${baseWhere}`,
      baseParams
    );
    res.json({ anchors: health });
  } catch (error) {
    logger.error('Error fetching anchor health', error);
    res.status(500).json({ error: 'Failed to fetch anchor health' });
  }
});

// Compliance export — streams all audit log entries as newline-delimited JSON
app.get('/api/admin/audit-log/export', adminLimiter, async (req: Request, res: Response) => {
  try {
    const auditService = new AdminAuditLogService(pool);
    const filter = {
      admin_address: req.query.admin_address as string | undefined,
      action:        req.query.action        as string | undefined,
      from:  req.query.from ? new Date(req.query.from as string) : undefined,
      to:    req.query.to   ? new Date(req.query.to   as string) : undefined,
      limit: 200,
      offset: 0,
    };

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.ndjson"');

    let offset = 0;
    while (true) {
      filter.offset = offset;
      const { entries } = await auditService.query(filter);
      if (entries.length === 0) break;
      for (const entry of entries) {
        res.write(JSON.stringify(entry) + '\n');
      }
      if (entries.length < filter.limit) break;
      offset += filter.limit;
    }
    res.end();
  } catch (error) {
    logger.error('Error exporting audit log', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to export audit log' });
  }
});

// ── Contract Events ──────────────────────────────────────────────────────────

// Persist contract events emitted by the remittance event emitter
remittanceEventEmitter.onStatusChange(async (event) => {
  try {
    await saveContractEvent({
      event_type: event.status,
      remittance_id: event.remittanceId ? parseInt(event.remittanceId, 10) : null,
      actor: event.recipientId || null,
      amount: event.amount?.toString() ?? null,
      fee: null,
      tx_hash: (event.metadata?.txHash as string) ?? null,
      ledger_sequence: (event.metadata?.ledgerSequence as number) ?? null,
      timestamp: event.timestamp,
      raw_data: event.metadata ?? null,
    });
  } catch (err) {
    logger.error('Failed to create API key', err);
    return res.status(500).json({ error: 'Failed to create API key' });
  }
});

/**
 * GET /api/developers/keys
 * List the caller's active and inactive API keys.
 * The secret / hash is never included in this response.
 */
app.get('/api/developers/keys', adminLimiter, async (req: Request, res: Response) => {
  const ownerId = resolveOwnerId(req);
  if (!ownerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const keys = await apiKeyStore.listByOwner(ownerId);
    return res.json(keys);
  } catch (err) {
    logger.error('Failed to list API keys', err);
    return res.status(500).json({ error: 'Failed to list API keys' });
  }
});

/**
 * DELETE /api/developers/keys/:key_id
 * Revoke a key immediately. Returns 204 on success, 404 when not found,
 * 403 when the caller does not own the key.
 */
app.delete('/api/developers/keys/:key_id', adminLimiter, async (req: Request, res: Response) => {
  const ownerId = resolveOwnerId(req);
  if (!ownerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { key_id } = req.params;

  // Check key exists first so we can distinguish 404 from 403
  const allKeys = await apiKeyStore.listByOwner(ownerId).catch(() => []);
  const owned = allKeys.find((k) => k.key_id === key_id);

  if (!owned) {
    // The key may belong to another owner — check existence without revealing ownership
    const anyResult = await pool.query(
      `SELECT owner_id FROM api_keys WHERE key_id = $1`,
      [key_id],
    );
    if (anyResult.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }
    // Key exists but owned by someone else
    return res.status(403).json({ error: 'Forbidden: key belongs to a different owner' });
  }

  try {
    const revoked = await apiKeyStore.revoke({
      keyId:     key_id,
      ownerId,
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? undefined,
    });

    if (!revoked) {
      return res.status(404).json({ error: 'API key not found or already revoked' });
    }

    return res.status(204).send();
  } catch (err) {
    logger.error('Failed to revoke API key', err);
    return res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default app;
