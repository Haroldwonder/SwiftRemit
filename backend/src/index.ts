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
import { remittanceEventEmitter } from './remittance/events';
import { NotificationService } from './notification-service';
import { WebhookService } from './webhooks';
import { PostgresWebhookStore } from './webhooks/store';
import { patchConsoleForProduction } from './console-shim';
import { getSecretsManager, getDatabaseUrl, getAdminSecretKey, getContractId, initializeSecretRotation } from './secrets-manager';
import { assertEnvConfigured } from './env-guard';

dotenv.config();
// Fail fast on missing / placeholder configuration (SR-102) before anything
// tries to use it.
assertEnvConfigured();
patchConsoleForProduction();

const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '30000', 10);

let webhookHandler: WebhookHandler | null = null;

/**
 * Load every required secret before any service is initialised.
 *
 * In production this calls the real AWS Secrets Manager.  If a required
 * secret resolves from a plaintext env var in production the shared
 * SecretsManager throws a PRODUCTION SECURITY VIOLATION error and the
 * process exits before accepting any traffic.
 *
 * Required secrets for this service:
 *   JWT_SECRET        — JWT signing key
 *   DATABASE_URL      — PostgreSQL connection string
 *   ADMIN_SECRET_KEY  — internal admin operations key
 *   CONTRACT_ID       — deployed Stellar contract address
 */
async function loadSecrets(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !process.env.AWS_REGION) {
    console.error(
      '[secrets] FATAL: NODE_ENV=production but AWS_REGION is not set. ' +
        'The secrets manager cannot reach AWS Secrets Manager. ' +
        'Set AWS_REGION (and optionally SECRETS_MANAGER_ENABLED=true) before starting.',
    );
    process.exit(1);
  }

  // Resolve all required secrets — throws immediately if any are missing or
  // (in production) fall back to a plaintext environment variable.
  const [databaseUrl, adminSecretKey, contractId] = await Promise.all([
    getDatabaseUrl(),
    getAdminSecretKey(),
    getContractId(),
  ]);

  // Write resolved values back into process.env so legacy code that reads
  // env vars directly still works.  These writes are safe because the values
  // came from the secret store, not the raw environment.
  process.env.DATABASE_URL = databaseUrl;
  process.env.ADMIN_SECRET_KEY = adminSecretKey;
  process.env.CONTRACT_ID = contractId;

  // JWT_SECRET is used via getJwtSecret() at call sites; no env write needed.

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

    // Wire the remittance event emitter's optional collaborators. Both were
    // previously left unset in production, so RemittanceEventEmitter's
    // webhook fan-out and email/SMS notification paths never ran for a
    // real status change — only the DB-persistence listener in
    // routes/remittance.ts fired.
    remittanceEventEmitter.setWebhookService(new WebhookService(new PostgresWebhookStore(pool)));
    remittanceEventEmitter.setNotificationService(new NotificationService(pool));
    console.log('Remittance notification and webhook fan-out wired');

    // Start background jobs
    startBackgroundJobs();

    // Start on-chain reconciler (Feature C) — compares DB state to contract every 5 min
    const { startReconcilerSchedule } = await import('./reconciler');
    startReconcilerSchedule(pool);
    console.log('On-chain reconciler scheduled');

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

      // Stop reconciler schedule cleanly
      try {
        const { stopReconcilerSchedule } = await import('./reconciler');
        stopReconcilerSchedule();
        console.log('On-chain reconciler stopped');
      } catch { /* non-fatal */ }

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