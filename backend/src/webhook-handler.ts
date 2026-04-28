import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { WebhookVerifier } from './webhook-verifier';
import { WebhookLogger } from './webhook-logger';
import { TransactionStateManager, TransactionUpdate, KYCUpdate } from './transaction-state';
import { KycUpsertService } from './kyc-upsert-service';
import { Sep24Service } from './sep24-service';
import { WebhookDispatcher } from './webhook-dispatcher';
import type { RemittanceCreatedWebhookPayload } from './types';
import { validateAnchorToml } from './anchor-toml-validator';

interface WebhookRequest extends Request {
  rawBody?: string;
}

export class WebhookHandler {
  private verifier: WebhookVerifier;
  private logger: WebhookLogger;
  private stateManager: TransactionStateManager;
  private kycUpsertService: KycUpsertService;
  private sep24Service: Sep24Service;
  private dispatcher: WebhookDispatcher;

  constructor(private pool: Pool) {
    this.verifier = new WebhookVerifier(300); // 5 minute replay window
    this.logger = new WebhookLogger(pool);
    this.stateManager = new TransactionStateManager(pool);
    this.kycUpsertService = new KycUpsertService(pool);
    this.sep24Service = new Sep24Service(pool);
    this.dispatcher = new WebhookDispatcher();
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
    
    try {
      // Extract headers
      const signature = req.headers['x-signature'] as string;
      const timestamp = req.headers['x-timestamp'] as string;
      const nonce = req.headers['x-nonce'] as string;
      const anchorId = req.headers['x-anchor-id'] as string;

      if (!signature || !timestamp || !nonce || !anchorId) {
        res.status(400).json({ error: 'Missing required headers' });
        return;
      }

      // Get anchor public key
      const anchorResult = await this.pool.query(
        'SELECT public_key, webhook_secret FROM anchors WHERE id = $1',
        [anchorId]
      );

      if (anchorResult.rows.length === 0) {
        res.status(404).json({ error: 'Anchor not found' });
        return;
      }

      const { public_key, webhook_secret, home_domain } = anchorResult.rows[0];

      // Validate anchor domain against stellar.toml SIGNING_KEY
      if (home_domain) {
        const tomlValid = await validateAnchorToml(home_domain, public_key);
        if (!tomlValid) {
          await this.logSuspicious(anchorId, 'stellar.toml SIGNING_KEY mismatch', req.body);
          res.status(403).json({ error: 'Anchor domain validation failed' });
          return;
        }
      }

      // Verify timestamp
      if (!this.verifier.validateTimestamp(timestamp)) {
        await this.logSuspicious(anchorId, 'Invalid timestamp', req.body);
        res.status(401).json({ error: 'Invalid timestamp' });
        return;
      }

      // Verify nonce
      if (!this.verifier.validateNonce(nonce)) {
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
        await this.logSuspicious(anchorId, 'Invalid signature', req.body);
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      // Process webhook
      const { event_type, transaction_id, remittance_id } = req.body;
      const correlationId = transaction_id || remittance_id || 'unknown';

      // Log webhook
      const webhookId = await this.logger.logWebhook(
        anchorId,
        correlationId,
        event_type,
        req.body,
        true
      );

      // Check for suspicious patterns
      const suspiciousReasons = await this.logger.checkSuspiciousPatterns(
        anchorId,
        correlationId
      );

      if (suspiciousReasons.length > 0) {
        await this.logSuspicious(anchorId, suspiciousReasons.join(', '), req.body, webhookId);
      }

      // Route to appropriate handler
      switch (event_type) {
        case 'deposit_update':
          await this.handleDepositUpdate(req.body);
          break;
        case 'withdrawal_update':
          await this.handleWithdrawalUpdate(req.body);
          break;
        case 'kyc_update':
          await this.handleKYCUpdate(req.body, anchorId);
          break;
        case 'contract_created':
          await this.handleRemittanceCreated(req.body);
          break;
        case 'sep24_deposit_update':
        case 'sep24_withdrawal_update':
          await this.handleSep24Update(req.body);
          break;
        case 'daily_limit_updated':
          await this.handleDailyLimitUpdated(req.body);
          break;
        default:
          res.status(400).json({ error: 'Unknown event type' });
          return;
      }

      const processingTime = Date.now() - startTime;
      res.status(200).json({ 
        success: true, 
        processing_time_ms: processingTime 
      });

    } catch (error) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle contract-created event and fan out remittance.created webhook.
   */
  private async handleRemittanceCreated(payload: any): Promise<void> {
    const requiredFields = ['remittance_id', 'sender', 'agent', 'amount', 'fee', 'expiry'];
    for (const field of requiredFields) {
      if (payload[field] === undefined || payload[field] === null) {
        throw new Error(`Missing required remittance_created field: ${field}`);
      }
    }

    const remittancePayload: RemittanceCreatedWebhookPayload = {
      remittance_id: String(payload.remittance_id),
      sender: String(payload.sender),
      agent: String(payload.agent),
      amount: String(payload.amount),
      fee: String(payload.fee),
      expiry: String(payload.expiry),
    };

    await this.dispatcher.dispatchRemittanceCreated(remittancePayload);
  }

  /**
   * Handle deposit update webhook
   */
  private async handleDepositUpdate(payload: any): Promise<void> {
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

    // Get current status
    const result = await this.pool.query(
      'SELECT status FROM transactions WHERE transaction_id = $1',
      [update.transaction_id]
    );

    if (result.rows.length === 0) {
      throw new Error('Transaction not found');
    }

    const currentStatus = result.rows[0].status;

    // Validate transition
    if (!this.stateManager.validateTransition(currentStatus, update.status, 'deposit')) {
      throw new Error(`Invalid state transition: ${currentStatus} -> ${update.status}`);
    }

    await this.stateManager.updateTransactionState(update, 'deposit');
  }

  /**
   * Handle withdrawal update webhook
   */
  private async handleWithdrawalUpdate(payload: any): Promise<void> {
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

    const result = await this.pool.query(
      'SELECT status FROM transactions WHERE transaction_id = $1',
      [update.transaction_id]
    );

    if (result.rows.length === 0) {
      throw new Error('Transaction not found');
    }

    const currentStatus = result.rows[0].status;

    if (!this.stateManager.validateTransition(currentStatus, update.status, 'withdrawal')) {
      throw new Error(`Invalid state transition: ${currentStatus} -> ${update.status}`);
    }

    await this.stateManager.updateTransactionState(update, 'withdrawal');
  }

  /**
   * Handle daily_limit_updated contract event.
   * Logs the change for audit purposes.
   */
  private async handleDailyLimitUpdated(payload: any): Promise<void> {
    const { currency, country, old_limit, new_limit, admin, ledger_sequence, timestamp } = payload;
    console.info(
      `[daily_limit_updated] currency=${currency} country=${country} ` +
      `old=${old_limit ?? 'unset'} new=${new_limit} admin=${admin} ` +
      `ledger=${ledger_sequence} ts=${timestamp}`
    );
    await this.pool.query(
      `INSERT INTO daily_limit_audit_log
         (currency, country, old_limit, new_limit, admin_address, ledger_sequence, event_timestamp, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), NOW())
       ON CONFLICT DO NOTHING`,
      [currency, country, old_limit, new_limit, admin, ledger_sequence, timestamp]
    ).catch((err: Error) => {
      // Table may not exist yet; log and continue rather than failing the webhook
      console.warn('[daily_limit_updated] audit log insert failed (table may not exist):', err.message);
    });
  }

  /**
   * Handle SEP-24 deposit/withdrawal update webhook
   */
  private async handleSep24Update(payload: any): Promise<void> {
    await this.sep24Service.handleWebhookNotification({
      transaction_id: payload.transaction_id,
      status: payload.status,
      amount_in: payload.amount_in,
      amount_out: payload.amount_out,
      amount_fee: payload.amount_fee,
      stellar_transaction_id: payload.stellar_transaction_id,
      external_transaction_id: payload.external_transaction_id,
      message: payload.message,
    });
  }

  /**
   * Handle KYC update webhook
   */
  private async handleKYCUpdate(payload: any, anchorId: string): Promise<void> {
    const update: KYCUpdate = {
      transaction_id: payload.transaction_id,
      kyc_status: payload.kyc_status,
      kyc_fields: payload.kyc_fields,
      rejection_reason: payload.rejection_reason
    };

    await this.stateManager.updateKYCStatus(update);

    const userId = payload.user_id;
    const payloadAnchorId = payload.anchor_id || anchorId;

    if (!userId) {
      // Cannot update KYC store without user_id; this might indicate an incomplete webhook payload.
      console.warn(`Skipping KYC store upsert for transaction ${payload.transaction_id}: missing user_id`);
      return;
    }

    if (!payloadAnchorId) {
      console.warn(`Skipping KYC store upsert for transaction ${payload.transaction_id}: missing anchor_id`);
      return;
    }

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
    await this.logger.logSuspiciousActivity({
      webhook_id: webhookId || 'unknown',
      anchor_id: anchorId,
      reason,
      payload,
      timestamp: new Date()
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
