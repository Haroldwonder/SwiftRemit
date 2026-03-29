import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { WebhookVerifier } from './webhook-verifier';
import { WebhookLogger } from './webhook-logger';
import { TransactionStateManager, TransactionUpdate, KYCUpdate } from './transaction-state';
import { KycUpsertService } from './kyc-upsert-service';
import { getCorrelationId } from './correlation-id';
import { MetricsService } from './metrics';

interface WebhookRequest extends Request {
  rawBody?: string;
}

export class WebhookHandler {
  private verifier: WebhookVerifier;
  private logger: WebhookLogger;
  private stateManager: TransactionStateManager;
  private kycUpsertService: KycUpsertService;
  private metricsService: MetricsService;

  constructor(private pool: Pool) {
    this.verifier = new WebhookVerifier(300); // 5 minute replay window
    this.logger = new WebhookLogger(pool);
    this.stateManager = new TransactionStateManager(pool);
    this.kycUpsertService = new KycUpsertService(pool);
    this.metricsService = new MetricsService(pool);
  }

  /**
   * Get correlation ID for logging
   */
  private getLogContext(): { correlation_id?: string } {
    const correlationId = getCorrelationId();
    return correlationId ? { correlation_id: correlationId } : {};
  }

  /**
   * Middleware to capture raw body for signature verification
   */
  rawBodyMiddleware() {
    return express.json({
      verify: (req: WebhookRequest, res, buf) => {
        req.rawBody = buf.toString('utf8');
      }
    });
  }

  /**
   * Main webhook endpoint handler
   */
  async handleWebhook(req: WebhookRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const logContext = this.getLogContext();
    
    console.log('Processing webhook', { 
      headers: {
        'x-signature': req.headers['x-signature'],
        'x-timestamp': req.headers['x-timestamp'],
        'x-nonce': req.headers['x-nonce'],
        'x-anchor-id': req.headers['x-anchor-id']
      },
      ...logContext 
    });
    
    try {
      // Extract headers
      const signature = req.headers['x-signature'] as string;
      const timestamp = req.headers['x-timestamp'] as string;
      const nonce = req.headers['x-nonce'] as string;
      const anchorId = req.headers['x-anchor-id'] as string;

      if (!signature || !timestamp || !nonce || !anchorId) {
        console.log('Missing required headers', { anchorId, ...logContext });
        res.status(400).json({ error: 'Missing required headers' });
        return;
      }

      console.log('Verifying webhook', { anchorId, ...logContext });

      // Get anchor public key
      const anchorResult = await this.pool.query(
        'SELECT public_key, webhook_secret FROM anchors WHERE id = $1',
        [anchorId]
      );

      if (anchorResult.rows.length === 0) {
        console.log('Anchor not found', { anchorId, ...logContext });
        res.status(404).json({ error: 'Anchor not found' });
        return;
      }

      const { public_key, webhook_secret } = anchorResult.rows[0];

      // Verify timestamp
      if (!this.verifier.validateTimestamp(timestamp)) {
        console.log('Invalid timestamp', { anchorId, timestamp, ...logContext });
        await this.logSuspicious(anchorId, 'Invalid timestamp', req.body);
        res.status(401).json({ error: 'Invalid timestamp' });
        return;
      }

      // Verify nonce
      if (!this.verifier.validateNonce(nonce)) {
        console.log('Duplicate nonce (replay attack)', { anchorId, nonce, ...logContext });
        await this.logSuspicious(anchorId, 'Duplicate nonce (replay attack)', req.body);
        res.status(401).json({ error: 'Invalid nonce' });
        return;
      }

      // Verify signature
      const rawBody = req.rawBody || JSON.stringify(req.body);
      const signatureValid = webhook_secret
        ? this.verifier.verifyHMAC(rawBody, signature, webhook_secret)
        : this.verifier.verifySignature(rawBody, signature, public_key);

      if (!signatureValid) {
        console.log('Invalid signature', { anchorId, ...logContext });
        await this.logSuspicious(anchorId, 'Invalid signature', req.body);
        this.metricsService.incrementWebhookDeliveries('failed', req.body.event_type || 'unknown', anchorId);
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      console.log('Webhook signature verified', { anchorId, ...logContext });

      // Process webhook
      const { event_type, transaction_id } = req.body;

      // Log webhook
      const webhookId = await this.logger.logWebhook(
        anchorId,
        transaction_id,
        event_type,
        req.body,
        true
      );

      console.log('Webhook logged', { anchorId, transaction_id, event_type, webhookId, ...logContext });

      // Check for suspicious patterns
      const suspiciousReasons = await this.logger.checkSuspiciousPatterns(
        anchorId,
        transaction_id
      );

      if (suspiciousReasons.length > 0) {
        console.log('Suspicious patterns detected', { 
          anchorId, 
          transaction_id, 
          reasons: suspiciousReasons,
          ...logContext 
        });
        await this.logSuspicious(anchorId, suspiciousReasons.join(', '), req.body, webhookId);
      }

      // Route to appropriate handler
      switch (event_type) {
        case 'deposit_update':
          console.log('Handling deposit update', { transaction_id, ...logContext });
          await this.handleDepositUpdate(req.body);
          break;
        case 'withdrawal_update':
          console.log('Handling withdrawal update', { transaction_id, ...logContext });
          await this.handleWithdrawalUpdate(req.body);
          break;
        case 'kyc_update':
          console.log('Handling KYC update', { transaction_id, ...logContext });
          await this.handleKYCUpdate(req.body, anchorId);
          break;
        default:
          console.log('Unknown event type', { event_type, ...logContext });
          res.status(400).json({ error: 'Unknown event type' });
          return;
      }

      const processingTime = Date.now() - startTime;
      console.log('Webhook processing completed', { 
        processingTime,
        transaction_id,
        ...logContext 
      });
      
      // Track successful webhook delivery
      this.metricsService.incrementWebhookDeliveries('success', event_type, anchorId);
      
      res.status(200).json({ 
        success: true, 
        processing_time_ms: processingTime 
      });

    } catch (error) {
      console.error('Webhook processing error:', error, { ...logContext });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle deposit update webhook
   */
  private async handleDepositUpdate(payload: any): Promise<void> {
    const logContext = this.getLogContext();
    const update: TransactionUpdate = {
      transaction_id: payload.transaction_id,
      status: payload.status,
      status_eta: payload.status_eta,
      amount_in: payload.amount_in,
      amount_out: payload.amount_out,
      amount_fee: payload.amount_fee,
      stellar_transaction_id: payload.stellar_transaction_id,
      external_transaction_id: payload.external_transaction_id,
      message: payload.message
    };

    console.log('Handling deposit update', { 
      transaction_id: update.transaction_id,
      status: update.status,
      ...logContext 
    });

    // Get current status
    const result = await this.pool.query(
      'SELECT status FROM transactions WHERE transaction_id = $1',
      [update.transaction_id]
    );

    if (result.rows.length === 0) {
      console.log('Transaction not found for deposit update', { 
        transaction_id: update.transaction_id,
        ...logContext 
      });
      throw new Error('Transaction not found');
    }

    const currentStatus = result.rows[0].status;

    // Validate transition
    if (!this.stateManager.validateTransition(currentStatus, update.status, 'deposit')) {
      console.log('Invalid state transition for deposit', { 
        transaction_id: update.transaction_id,
        fromStatus: currentStatus,
        toStatus: update.status,
        ...logContext 
      });
      throw new Error(`Invalid state transition: ${currentStatus} -> ${update.status}`);
    }

    console.log('Valid state transition for deposit', { 
      transaction_id: update.transaction_id,
      fromStatus: currentStatus,
      toStatus: update.status,
      ...logContext 
    });

    await this.stateManager.updateTransactionState(update, 'deposit');
  }

  /**
   * Handle withdrawal update webhook
   */
  private async handleWithdrawalUpdate(payload: any): Promise<void> {
    const logContext = this.getLogContext();
    const update: TransactionUpdate = {
      transaction_id: payload.transaction_id,
      status: payload.status,
      status_eta: payload.status_eta,
      amount_in: payload.amount_in,
      amount_out: payload.amount_out,
      amount_fee: payload.amount_fee,
      stellar_transaction_id: payload.stellar_transaction_id,
      external_transaction_id: payload.external_transaction_id,
      message: payload.message
    };

    console.log('Handling withdrawal update', { 
      transaction_id: update.transaction_id,
      status: update.status,
      ...logContext 
    });

    const result = await this.pool.query(
      'SELECT status FROM transactions WHERE transaction_id = $1',
      [update.transaction_id]
    );

    if (result.rows.length === 0) {
      console.log('Transaction not found for withdrawal update', { 
        transaction_id: update.transaction_id,
        ...logContext 
      });
      throw new Error('Transaction not found');
    }

    const currentStatus = result.rows[0].status;

    if (!this.stateManager.validateTransition(currentStatus, update.status, 'withdrawal')) {
      console.log('Invalid state transition for withdrawal', { 
        transaction_id: update.transaction_id,
        fromStatus: currentStatus,
        toStatus: update.status,
        ...logContext 
      });
      throw new Error(`Invalid state transition: ${currentStatus} -> ${update.status}`);
    }

    console.log('Valid state transition for withdrawal', { 
      transaction_id: update.transaction_id,
      fromStatus: currentStatus,
      toStatus: update.status,
      ...logContext 
    });

    await this.stateManager.updateTransactionState(update, 'withdrawal');
  }

  /**
   * Handle KYC update webhook
   */
  private async handleKYCUpdate(payload: any, anchorId: string): Promise<void> {
    const logContext = this.getLogContext();
    const update: KYCUpdate = {
      transaction_id: payload.transaction_id,
      kyc_status: payload.kyc_status,
      kyc_fields: payload.kyc_fields,
      rejection_reason: payload.rejection_reason
    };

    console.log('Handling KYC update', { 
      transaction_id: update.transaction_id,
      kyc_status: update.kyc_status,
      ...logContext 
    });

    await this.stateManager.updateKYCStatus(update);

    const userId = payload.user_id;
    const payloadAnchorId = payload.anchor_id || anchorId;

    if (!userId) {
      console.log('Skipping KYC store upsert - missing user_id', { 
        transaction_id: payload.transaction_id,
        ...logContext 
      });
      // Cannot update KYC store without user_id; this might indicate an incomplete webhook payload.
      console.warn(`Skipping KYC store upsert for transaction ${payload.transaction_id}: missing user_id`);
      return;
    }

    if (!payloadAnchorId) {
      console.log('Skipping KYC store upsert - missing anchor_id', { 
        transaction_id: payload.transaction_id,
        ...logContext 
      });
      console.warn(`Skipping KYC store upsert for transaction ${payload.transaction_id}: missing anchor_id`);
      return;
    }

    console.log('Updating KYC store', { 
      userId,
      anchorId: payloadAnchorId,
      kyc_status: payload.kyc_status,
      ...logContext 
    });

    const verifiedAt = payload.verified_at ? new Date(payload.verified_at) : new Date();
    const expiresAt = payload.expires_at ? new Date(payload.expires_at) : undefined;

    const kycRecord = {
      user_id: userId,
      anchor_id: payloadAnchorId,
      kyc_status: payload.kyc_status,
      kyc_level: payload.kyc_level,
      rejection_reason: payload.rejection_reason,
      verified_at: verifiedAt,
      expires_at: expiresAt,
    };

    await this.kycUpsertService.upsert(kycRecord);
  }

  /**
   * Log suspicious activity
   */
  private async logSuspicious(
    anchorId: string,
    reason: string,
    payload: any,
    webhookId?: string
  ): Promise<void> {
    const logContext = this.getLogContext();
    console.log('Logging suspicious activity in webhook handler', { 
      anchorId, 
      reason, 
      webhookId,
      ...logContext 
    });

    await this.logger.logSuspiciousActivity({
      webhook_id: webhookId || 'unknown',
      anchor_id: anchorId,
      reason,
      payload,
      timestamp: new Date(),
      correlation_id: logContext.correlation_id
    });
  }

  /**
   * Setup webhook routes
   */
  setupRoutes(app: express.Application): void {
    app.post('/webhooks/anchor', 
      this.rawBodyMiddleware(),
      this.handleWebhook.bind(this)
    );
  }

  /**
   * Setup health check route
   */
  setupHealthCheck(app: express.Application): void {
    const { WebhookHealthCheck } = require('./webhook-health');
    const healthCheck = new WebhookHealthCheck(this.pool);
    app.get('/webhooks/health', healthCheck.checkHealth.bind(healthCheck));
  }
}
