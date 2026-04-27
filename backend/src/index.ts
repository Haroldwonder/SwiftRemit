// MUST be imported first so OTel patches are applied before other modules load
import './tracing';
import dotenv from 'dotenv';
import app from './api';
import { initDatabase, getPool } from './database';
import { migrate } from './migrate';
import { startBackgroundJobs } from './scheduler';
import { WebhookHandler } from './webhook-handler';
import { KycService } from './kyc-service';
import { createWebhookVerificationMiddleware } from './webhook-middleware';
import { AdminAuditLogService } from './admin-audit-log';
import { remittanceEventEmitter } from './remittance/events';

dotenv.config();

const PORT = process.env.PORT || 3000;

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

    // Setup webhook handler
    // (pool already declared above)
    
    // Apply HMAC verification middleware to all /webhooks routes
    const webhookVerification = createWebhookVerificationMiddleware({
      timestampWindowSeconds: 300, // 5 minutes
      requireSignature: true,
    });
    
    // Use before webhook routes - but skip for health check
    app.use('/webhooks', (req, res, next) => {
      if (req.path === '/health') {
        next();
      } else {
        webhookVerification(req, res, next);
      }
    });
    
    const webhookHandler = new WebhookHandler(pool);
    webhookHandler.setupRoutes(app);
    webhookHandler.setupHealthCheck(app);
    console.log('Webhook endpoints configured');

    // Start background jobs
    startBackgroundJobs();

    // Start API server
    app.listen(PORT, () => {
      console.log(`SwiftRemit Verification Service running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
