import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import currenciesRouter from './routes/currencies';
import limitsRouter from './routes/limits';
import { createAnchorsRouter } from './routes/anchors';
import docsRouter from './routes/docs';
import settlementsRouter from './routes/settlements';
import { createRemittancesRouter, RemittancesRouterOptions } from './routes/remittances';
import { createAdminRouter } from './routes/admin';
import { createAnalyticsRouter } from './routes/analytics';
import { createAgentsRouter } from './routes/agents';
import { createAuthRouter } from './routes/auth';
import { createAccountsRouter } from './routes/accounts';
import { getApiMetrics } from './metrics';
import { ErrorResponse } from './types';
import { AnchorStore, PostgresAnchorStore, createAnchorPool } from './db/anchorStore';
import { Server as SocketIOServer } from 'socket.io';
import { createWsHealthRouter } from './websocket/health';
import { createRateLimitMiddleware, addRateLimitHeaders } from './middleware/rateLimitHeaders';
import { createGraphQLRouter } from './routes/graphql';
import { createLivenessRouter, createReadinessRouter } from './routes/health';
import { initPool, getPool } from './db/pool';

type AppOptions = {
  anchorStore?: AnchorStore;
  anchorAdminApiKey?: string;
  /** Socket.IO instance — when provided, mounts the /ws/health route */
  io?: SocketIOServer;
  /** Instrumented database pool — when provided, mounts readiness checks */
  pool?: Pool;
} & RemittancesRouterOptions;

async function probeUrl(urlString: string, timeoutMs = 2000): Promise<{ status: number; ok: boolean; message?: string }> {
  try {
    const parsed = new URL(urlString);
    const client = parsed.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const request = client.request(
        parsed,
        {
          method: 'HEAD',
          timeout: timeoutMs,
        },
        (response) => {
          resolve({
            status: response.statusCode ?? 0,
            ok: response.statusCode !== undefined && response.statusCode < 400,
            message: response.statusMessage || '',
          });
        },
      );

      request.on('error', (error) => reject(error));
      request.on('timeout', () => {
        request.destroy(new Error('Request timed out'));
      });
      request.end();
    });
  } catch (error) {
    return {
      status: 0,
      ok: false,
      message: error instanceof Error ? error.message : 'Invalid URL',
    };
  }
}

async function checkDatabaseConnectivity(pool?: Pool) {
  if (!pool) {
    return {
      status: 'not_configured' as const,
      message: 'DATABASE_URL is not configured',
    };
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return { status: 'ok' as const };
  } catch (error) {
    return {
      status: 'error' as const,
      message: error instanceof Error ? error.message : 'Database connection failed',
    };
  } finally {
    client.release();
  }
}

async function checkContractReachability() {
  const contractRpcUrl = process.env.CONTRACT_RPC_URL;

  if (!contractRpcUrl) {
    return {
      status: 'not_configured' as const,
      message: 'CONTRACT_RPC_URL is not configured',
    };
  }

  const result = await probeUrl(contractRpcUrl);
  return {
    status: result.ok ? ('ok' as const) : ('error' as const),
    endpoint: contractRpcUrl,
    message: result.ok
      ? 'Contract RPC endpoint is reachable'
      : `Contract RPC endpoint check failed: ${result.message || `HTTP ${result.status}`}`,
  };
}

export function createApp(options: AppOptions = {}): Application {
  const app = express();

  // Initialize instrumented pool if DATABASE_URL is configured
  const pool = options.pool ?? (process.env.DATABASE_URL ? initPool() : null);

  // Security middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // Request instrumentation (SR-104) — mounted before the rate limiter so
  // shed requests are counted too. Feeds the API latency and error-rate panels.
  const apiMetrics = getApiMetrics();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      const route = (req.route?.path ?? (req.baseUrl || req.path)) || 'unknown';
      apiMetrics.recordHttpRequest(req.method, route, res.statusCode, durationSeconds);
    });
    next();
  });

  // Prometheus scrape endpoint — deliberately outside /api/ so it is not
  // rate limited.
  app.get('/metrics', async (_req: Request, res: Response) => {
    await apiMetrics.refresh(options.io);
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(apiMetrics.generatePrometheusText());
  });

  // Rate limiting with RFC 6585 headers
  const limiter = createRateLimitMiddleware();
  app.use('/api/', limiter);
  app.use(addRateLimitHeaders);

  // ─── Health probes (Issue #1134) ────────────────────────────────────────────
  // Liveness: process is alive
  app.use('/healthz', createLivenessRouter());
  // Readiness: DB reachable, migrations applied, pool not saturated
  app.use('/readyz', createReadinessRouter(pool));

  // ─── Legacy /health endpoint (deprecated; kept for backward compat) ─────────
  app.get('/health', async (_req: Request, res: Response) => {
    const [dbResult, contractResult] = await Promise.all([
      checkDatabaseConnectivity(pool ?? undefined),
      checkContractReachability(),
    ]);

    const allHealthy = [dbResult, contractResult].every(
      (item) => item.status === 'ok' || item.status === 'not_configured',
    );

    res.json({
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: dbResult,
        contract: contractResult,
      },
    });
  });

  // API routes
  app.use('/api/currencies', currenciesRouter);
  app.use('/api/limits', limitsRouter);
  // ── Anchor catalogue bootstrap (SR-060) ─────────────────────────────────
  // When no explicit store is injected (production path) and DATABASE_URL is
  // set, spin up a PostgresAnchorStore, ensure the schema exists, and seed
  // the default catalogue so the database is the single source of truth.
  //
  // We use a mutable container so the router's per-request getStore() call
  // sees the resolved store even though the bootstrap completes asynchronously
  // after createApp() returns.  Tests inject their own store via options and
  // never set DATABASE_URL, so they skip this block entirely.
  const storeContainer: { store: AnchorStore | undefined } = {
    store: options.anchorStore,
  };

  const anchorBootstrapPromise: Promise<void> =
    !storeContainer.store && process.env.DATABASE_URL
      ? (async () => {
          try {
            const pool = createAnchorPool();
            const pgStore = new PostgresAnchorStore(pool);
            await pgStore.initializeSchema();
            await pgStore.seedFromDefaults();
            storeContainer.store = pgStore;
          } catch (err) {
            console.warn(
              '[anchor-catalogue] Seed failed (falling back to default store):',
              err,
            );
          }
        })()
      : Promise.resolve();

  // Expose the bootstrap promise so index.ts can await it before accepting
  // traffic.  Tests (no DATABASE_URL, injected store) get a no-op Promise.
  (app as any).__anchorBootstrap = anchorBootstrapPromise;

  app.use(
    '/api/anchors',
    createAnchorsRouter({
      // Pass a getter so every request picks up storeContainer.store after
      // the async bootstrap has populated it.
      store: new Proxy({} as AnchorStore, {
        get(_target, prop) {
          const s = storeContainer.store ?? (() => { throw new Error('Anchor store not yet initialised'); })();
          return (s as any)[prop];
        },
      }),
      adminApiKey: options.anchorAdminApiKey,
    }),
  );

  // Settlement simulation — authenticated, read-only, no state changes (Issues #420, SR-166)
  app.use('/api/settlements', settlementsRouter);

  // Remittances — cursor-based pagination (Issues #472, #531)
  app.use('/api/remittances', createRemittancesRouter({
    remittanceStore: options.remittanceStore,
  }));

  // Admin utilities — read-only operations (simulate-upgrade, etc.)
  app.use('/api/admin', createAdminRouter(pool));

  // Corridor analytics (Issue #482)
  const analyticsPool = pool ?? (process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
    : null);
  if (analyticsPool) {
    app.use('/api/analytics', createAnalyticsRouter(analyticsPool, options.anchorAdminApiKey ?? process.env.ANALYTICS_ADMIN_API_KEY));
  }

  // API documentation
  app.use('/api/docs', docsRouter);

  // Auth — JWT login / refresh / logout (Issue #883)
  app.use('/api/auth', createAuthRouter());

  // Agents — registration and management (Issue #880)
  app.use('/api/agents', createAgentsRouter());

  // Accounts — Stellar fee estimation and XLM balance (Issue #949)
  app.use('/api/accounts', createAccountsRouter());

  // GraphQL — authenticated, depth/complexity limited (SR-050). The router
  // existed but was never mounted, so the endpoint was unreachable.
  app.use('/api/graphql', createGraphQLRouter({
    pool: analyticsPool ?? undefined,
    remittanceStore: options.remittanceStore,
  }));

  // WebSocket health endpoint (development only — guarded inside the router)
  if (options.io) {
    app.use('/ws/health', createWsHealthRouter(options.io));
  }

  // 404 handler
  app.use((req: Request, res: Response) => {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        message: `Route not found: ${req.method} ${req.path}`,
        code: 'ROUTE_NOT_FOUND',
      },
      timestamp: new Date().toISOString(),
    };
    res.status(404).json(errorResponse);
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);

    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        message: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : err.message,
        code: 'INTERNAL_SERVER_ERROR',
      },
      timestamp: new Date().toISOString(),
    };

    res.status(500).json(errorResponse);
  });

  return app;
}

/**
 * Export getPool so index.ts can use it for clean shutdown.
 */
export { getPool };
