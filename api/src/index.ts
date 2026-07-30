// MUST be imported first so OTel patches are applied before other modules load
import './tracing';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { createApp } from './app';
import { initializeCurrencyConfig } from './config';
import { initWebSocket } from './websocket';
import { getJwtSecret, getDatabaseUrl } from './secrets-manager';
import { createLogger } from './types';
import { assertEnvConfigured } from './env-guard';

dotenv.config();
// Fail fast on missing / placeholder configuration (SR-102) before anything
// tries to use it.
assertEnvConfigured();

const logger = createLogger('main');
const PORT = process.env.PORT || 3000;

/**
 * Load every required secret before any service is initialised.
 *
 * In production this calls the real AWS Secrets Manager.  If a required
 * secret resolves from a plaintext env var in production the shared
 * SecretsManager throws a PRODUCTION SECURITY VIOLATION error and the
 * process exits before accepting any traffic.
 *
 * Required secrets for this service:
 *   JWT_SECRET    — JWT signing key (shared with backend)
 *   DATABASE_URL  — PostgreSQL connection string (for health checks)
 */
async function loadSecrets(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !process.env.AWS_REGION) {
    logger.error(
      'FATAL: NODE_ENV=production but AWS_REGION is not set. ' +
        'The secrets manager cannot reach AWS Secrets Manager. ' +
        'Set AWS_REGION (and optionally SECRETS_MANAGER_ENABLED=true) before starting.',
    );
    process.exit(1);
  }

  // Resolve all required secrets — throws immediately if any are missing or
  // (in production) fall back to a plaintext environment variable.
  const [jwtSecret, databaseUrl] = await Promise.all([
    getJwtSecret(),
    getDatabaseUrl(),
  ]);

  // Write resolved values back into process.env so legacy code that reads
  // env vars directly still works.  These writes are safe because the values
  // came from the secret store, not the raw environment.
  process.env.JWT_SECRET = jwtSecret;
  process.env.DATABASE_URL = databaseUrl;

  logger.info('[secrets] All required secrets loaded successfully');
}

async function start() {
  try {
    // Load secrets from Secrets Manager before initializing services
    await loadSecrets();

    // Initialize and validate currency configuration (fail fast)
    logger.info('Initializing currency configuration...');
    initializeCurrencyConfig();

    // Create a bare HTTP server first so Socket.IO can attach to it.
    const httpServer = createServer();

    // Attach WebSocket server before the Express app is wired up.
    const io = initWebSocket(httpServer);

    // Build the Express app with the io instance so /ws/health is mounted.
    const app = createApp({ io });

    // Wait for the anchor catalogue to be seeded into the DB before we
    // accept traffic (SR-060).  In dev/test without DATABASE_URL this is a
    // no-op Promise that resolves immediately.
    await (app as any).__anchorBootstrap;

    // Wire the Express app as the HTTP request handler.
    httpServer.on('request', app);

    httpServer.listen(PORT, () => {
      logger.info(`SwiftRemit API server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
      logger.info(`Currencies API: http://localhost:${PORT}/api/currencies`);
      logger.info(`WebSocket: ws://localhost:${PORT}`);
      if (process.env.NODE_ENV === 'development') {
        logger.info(`WS health: http://localhost:${PORT}/ws/health`);
      }
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1); // Fail fast
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason });
});

start();