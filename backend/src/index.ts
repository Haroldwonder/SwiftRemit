// MUST be imported first so OTel patches are applied before other modules load
import './tracing';
import dotenv from 'dotenv';
import http from 'http';
import app from './api';
import { FxRateWebSocketServer } from './fx-rate-websocket';
import { initDatabase, getPool, closePool } from './database';
import { migrate } from './migrate';
import { startBackgroundJobs } from './scheduler';
import { WebhookHandler } from './webhook-handler';
import { KycService } from './kyc-service';
import { createWebhookVerificationMiddleware } from './webhook-middleware';
import { patchConsoleForProduction } from './console-shim';
import { getSecretsManager, getDatabaseUrl, getAdminSecretKey, getContractId, initializeSecretRotation } from './secrets-manager';

dotenv.config();
patchConsoleForProduction();

const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '30000', 10);

let webhookHandler: WebhookHandler | null = null;

async function loadSecrets(): Promise<void> {
  const sm = getSecretsManager();

  const databaseUrl = await getDatabaseUrl();
  const adminSecretKey = await getAdminSecretKey();
  const contractId = await getContractId();

  process.env.DATABASE_URL = databaseUrl;
  process.env.ADMIN_SECRET_KEY = adminSecretKey;
  process.env.CONTRACT_ID = contractId;

  console.log('[secrets] All required secrets loaded successfully');
}

async function start() {
  try {
    // Load secrets from Secrets Manager before initializing services
    await loadSecrets();

    // Initialize secret rotation hooks
    await initializeSecretRotation();

    // Initialize database
    await initDatabase();
    console.log('Database initialized');

    // Run pending migrations automatically on startup
    const pool = getPool();
    await migrate(pool);
    console.log('Migrations applied');

    // Initialize KYC service
    const kycService = new KycService();
    await kycService.initialize();
    console.log('KYC service initialized');

    // Apply HMAC verification middleware to all /webhooks routes
    const webhookVerification = createWebhookVerificationMiddleware({
      timestampWindowSeconds: 300,
      requireSignature: true,
    });

    app.use('/webhooks', (req, res, next) => {
      if (req.path === '/health') {
        next();
      } else {
        webhookVerification(req, res, next);
      }
    });

    webhookHandler = new WebhookHandler(pool);
    webhookHandler.setupRoutes(app);
    webhookHandler.setupHealthCheck(app);
    console.log('Webhook endpoints configured');

    // Start background jobs
    startBackgroundJobs();

    // Start API server via http.Server so we can call server.close()
    const server = http.createServer(app);

    // Attach WebSocket server for real-time FX rate pushes
    const fxRateWss = new FxRateWebSocketServer(server);

    server.listen(PORT, () => {
      console.log(`SwiftRemit Verification Service running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`FX rate WebSocket available at ws://...:${PORT}/ws/fx-rates`);
    });

    // Graceful shutdown
    async function shutdown(signal: string): Promise<void> {
      console.log(`\n${signal} received — starting graceful shutdown…`);

      server.close(() => {
        console.log('HTTP server closed (no new connections accepted)');
      });

      if (webhookHandler) {
        const dispatcher = (webhookHandler as any).dispatcher;
        if (dispatcher && typeof dispatcher.drain === 'function') {
          await dispatcher.drain(SHUTDOWN_TIMEOUT_MS);
        }
      }

      fxRateWss.close();

      try {
        await closePool();
        console.log('PostgreSQL pool closed');
      } catch (err) {
        console.error('Error closing PostgreSQL pool:', err);
      }

      console.log('Graceful shutdown complete. Exiting.');
      process.exit(0);
    }

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();