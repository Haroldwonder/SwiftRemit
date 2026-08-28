/**
 * api.ts — SR-033
 *
 * Application construction, middleware wiring, and router mounting.
 * Route handlers live in src/routes/*.ts; only the endpoints that do not
 * belong to a domain router (developer API keys, the admin webhook listing,
 * the anchor circuit-breaker view and the proof-of-payout validator) are
 * declared here.
 *
 * Preserved paths:
 *   GET|POST /health, GET /health/db
 *   GET /metrics
 *   POST /api/proof-of-payout/validate
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
 *   GET /api/admin/anchors/health
 *   GET /api/webhooks, POST /api/webhooks/:id/rotate-secret
 *   POST /webhooks/kyc/:anchor_id
 *   GET /api/docs, /api/compliance, /api/aml, /api/devices
 *   POST|GET|DELETE /api/developers/keys
 */

import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import crypto from 'crypto';

import { getPool, getEnabledAnchors, getLatestAnchorHealth } from './database';
import { getFxRateCache } from './fx-rate-cache';
import { getFailoverFxService, setFxCircuitObserver } from './fx-provider';
import { getAnchorCircuitBreaker } from './anchor-circuit-breaker';
import { correlationIdMiddleware, createLogger } from './correlation-id';
import { getMetricsService } from './metrics';
import { AdminAuditLogService } from './admin-audit-log';
import { apiKeyRateLimiter, scopedApiKeyMiddleware, initApiKeyMiddleware } from './middleware/api-key-rate-limit';
import {
  ApiKeyStore,
  ApiKeyRecord,
  ALL_SCOPES,
  ApiKeyScope,
  RateLimitTier,
} from './middleware/api-key-store';
import { validateRequest } from './middleware/validate';
import { ProofOfPayoutValidationSchema } from './schemas/zod';

import { createHealthRouter }       from './routes/health';
import { createVerificationRouter } from './routes/verification';
import { createKycRouter }          from './routes/kyc';
import { createFxRouter }           from './routes/fx';
import { createAnchorRouter }       from './routes/anchor';
import { createRemittanceRouter }   from './routes/remittance';
import { createAdminRouter }        from './routes/admin';
import { createWebhooksRouter }     from './routes/webhooks';
import { createComplianceRouter }   from './routes/compliance';
import { createAmlRouter }          from './routes/aml';
import { createDeviceRouter }       from './routes/devices';
import { privacyRouter }            from './routes/privacy';
import docsRouter                   from './routes/docs';

// ─── App & shared services ───────────────────────────────────────────────────

const app    = express();
const pool   = getPool();
const logger = createLogger('api');

const fxRateCache    = getFxRateCache();
const metricsService = getMetricsService(pool);

/**
 * Resolve the authenticated principal for audit attribution.
 * Prefers the verified API-key owner (attached by scopedApiKeyMiddleware)
 * over the client-supplied x-user-id header, which cannot be trusted for
 * attribution since any caller can set it.
 */
function resolveActor(req: Request): string {
  const apiKey = (req as any).apiKey as ApiKeyRecord | undefined;
  if (apiKey?.owner_id) return apiKey.owner_id;
  return (req.headers['x-user-id'] as string) || 'unknown';
}

async function logAdminAction(
  req: Request,
  action: string,
  target: string | null = null,
  params: Record<string, unknown> | null = null,
) {
  const auditService = new AdminAuditLogService(pool);
  await auditService.log({
    admin_address: resolveActor(req),
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
  onProviderFailure: (provider) => metricsService.recordFxProviderFailure(provider),
  onFailover: () => metricsService.recordFxProviderFailover(),
  onRateRejected: (_pair, reason) => metricsService.recordFxRateRejected(reason),
});

// Publish the FX provider circuit-breaker state (SR-104). Seeded closed so the
// series exists before the first transition and alerts can evaluate it.
metricsService.setCircuitOpen('fx', false);
setFxCircuitObserver((provider, open) => {
  metricsService.setCircuitOpen(provider, open);
});

// ─── Security & parsing middleware ───────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

// Request instrumentation (SR-104) — feeds the API availability and latency
// SLIs. The route pattern is used rather than the concrete path so the label
// cardinality stays bounded.
app.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const route = req.route?.path ?? ((req.baseUrl || req.path) || 'unknown');
    metricsService.recordHttpRequest(req.method, route, res.statusCode, durationSeconds);
  });
  next();
});

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

// ─── Proof-of-payout validation (registered before the shared limiters) ──────

const PROOF_MAX_BYTES = 10 * 1024 * 1024;

function sniffProofMime(buffer: Buffer): string | null {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';
  return null;
}

app.post('/api/proof-of-payout/validate', validateRequest(ProofOfPayoutValidationSchema), (req: Request, res: Response) => {
  const file = Buffer.from(req.body.fileBase64, 'base64');
  if (file.length > PROOF_MAX_BYTES) {
    return res.status(413).json({ error: 'Proof file must be 10MB or smaller' });
  }

  const sniffedType = sniffProofMime(file);
  if (!sniffedType || sniffedType !== req.body.declaredType) {
    return res.status(400).json({ error: 'Proof file content does not match declared type' });
  }

  const serverHash = crypto.createHash('sha256').update(file).digest('hex');
  if (serverHash !== req.body.proofHash.toLowerCase()) {
    return res.status(400).json({ error: 'Proof hash does not match uploaded content' });
  }

  return res.json({ ok: true, proofHash: serverHash, contentType: sniffedType });
});

// Middleware-level rate limits (must be registered before routers)
app.use('/api/webhook',    webhookLimiter);
app.use('/api/kyc/config', adminLimiter);
app.use('/api/',           apiKeyRateLimiter);
app.use('/api/',           publicLimiter);

// Scoped API-key auth + per-tier rate limiting (SR-043). Runs ahead of every
// router below so /api/admin, /api/aml, /api/compliance and /api/devices —
// previously reachable with no authentication at all — now require a key
// carrying the scope declared in ROUTE_SCOPES. Registered at the app root
// (not under '/api/') so req.path matches the full paths ROUTE_SCOPES expects.
initApiKeyMiddleware(pool);
app.use(scopedApiKeyMiddleware);

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
app.use('/api/devices',      createDeviceRouter(pool));
// GDPR consent / SAR / rectification / erasure endpoints (previously never
// mounted anywhere — see the privacy-API finding). Each handler enforces its
// own ownership check (self or admin:* scope) since these act on a specific
// data subject rather than a fixed resource class.
app.use('/api/v1/privacy',   adminLimiter, privacyRouter);
// AML/CTF controls (SR-112). Rate-limited as an admin surface — these endpoints
// expose screening results and the alert queue.
app.use('/api/aml',          adminLimiter, createAmlRouter(pool));
app.use('/api/verification', createVerificationRouter());
app.use('/api/kyc',          kycRouter);
app.use('/api/transfer',     kycRouter);          // POST /api/transfer lives in kyc router
app.use('/api/fx-rate',      createFxRouter());
app.use('/api/anchor',       createAnchorRouter(pool));
// The remittance router owns /api/remittance, /api/simulate-settlement and
// /api/events; it declares those full sub-paths itself so the three do not
// shadow one another when mounted.
app.use('/api',              remittanceRouter);
app.use('/api/admin',        adminLimiter, adminRouter);
app.use('/api/webhooks',     adminLimiter, adminRouter);  // POST /api/webhooks/:id/rotate-secret
app.use('/webhooks',         webhookLimiter, createWebhooksRouter());

// ─── Anchor circuit-breaker state (SR-031) ───────────────────────────────────

app.get('/api/admin/anchors/health', adminLimiter, async (_req: Request, res: Response) => {
  try {
    const anchors = await getEnabledAnchors();
    const circuitBreaker = getAnchorCircuitBreaker();
    const health = await Promise.all(
      anchors.map(async anchor => ({
        anchor_id: anchor.id,
        name: anchor.name,
        circuit_state: circuitBreaker.getState(anchor.id),
        latest_health: await getLatestAnchorHealth(anchor.id),
      }))
    );
    res.json({ anchors: health });
  } catch (error) {
    logger.error('Error fetching anchor health', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch anchor health' });
  }
});

// ─── Webhook subscriber listing (admin view) ─────────────────────────────────

app.get('/api/webhooks', adminLimiter, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, url, secret, previous_secret, secret_rotated_at, active, created_at, updated_at
       FROM webhook_subscribers
       ORDER BY created_at DESC`
    );
    const subscriptions = result.rows.map(row => ({
      id: row.id,
      url: row.url,
      events: [],
      secret: row.secret,
      secret_rotated_at: row.secret_rotated_at,
      has_previous_secret: !!row.previous_secret,
    }));

    await logAdminAction(req, 'list_webhooks', null, { count: subscriptions.length });

    res.status(200).json(subscriptions);
  } catch (error) {
    logger.error('Failed to get webhook subscribers', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Developer API Key Management (SR-043) ───────────────────────────────────

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
    logger.error('Failed to create API key', err instanceof Error ? err : new Error(String(err)));
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
    logger.error('Failed to list API keys', err instanceof Error ? err : new Error(String(err)));
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
      keyId:     key_id as string,
      ownerId,
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? undefined,
    });

    if (!revoked) {
      return res.status(404).json({ error: 'API key not found or already revoked' });
    }

    return res.status(204).send();
  } catch (err) {
    logger.error('Failed to revoke API key', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default app;
