// MUST be imported first so OTel patches are applied before other modules load
import './tracing';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { createApp } from './app';
import { initializeCurrencyConfig } from './config';
import { initWebSocket } from './websocket';
import { getSecretsManager, getJwtSecret, getDatabaseUrl } from './secrets-manager';
import { createLogger } from './types';

dotenv.config();

const logger = createLogger('main');
const PORT = process.env.PORT || 3000;

async function loadSecrets(): Promise<void> {
  const sm = getSecretsManager();

  // Load JWT_SECRET from Secrets Manager
  const jwtSecret = await getJwtSecret();
  process.env.JWT_SECRET = jwtSecret;

  // Load DATABASE_URL from Secrets Manager (for health check dependency)
  const databaseUrl = await getDatabaseUrl();
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