import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
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
import { ErrorResponse } from './types';
import { AnchorStore } from './db/anchorStore';
import { Server as SocketIOServer } from 'socket.io';
import { createWsHealthRouter } from './websocket/health';

type AppOptions = {
  anchorStore?: AnchorStore;
  anchorAdminApiKey?: string;
  /** Socket.IO instance — when provided, mounts the /ws/health route */
  io?: SocketIOServer;
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
  const healthDbPool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    : undefined;

  // Security middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // Rate limiting
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    message: {
      success: false,
      error: {
        message: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
      timestamp: new Date().toISOString(),
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/', limiter);

  // Health check endpoint
  app.get('/health', async (req: Request, res: Response) => {
    const [dbResult, contractResult] = await Promise.all([
      checkDatabaseConnectivity(healthDbPool),
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
  app.use(
    '/api/anchors',
    createAnchorsRouter({
      store: options.anchorStore,
      adminApiKey: options.anchorAdminApiKey,
    }),
  );

  // Settlement simulation — read-only, no state changes (Issue #420)
  app.use('/api/settlements', settlementsRouter);

  // Remittances — cursor-based pagination (Issues #472, #531)
  app.use('/api/remittances', createRemittancesRouter({
    remittanceStore: options.remittanceStore,
  }));

  // Admin utilities — read-only operations (simulate-upgrade, etc.)
  app.use('/api/admin', createAdminRouter());

  // Corridor analytics (Issue #482)
  const analyticsPool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
    : null;
  if (analyticsPool) {
    app.use('/api/analytics', createAnalyticsRouter(analyticsPool, options.anchorAdminApiKey ?? process.env.ANALYTICS_ADMIN_API_KEY));
  }

  // API documentation
  app.use('/api/docs', docsRouter);

  // Auth — JWT login / refresh / logout (Issue #883)
  app.use('/api/auth', createAuthRouter());

  // Agents — registration and management (Issue #880)
  app.use('/api/agents', createAgentsRouter());

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
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
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
