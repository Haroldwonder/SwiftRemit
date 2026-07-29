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

export default app;
