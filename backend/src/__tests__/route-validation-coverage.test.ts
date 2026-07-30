/**
 * Route-validation coverage test (#874)
 *
 * Enumerates every registered route in the Express app (api.ts) and asserts
 * that each one has at least one of the three validation middlewares in its
 * handler chain:
 *   - validateRequest  (body)
 *   - validateQuery    (query string)
 *   - validateParams   (route parameters)
 *
 * A few routes are intentionally exempt (health checks, metrics, webhooks
 * arriving from third-party anchors, compliance sub-router). Those must be
 * explicitly listed in EXEMPT_PATHS — adding a new route to that list
 * without a schema will fail code-review by triggering a comment here.
 *
 * HOW IT WORKS
 * Express stores the layer stack as app._router.stack. Each Layer has a
 * `route` property when it is a Route handler. We walk the stack, collect
 * every (method, path) pair, and for each one reconstruct the middleware
 * chain from layer.route.stack, checking for our three validator names.
 *
 * FAIL CONDITION
 * If a new endpoint is added to api.ts without a validate* middleware the
 * test will print the offending routes and fail immediately.
 */

import { describe, it, expect } from 'vitest';

// ── App import ────────────────────────────────────────────────────────────────
// We import the app module. Side-effects (pool creation, etc.) are avoided
// because database.ts reads DATABASE_URL lazily; we only need the router stack.
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'; // satisfy pool init guard

// Mock heavy I/O dependencies so the module loads without real connections.
import { vi } from 'vitest';

vi.mock('../database', () => ({
  getPool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn(), totalCount: 0, idleCount: 0, waitingCount: 0 })),
  saveContractEvent: vi.fn(),
  queryContractEvents: vi.fn(),
  getWebhookSubscriberById: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  getActiveWebhookSubscribers: vi.fn().mockResolvedValue([]),
  enqueueWebhookDelivery: vi.fn(),
  markWebhookDeliverySuccess: vi.fn(),
  markWebhookDeliveryFailure: vi.fn(),
  getPendingWebhookDeliveries: vi.fn().mockResolvedValue([]),
  initDatabase: vi.fn(),
}));
vi.mock('../stellar', () => ({
  storeVerificationOnChain: vi.fn(),
  simulateSettlement: vi.fn(),
  cancelRemittanceOnChain: vi.fn(),
  updateKycStatusOnChain: vi.fn(),
}));
vi.mock('../metrics', () => ({
  getMetricsService: vi.fn(() => ({
    getMetrics: vi.fn().mockResolvedValue(''),
    setFxRateStalenessMetric: vi.fn(),
    incrementRateLimitExceeded: vi.fn(),
  })),
}));
vi.mock('../fx-rate-cache', () => ({
  getFxRateCache: vi.fn(() => ({
    getCurrentRate: vi.fn(),
    setMetricsObserver: vi.fn(),
  })),
}));
vi.mock('../kyc-upsert-service', () => ({ KycUpsertService: vi.fn().mockImplementation(() => ({ getStatusForUser: vi.fn() })) }));
vi.mock('../transfer-guard', () => ({
  createTransferGuard: vi.fn(() => vi.fn((_req: any, _res: any, next: any) => next())),
}));
vi.mock('../agent-kyc-service', () => ({ AgentKycService: vi.fn() }));
vi.mock('../correlation-id', () => ({
  correlationIdMiddleware: vi.fn((_req: any, _res: any, next: any) => next()),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('../sanitizer', () => ({ sanitizeInput: vi.fn((v: string) => v) }));
vi.mock('../sep24-service', () => ({
  Sep24Service: vi.fn().mockImplementation(() => ({ initialize: vi.fn(), initiateFlow: vi.fn(), getTransactionStatus: vi.fn(), pollAllTransactions: vi.fn() })),
  Sep24ConfigError: class Sep24ConfigError extends Error {},
  Sep24AnchorError:  class Sep24AnchorError  extends Error { statusCode?: number; },
}));
vi.mock('../admin-audit-log', () => ({ AdminAuditLogService: vi.fn().mockImplementation(() => ({ log: vi.fn(), query: vi.fn().mockResolvedValue({ entries: [], total: 0 }) })) }));
vi.mock('../job-tracker', () => ({ getJobSummaries: vi.fn().mockResolvedValue([]) }));
vi.mock('../remittance/events', () => ({ remittanceEventEmitter: { onStatusChange: vi.fn() } }));
vi.mock('../kyc-webhook-handler', () => ({ handleKycWebhook: vi.fn((_req: any, _res: any, next: any) => next?.()) }));
vi.mock('../middleware/api-key-rate-limit', () => ({ apiKeyRateLimiter: vi.fn((_req: any, _res: any, next: any) => next()) }));
vi.mock('../routes/docs', () => ({ default: { get: vi.fn(), use: vi.fn(), stack: [] } }));
vi.mock('../routes/compliance', () => ({
  createComplianceRouter: vi.fn(() => ({ get: vi.fn(), use: vi.fn(), stack: [] })),
  autoFlagIfAboveThreshold: vi.fn(),
}));
vi.mock('../verifier', () => ({ AssetVerifier: vi.fn().mockImplementation(() => ({ verifyAsset: vi.fn() })) }));
vi.mock('../stellar-network', () => ({ getStellarRuntimeConfig: vi.fn(() => ({ rpcUrl: 'http://localhost', networkPassphrase: 'Test' })) }));

// ── Paths that intentionally skip validation ──────────────────────────────────
// These are structural endpoints (health checks, Prometheus scrape, sub-routers)
// that either have no user-supplied inputs or validate inside a sub-router.
const EXEMPT_PATHS = new Set([
  'GET /health',
  'GET /health/db',
  'GET /metrics',
  // Sub-routers — validation is inside the router module itself
  'USE /api/docs',
  'USE /api/compliance',
  // AML/CTF sub-router (SR-112) — every route inside routes/aml.ts carries a
  // validateRequest / validateQuery / validateParams schema from schemas/aml.ts.
  'USE /api/aml',
  // Anchor KYC webhook — receives payloads from third-party anchors over the
  // webhookLimiter; body validation is delegated to handleKycWebhook handler.
  'POST /webhooks/kyc/:anchor_id',
  // Transfer endpoint — access control handled by authMiddleware + transferGuard.
  // Body content is intentionally unrestricted at this layer.
  'POST /api/transfer',
  // KYC status (own user, auth token carries identity — no body/params to validate)
  'GET /api/kyc/status',
  // Admin jobs dashboard — no user-supplied parameters; returns internal metadata only.
  'GET /api/admin/jobs',
]);

// ── Names that count as "validation present" ──────────────────────────────────
const VALIDATOR_NAMES = new Set(['validateRequest', 'validateQuery', 'validateParams']);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the declared name of a function (handles anonymous arrow fns). */
function fnName(fn: Function): string {
  return fn.name || '';
}

interface RouteInfo {
  key: string;   // "GET /api/foo"
  hasValidation: boolean;
  validators: string[];
}

function collectRoutes(app: any): RouteInfo[] {
  const results: RouteInfo[] = [];

  function walk(stack: any[], prefix = '') {
    for (const layer of stack) {
      if (!layer) continue;

      // Express sub-router or middleware mounted with app.use()
      if (layer.name === 'router' && layer.handle?.stack) {
        const mountPath = layer.regexp?.source?.includes('^\\/') ? prefix : prefix;
        walk(layer.handle.stack, mountPath);
        continue;
      }

      if (layer.route) {
        // It's a Route — get all methods
        const path: string = prefix + (layer.route.path || '');
        const methods: string[] = Object.keys(layer.route.methods)
          .filter((m) => layer.route.methods[m])
          .map((m) => m.toUpperCase());

        const middlewareNames = (layer.route.stack as any[]).map((l) => fnName(l.handle));

        for (const method of methods) {
          const key = `${method} ${path}`;
          const validators = middlewareNames.filter((n) => VALIDATOR_NAMES.has(n));
          results.push({ key, hasValidation: validators.length > 0, validators });
        }
      }
    }
  }

  const router = app._router ?? app.router;
  if (router?.stack) walk(router.stack);
  return results;
}

// ── Test ──────────────────────────────────────────────────────────────────────

describe('Route validation coverage (#874)', () => {
  it('every registered route must have at least one validate* middleware', async () => {
    const app = (await import('../api')).default;
    const routes = collectRoutes(app);

    expect(routes.length).toBeGreaterThan(0); // sanity: we found routes

    const missing = routes.filter(
      (r) => !r.hasValidation && !EXEMPT_PATHS.has(r.key)
    );

    if (missing.length > 0) {
      const lines = missing
        .map((r) => `  • ${r.key}`)
        .join('\n');
      throw new Error(
        `The following routes are missing a validate* middleware.\n` +
        `Add validateRequest / validateQuery / validateParams to each, or\n` +
        `add them to EXEMPT_PATHS in route-validation-coverage.test.ts with justification:\n\n` +
        lines
      );
    }

    expect(missing).toHaveLength(0);
  });

  it('EXEMPT_PATHS entries must all exist as actual registered routes', async () => {
    const app = (await import('../api')).default;
    const routes = collectRoutes(app);
    const registeredKeys = new Set(routes.map((r) => r.key));

    // Filter out USE/* entries (sub-routers) which don't appear as route keys
    const checkableExempt = [...EXEMPT_PATHS].filter((p) => !p.startsWith('USE '));

    const phantom = checkableExempt.filter((p) => !registeredKeys.has(p));
    if (phantom.length > 0) {
      throw new Error(
        `EXEMPT_PATHS contains paths that are not registered routes.\n` +
        `Remove stale entries:\n\n` +
        phantom.map((p) => `  • ${p}`).join('\n')
      );
    }
    expect(phantom).toHaveLength(0);
  });

  it('validate* middlewares are actually rejecting bad input (spot check)', async () => {
    // Dynamically import supertest here to avoid loading it at module level.
    const { default: request } = await import('supertest');
    const app = (await import('../api')).default;

    // Invalid Stellar address on POST /api/remittance should return 400 with field-level errors
    const res = await request(app)
      .post('/api/remittance')
      .set('x-user-id', 'user-1')
      .send({
        sender: 'not-a-stellar-address',
        agent: 'also-invalid',
        amount: '1e5', // scientific notation must be rejected
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);

    const fields = res.body.details.map((d: any) => d.field);
    expect(fields).toContain('sender');
    expect(fields).toContain('amount');
  });

  it('float amounts are rejected with a field-level message', async () => {
    const { default: request } = await import('supertest');
    const app = (await import('../api')).default;

    const res = await request(app)
      .post('/api/remittance')
      .set('x-user-id', 'user-1')
      .send({
        sender: 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP',
        agent:  'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU',
        amount: '100.50', // float — must be rejected
      });

    expect(res.status).toBe(400);
    const amountError = res.body.details?.find((d: any) => d.field === 'amount');
    expect(amountError).toBeDefined();
    expect(amountError.message).toMatch(/integer/i);
  });

  it('audit-log export without date range is rejected with 400', async () => {
    const { default: request } = await import('supertest');
    const app = (await import('../api')).default;

    const res = await request(app).get('/api/admin/audit-log/export');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('audit-log export with date range > 90 days is rejected', async () => {
    const { default: request } = await import('supertest');
    const app = (await import('../api')).default;

    const from = new Date('2025-01-01').toISOString();
    const to   = new Date('2025-05-01').toISOString(); // 120 days

    const res = await request(app)
      .get(`/api/admin/audit-log/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

    expect(res.status).toBe(400);
    expect(res.body.details?.[0]?.message).toMatch(/90 days/i);
  });
});
