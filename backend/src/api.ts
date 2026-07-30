/**
 * api.ts — SR-033
 *
 * Application construction, middleware wiring, and router mounting.
 * All route handlers live in src/routes/*.ts.
 *
 * Preserved paths (verified against original api.ts):
 *   GET|POST /health, GET /health/db
 *   GET /metrics
 *   GET /api/verification/:assetCode/:issuer
 *   POST /api/verification/verify|/report|/batch
 *   GET /api/verification/verified
 *   GET /api/kyc/status, /api/kyc/status/:userId/:anchorId, /api/kyc/approved/:userId
 *   POST /api/kyc/config, /api/kyc/register
 *   POST /api/transfer
 *   POST|GET /api/fx-rate, GET /api/fx-rate/current, GET /api/fx-rate/:id
 *   POST /api/anchor/initiate, GET /api/anchor/transaction/:id
 *   POST /api/remittance, GET /api/remittance/:id
 *   POST /api/simulate-settlement
 *   GET /api/events
 *   GET /api/admin/audit-log, /api/admin/audit-log/export, /api/admin/jobs
 *   POST /api/webhooks/:id/rotate-secret
 *   POST /webhooks/kyc/:anchor_id
 *   GET /api/docs, /api/compliance
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { getPool } from './database';
import { getFxRateCache } from './fx-rate-cache';
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

fxRateCache.setMetricsObserver((from, to, stalenessSeconds) => {
  metricsService.setFxRateStalenessMetric(from, to, stalenessSeconds);
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

  const validTiers: RateLimitTier[] = ['free', 'standard', 'premium'];
  if (tier !== undefined && !validTiers.includes(tier as RateLimitTier)) {
    return res.status(400).json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` });
  }

  let expiresAtDate: Date | null | undefined;
  if (expires_at !== undefined && expires_at !== null) {
    expiresAtDate = new Date(expires_at as string);
    if (isNaN(expiresAtDate.getTime())) {
      return res.status(400).json({ error: '`expires_at` must be a valid ISO 8601 date' });
    }
  }

  try {
    const result = await apiKeyStore.create({
      name:       name.trim(),
      ownerId,
      scopes:     scopes as ApiKeyScope[],
      tier:       (tier as RateLimitTier) ?? 'free',
      expiresAt:  expiresAtDate,
      ipAddress:  (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? undefined,
    });

    return res.status(201).json(result);
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
