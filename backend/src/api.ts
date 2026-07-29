import express, { Request, Response, NextFunction } from 'express';
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
} from './database';
import { storeVerificationOnChain, simulateSettlement } from './stellar';
import { VerificationStatus, AnchorKycConfig } from './types';
import { KycUpsertService } from './kyc-upsert-service';
import { createTransferGuard, AuthenticatedRequest } from './transfer-guard';
import { AgentKycService } from './agent-kyc-service';
import { getFxRateCache } from './fx-rate-cache';
import { correlationIdMiddleware, createLogger } from './correlation-id';
import { getMetricsService } from './metrics';
import { sanitizeInput } from './sanitizer';
import docsRouter from './routes/docs';
import { Sep24Service, Sep24InitiateRequest, Sep24ConfigError, Sep24AnchorError } from './sep24-service';
import { AdminAuditLogService } from './admin-audit-log';
import { getJobSummaries } from './job-tracker';
import { saveContractEvent, queryContractEvents } from './database';
import { remittanceEventEmitter } from './remittance/events';
import { handleKycWebhook } from './kyc-webhook-handler';
import { apiKeyRateLimiter } from './middleware/api-key-rate-limit';
import { createComplianceRouter } from './routes/compliance';
import { validateRequest, validateQuery, validateParams } from './middleware/validate';
import {
  RemittanceCreateSchema,
  RemittanceIdParamSchema,
  VerificationRequestSchema,
  VerificationAssetParamSchema,
  VerificationListQuerySchema,
  ReportAssetSchema,
  BatchVerificationSchema,
  SimulateSettlementBodySchema,
  FxRateStoreSchema,
  FxRateTransactionParamSchema,
  FxRateCurrentQuerySchema,
  KycConfigSchema,
  KycStatusParamSchema,
  KycUserParamSchema,
  KycRegisterSchema,
  Sep24InitiateSchema,
  Sep24TransactionParamSchema,
  WebhookSubscriberParamSchema,
  AuditLogListQuerySchema,
  AuditLogExportQuerySchema,
  ContractEventsQuerySchema,
  AUDIT_LOG_EXPORT_MAX_DAYS,
  AUDIT_LOG_EXPORT_ROW_CAP,
} from './schemas/zod';

const app = express();
const fxRateCache = getFxRateCache();
const verifier = new AssetVerifier();
const logger = createLogger('api');
const pool = getPool();
const metricsService = getMetricsService(pool);
fxRateCache.setMetricsObserver((from, to, stalenessSeconds) => {
  metricsService.setFxRateStalenessMetric(from, to, stalenessSeconds);
});

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

// Per-group rate limiters
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
      res.status(429).json({
        error: 'Too many requests',
        retryAfter,
      });
    },
  });
}

// Public endpoints: 100 req/min
const publicLimiter = makeRateLimiter(100);
// Webhook endpoints: 1000 req/min (higher for anchor callbacks)
const webhookLimiter = makeRateLimiter(1000);
// Admin endpoints: 20 req/min
const adminLimiter = makeRateLimiter(20);

app.use('/api/webhook', webhookLimiter);
app.use('/api/kyc/config', adminLimiter);
app.use('/api/', apiKeyRateLimiter);
app.use('/api/', publicLimiter);

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
app.use('/api/compliance', createComplianceRouter(pool));

function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = (req.headers['x-user-id'] as string) || '';

  if (!userId || typeof userId !== 'string') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = { id: userId };
  next();
}

// Health check
app.get('/health', async (req: Request, res: Response) => {
  let dbStatus: 'healthy' | 'unhealthy' = 'unhealthy';
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    dbStatus = 'healthy';
  } catch {
    // db unreachable or timed out
  }

  const status = dbStatus === 'healthy' ? 200 : 503;
  res.status(status).json({ status: dbStatus === 'healthy' ? 'ok' : 'degraded', db: dbStatus, timestamp: new Date().toISOString() });
});

app.get('/health/db', async (req: Request, res: Response) => {
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    res.status(200).json({
      status: 'ok',
      pool: {
        active: pool.totalCount - pool.idleCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: 'error',
      error: 'Database unreachable',
      timestamp: new Date().toISOString(),
    });
  }
});

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
    res.status(200).json(subscriptions);
  } catch (error) {
    logger.error('Failed to get webhook subscribers', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rotate webhook subscriber secret
app.post('/api/webhooks/:id/rotate-secret', adminLimiter, validateParams(WebhookSubscriberParamSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    const { newSecret, rotatedAt } = await rotateWebhookSecret(id);
    const subscriber = await getWebhookSubscriberById(id);

    const auditService = new AdminAuditLogService(pool);
    await auditService.log({
      admin_address: (req.headers['x-user-id'] as string) || 'unknown',
      action: 'rotate_webhook_secret',
      target: id,
      params_json: null,
      tx_hash: null,
      ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? null,
    });

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
app.get('/api/verification/:assetCode/:issuer', validateParams(VerificationAssetParamSchema), async (req: Request, res: Response) => {
  try {
    const assetCode = req.params.assetCode as string;
    const issuer = req.params.issuer as string;
    // Params already validated by middleware above

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
app.post('/api/verification/verify', validateRequest(VerificationRequestSchema), async (req: Request, res: Response) => {
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
app.post('/api/verification/report', validateRequest(ReportAssetSchema), async (req: Request, res: Response) => {
  try {
    const { assetCode, issuer, reason } = req.body;
    // All fields validated and present via Zod schema

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
app.get('/api/verification/verified', validateQuery(VerificationListQuerySchema), async (req: Request, res: Response) => {
  try {
    const limit = Math.min((req.query.limit as unknown as number) || 100, 500);
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
app.post('/api/verification/batch', validateRequest(BatchVerificationSchema), async (req: Request, res: Response) => {
  try {
    const { assets } = req.body;
    // assets already validated: array of {assetCode, issuer}, 1–50 items

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
app.post('/api/fx-rate', validateRequest(FxRateStoreSchema), async (req: Request, res: Response) => {
  try {
    const { transactionId, rate, provider, fromCurrency, toCurrency } = req.body;
    // All fields validated by Zod schema above

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
app.get('/api/fx-rate/:transactionId', validateParams(FxRateTransactionParamSchema), async (req: Request, res: Response) => {
  try {
    const transactionId = req.params.transactionId as string;
    // param validated above

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
app.get('/api/fx-rate/current', validateQuery(FxRateCurrentQuerySchema), async (req: Request, res: Response) => {
  try {
    const from = (req.query.from as string).toUpperCase();
    const to = (req.query.to as string).toUpperCase();
    // from and to validated by schema (min 1, max 10)

    const rate = await fxRateCache.getCurrentRate(from, to);

    res.json(rate);
  } catch (error) {
    console.error('Error fetching current FX rate:', error);
    res.status(500).json({ error: 'Failed to fetch current FX rate' });
  }
});

// KYC-related endpoints

// Configure anchor KYC settings (admin only)
app.post('/api/kyc/config', adminLimiter, validateRequest(KycConfigSchema), async (req: Request, res: Response) => {
  try {
    const { anchorId, kycServerUrl, authToken, pollingIntervalMinutes, enabled } = req.body;
    // All fields validated above

    const config: AnchorKycConfig = {
      anchor_id: sanitizeInput(anchorId),
      kyc_server_url: sanitizeInput(kycServerUrl),
      auth_token: authToken,
      polling_interval_minutes: pollingIntervalMinutes || 60,
      enabled: enabled !== false,
    };

    await saveAnchorKycConfig(config);

    const auditService = new AdminAuditLogService(pool);
    await auditService.log({
      admin_address: (req.headers['x-user-id'] as string) || 'unknown',
      action: 'configure_kyc',
      target: anchorId,
      params_json: { kycServerUrl, pollingIntervalMinutes, enabled },
      tx_hash: null,
      ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? null,
    });

    res.json({ success: true, message: 'Anchor KYC config saved successfully' });
  } catch (error) {
    console.error('Error saving anchor KYC config:', error);
    res.status(500).json({ error: 'Failed to save anchor KYC config' });
  }
});

// Get user KYC status
app.get('/api/kyc/status/:userId/:anchorId', validateParams(KycStatusParamSchema), async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const anchorId = req.params.anchorId as string;
    // params validated above

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
app.post('/api/kyc/register', validateRequest(KycRegisterSchema), async (req: Request, res: Response) => {
  try {
    const { userId, anchorId } = req.body;
    // Both validated above

    const sanitizedUserId = sanitizeInput(userId);
    const sanitizedAnchorId = sanitizeInput(anchorId);

    const kycService = (await import('./kyc-service')).KycService;
    const service = new kycService();
    await service.registerUserForKyc(sanitizedUserId, sanitizedAnchorId);

    const auditService = new AdminAuditLogService(pool);
    await auditService.log({
      admin_address: (req.headers['x-user-id'] as string) || 'unknown',
      action: 'register_kyc_user',
      target: sanitizedUserId,
      params_json: { anchorId: sanitizedAnchorId },
      tx_hash: null,
      ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? null,
    });

    res.json({ success: true, message: 'User registered for KYC successfully' });
  } catch (error) {
    console.error('Error registering user for KYC:', error);
    res.status(500).json({ error: 'Failed to register user for KYC' });
  }
});

// SEP-24: Initiate deposit/withdrawal flow
app.post('/api/anchor/initiate', validateRequest(Sep24InitiateSchema), async (req: Request, res: Response) => {
  try {
    const { user_id, anchor_id, direction, asset_code, amount, user_address, user_email } = req.body;
    // All fields validated above — including positiveIntegerAmount for amount

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
app.get('/api/anchor/transaction/:transactionId', validateParams(Sep24TransactionParamSchema), async (req: Request, res: Response) => {
  try {
    const transactionId = req.params.transactionId as string;
    // param validated above

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
app.get('/api/kyc/approved/:userId', validateParams(KycUserParamSchema), async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    // param validated above

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
app.post('/api/remittance', authMiddleware, validateRequest(RemittanceCreateSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sender, agent, amount, fee, expiry, memo } = req.body;
    // All fields validated by RemittanceCreateSchema — sender/agent are StrKey addresses,
    // amount is a positive integer string (no floats/sci notation).
    const fromCurrency = typeof req.body.fromCurrency === 'string' ? req.body.fromCurrency : req.body.from_currency;
    const toCurrency = typeof req.body.toCurrency === 'string' ? req.body.toCurrency : req.body.to_currency;
    const maxStalenessSeconds = Number.parseInt(
      String(req.body.fxRateMaxStalenessSeconds ?? req.body.fx_rate_max_staleness_seconds ?? process.env.FX_RATE_MAX_STALENESS_SECONDS ?? '3600'),
      10
    );

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

    // Sanitize optional memo (Zod already capped at 100 chars)
    const sanitizedMemo = memo ? sanitizeInput(memo) : null;

    await pool.query(
      `INSERT INTO transactions
         (transaction_id, anchor_id, kind, status, amount_in, memo, created_at, updated_at)
       VALUES ($1, $2, 'withdrawal', 'pending_user_transfer_start', $3, $4, NOW(), NOW())`,
      [remittanceId, agent, amount, sanitizedMemo]
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
app.get('/api/remittance/:remittanceId', validateParams(RemittanceIdParamSchema), async (req: Request, res: Response) => {
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
app.post('/api/simulate-settlement', validateRequest(SimulateSettlementBodySchema), async (req: Request, res: Response) => {
  try {
    const { remittanceId } = req.body;
    // remittanceId is a positive integer, validated by Zod above

    const simulation = await simulateSettlement(remittanceId);
    res.json(simulation);
  } catch (error) {
    console.error('Error simulating settlement:', error);
    res.status(500).json({ error: 'Failed to simulate settlement' });
  }
});

// Admin audit log — cursor-based pagination
app.get('/api/admin/audit-log', adminLimiter, validateQuery(AuditLogListQuerySchema), async (req: Request, res: Response) => {
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
    res.json({ jobs: summaries });
  } catch (error) {
    logger.error('Error fetching job summaries', error);
    res.status(500).json({ error: 'Failed to fetch job summaries' });
  }
});

// Compliance export — server-side cursor streaming with mandatory date range and row cap
app.get('/api/admin/audit-log/export', adminLimiter, validateQuery(AuditLogExportQuerySchema), async (req: Request, res: Response) => {
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

    // Check row count before streaming — hard cap at AUDIT_LOG_EXPORT_ROW_CAP
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM admin_audit_log ${baseWhere}`,
      baseParams
    );
    const total = parseInt(countRes.rows[0].count, 10);
    if (total > AUDIT_LOG_EXPORT_ROW_CAP) {
      return res.status(413).json({
        error: `Export exceeds the ${AUDIT_LOG_EXPORT_ROW_CAP.toLocaleString()} row cap (${total.toLocaleString()} rows matched). Narrow the date range or add filters.`,
        matched: total,
        cap: AUDIT_LOG_EXPORT_ROW_CAP,
        max_date_range_days: AUDIT_LOG_EXPORT_MAX_DAYS,
      });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.ndjson"');
    res.setHeader('X-Total-Rows', String(total));

    // Stream via server-side cursor — never buffers the full result set in memory
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DECLARE audit_export_cursor NO SCROLL CURSOR FOR
           SELECT * FROM admin_audit_log ${baseWhere} ORDER BY created_at ASC, id ASC`,
        baseParams
      );

      const PAGE = 500;
      let done = false;
      while (!done) {
        const batch = await client.query(`FETCH ${PAGE} FROM audit_export_cursor`);
        if (batch.rows.length === 0) { done = true; break; }
        for (const row of batch.rows) {
          res.write(JSON.stringify(row) + '\n');
        }
        if (batch.rows.length < PAGE) done = true;
      }

      await client.query('CLOSE audit_export_cursor');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
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
    logger.error('Failed to persist contract event', err);
  }
});

// GET /api/events — query indexed contract events with filters and pagination
app.get('/api/events', validateQuery(ContractEventsQuerySchema), async (req: Request, res: Response) => {
  try {
    const q = req.query as any;
    const limit  = Number(q.limit)  || 50;
    const offset = Number(q.offset) || 0;

    const filter = {
      event_type:    q.event_type    as string | undefined,
      actor:         q.actor         as string | undefined,
      remittance_id: q.remittance_id ? Number(q.remittance_id) : undefined,
      from:          q.from          ? new Date(q.from as string) : undefined,
      to:            q.to            ? new Date(q.to   as string) : undefined,
      limit,
      offset,
    };

    const { events, total } = await queryContractEvents(filter);
    res.json({ total, limit, offset, events });
  } catch (error) {
    logger.error('Error fetching contract events', error);
    res.status(500).json({ error: 'Failed to fetch contract events' });
  }
});

// ── SEP-12 KYC Webhook ──────────────────────────────────────────────────────

/**
 * POST /webhooks/kyc/:anchor_id
 * 
 * Receive KYC status updates from anchors via webhook push.
 * Reduces polling load for anchors that support push notifications.
 * Falls back to polling for anchors that don't.
 */
app.post('/webhooks/kyc/:anchor_id', webhookLimiter, handleKycWebhook);

export default app;
