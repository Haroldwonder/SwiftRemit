// MUST be imported first so OTel patches are applied before other modules load
import './tracing';
import dotenv from 'dotenv';
import http from 'http';
import app from './api';
import { initDatabase, getPool, closePool } from './database';
import { migrate } from './migrate';
import { startBackgroundJobs } from './scheduler';
import { WebhookHandler } from './webhook-handler';
import { KycService } from './kyc-service';
import { createWebhookVerificationMiddleware } from './webhook-middleware';

dotenv.config();

const PORT = process.env.PORT || 3000;
/** Graceful-shutdown timeout in milliseconds (configurable via env). */
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '30000', 10);

// Module-level reference so signal handlers can reach the dispatcher.
let webhookHandler: WebhookHandler | null = null;

async function start() {
  try {
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
      timestampWindowSeconds: 300, // 5 minutes
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
    server.listen(PORT, () => {
      console.log(`SwiftRemit Verification Service running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // ── Graceful shutdown ────────────────────────────────────────────────────

    async function shutdown(signal: string): Promise<void> {
      console.log(`\n${signal} received — starting graceful shutdown…`);

      // 1. Stop accepting new HTTP connections
      server.close(() => {
        console.log('HTTP server closed (no new connections accepted)');
      });

      // 2. Drain in-flight webhook dispatches
      if (webhookHandler) {
        const dispatcher = (webhookHandler as any).dispatcher;
        if (dispatcher && typeof dispatcher.drain === 'function') {
          await dispatcher.drain(SHUTDOWN_TIMEOUT_MS);
        }
      }

      // 3. Close the PostgreSQL pool
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
    process.once('SIGINT',  () => shutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
