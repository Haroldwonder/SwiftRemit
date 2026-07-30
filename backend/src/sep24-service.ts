import axios, { AxiosInstance, AxiosResponse } from 'axios';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { Pool } from 'pg';
import {
  getAnchorKycConfigs,
  saveSep24Transaction,
  getSep24Transaction,
  getPendingSep24Transactions,
  updateSep24TransactionStatus,
  getSep24TransactionById,
} from './database';
import { AnchorKycConfig } from './types';
import { cancelRemittanceOnChain } from './stellar';
import { WebhookDispatcher } from './webhooks/dispatcher';
import { PostgresWebhookStore } from './webhooks/store';
import { validateAnchorToml } from './anchor-toml-validator';
import { renderNotification, NotificationEventType } from './notification-templates';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


/**
 * SEP-24 transaction types
 */
export type Sep24Direction = 'deposit' | 'withdrawal';

export type Sep24TransactionStatus =
  | 'pending_user_transfer_start'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_external'
  | 'pending_trust'
  | 'pending_user'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'error';

/**
 * SEP-24 interactive flow response
 */
export interface Sep24InteractiveResponse {
  transaction_id: string;
  url: string;
  message?: string;
}

/**
 * SEP-24 transaction data for database storage
 */
export interface Sep24TransactionRecord {
  id?: number;
  transaction_id: string;
  anchor_id: string;
  direction: Sep24Direction;
  status: Sep24TransactionStatus;
  asset_code: string;
  amount?: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  user_id: string;
  interactive_url?: string;
  instructions_url?: string;
  kyc_status?: 'pending' | 'approved' | 'rejected' | 'not_required';
  kyc_web_url?: string;
  status_eta?: number;
  last_polled?: Date;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * SEP-24 initiate request
 */
export interface Sep24InitiateRequest {
  user_id: string;
  anchor_id: string;
  direction: Sep24Direction;
  asset_code: string;
  amount: string;
  user_address?: string;
  user_email?: string;
}

/**
 * Configuration for SEP-24 interactive flow
 */
export interface AnchorSep24Config {
  anchor_id: string;
  sep_server_url: string;
  sep24_enabled: boolean;
  webauth_domain: string;
  webhook_url?: string;
  polling_interval_minutes: number;
  timeout_minutes: number;
  home_domain?: string;
  signing_key?: string;
}

/**
 * Response from anchor's /deposit or /withdraw endpoint
 */
interface Sep24InteractiveFlowResponse {
  transaction_id: string;
  url: string;
  interactive_url?: string;
  instructions_url?: string;
  kyc_web_url?: string;
  type?: string;
  fields?: Record<string, any>;
}

/**
 * Transaction status response from anchor
 */
interface Sep24TransactionStatusResponse {
  transaction: {
    id: string;
    status: string;
    status_eta?: number;
    amount_in?: string;
    amount_out?: string;
    amount_fee?: string;
    stellar_transaction_id?: string;
    external_transaction_id?: string;
    message?: string;
    kyc?: string;
  };
}

/**
 * Configuration error
 */
export class Sep24ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Sep24ConfigError';
  }
}

/**
 * Anchor timeout error
 */
export class Sep24TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Sep24TimeoutError';
  }
}

/**
 * Anchor communication error
 */
export class Sep24AnchorError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'Sep24AnchorError';
  }
}

/**
 * SEP-24 Service for handling deposit/withdrawal flows
 */
export class Sep24Service {
  private pool: Pool;
  private anchorConfigs: Map<string, AnchorSep24Config> = new Map();
  private httpClient: AxiosInstance;
  private dispatcher: WebhookDispatcher;
  anchorTimeoutHours: number;
  timeoutWebhookUrl: string | undefined;
  private stalledTransactionsTotal = 0;

  constructor(pool: Pool) {
    this.pool = pool;
    this.anchorTimeoutHours = parseFloat(process.env.ANCHOR_TIMEOUT_HOURS ?? '24');
    this.timeoutWebhookUrl = process.env.ANCHOR_TIMEOUT_WEBHOOK_URL;
    const httpTimeoutMs = parseInt(process.env.SEP24_HTTP_TIMEOUT_MS ?? '30000', 10);
    this.httpClient = axios.create({
      timeout: httpTimeoutMs,
    });
    this.dispatcher = new WebhookDispatcher(new PostgresWebhookStore(pool));
  }

  /** Return the current stalled_transactions_total counter value (for Prometheus scraping). */
  getStalledTransactionsTotal(): number {
    return this.stalledTransactionsTotal;
  }

  /**
   * Initialize the SEP-24 service with anchor configurations
   */
  async initialize(): Promise<void> {
    const kycConfigs = await getAnchorKycConfigs();

    // Fetch anchor home_domain and public_key from DB for TOML validation
    const anchorRows = await this.pool.query<{ id: string; home_domain: string | null; public_key: string | null }>(
      'SELECT id, home_domain, public_key FROM anchors'
    );
    const anchorMeta = new Map(anchorRows.rows.map(r => [r.id, r]));
    
    // Load SEP-24 configurations from environment
    for (const config of kycConfigs) {
      const sep24Enabled = process.env[`SEP24_ENABLED_${config.anchor_id.toUpperCase()}`] === 'true';
      const sepServerUrl = process.env[`SEP24_SERVER_${config.anchor_id.toUpperCase()}`] || config.kyc_server_url;
      
      if (sep24Enabled && sepServerUrl) {
        const meta = anchorMeta.get(config.anchor_id);
        const anchorConfig: AnchorSep24Config = {
          anchor_id: config.anchor_id,
          sep_server_url: sepServerUrl,
          sep24_enabled: true,
          webauth_domain: new URL(sepServerUrl).host,
          webhook_url: process.env[`SEP24_WEBHOOK_${config.anchor_id.toUpperCase()}`],
          polling_interval_minutes: parseInt(process.env[`SEP24_POLL_INTERVAL_${config.anchor_id.toUpperCase()}`] || '5'),
          timeout_minutes: parseInt(process.env[`SEP24_TIMEOUT_${config.anchor_id.toUpperCase()}`] || '30'),
          home_domain: meta?.home_domain ?? undefined,
          signing_key: meta?.public_key ?? undefined,
        };
        
        this.anchorConfigs.set(config.anchor_id, anchorConfig);
      }
    }
    
    console.log(`Initialized SEP-24 service with ${this.anchorConfigs.size} enabled anchors`);
  }

  /**
   * Initiate a SEP-24 deposit or withdrawal flow
   */
  async initiateFlow(request: Sep24InitiateRequest): Promise<Sep24InteractiveResponse> {
    const { user_id, anchor_id, direction, asset_code, amount, user_address, user_email } = request;

    // Get anchor configuration
    const anchorConfig = this.anchorConfigs.get(anchor_id);
    if (!anchorConfig) {
      throw new Sep24ConfigError(`Anchor ${anchor_id} is not configured for SEP-24`);
    }

    if (!anchorConfig.sep24_enabled) {
      throw new Sep24ConfigError(`SEP-24 is not enabled for anchor ${anchor_id}`);
    }

    // Validate anchor TOML before initiating any flow (security check)
    if (anchorConfig.home_domain && anchorConfig.signing_key) {
      const tomlValid = await validateAnchorToml(anchorConfig.home_domain, anchorConfig.signing_key);
      if (!tomlValid) {
        throw new Sep24ConfigError(
          `Anchor ${anchor_id} failed stellar.toml SIGNING_KEY validation — flow aborted`
        );
      }
    } else {
      console.warn(`Anchor ${anchor_id} has no home_domain/signing_key; skipping TOML validation`);
    }

    // Generate transaction ID
    const transactionId = `${anchor_id}-${direction}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Call anchor's SEP-24 deposit or withdraw endpoint
      const endpoint = direction === 'deposit' ? 'deposit' : 'withdraw';
      const url = `${anchorConfig.sep_server_url}/${endpoint}`;
      
      const requestBody: Record<string, any> = {
        asset_code: asset_code,
        amount: amount,
        transaction_id: transactionId,
        lang: 'en',
      };

      // Add user identification
      if (user_address) {
        requestBody.account = user_address;
      }
      
      if (user_email) {
        requestBody.email = user_email;
      }

      // Add callback for webhook (if configured)
      if (anchorConfig.webhook_url) {
        requestBody.callback_url = `${anchorConfig.webhook_url}?transaction_id=${transactionId}`;
      }

      console.log(`Initiating SEP-24 ${direction} for anchor ${anchor_id}, transaction ${transactionId}`);

      const response: AxiosResponse<Sep24InteractiveFlowResponse> = await this.httpClient.post(
        url,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          // Allow 302 redirect to capture interactive URL
          maxRedirects: 5,
        }
      );

      const data = response.data;

      // Store transaction in database
      const transactionRecord: Sep24TransactionRecord = {
        transaction_id: data.transaction_id || transactionId,
        anchor_id: anchor_id,
        direction: direction,
        status: 'pending_anchor',
        asset_code: asset_code,
        amount: amount,
        user_id: user_id,
        interactive_url: data.interactive_url || data.url,
        instructions_url: data.instructions_url,
        kyc_status: data.kyc_web_url ? 'pending' : 'not_required',
        kyc_web_url: data.kyc_web_url,
      };

      await saveSep24Transaction(transactionRecord);

      return {
        transaction_id: data.transaction_id || transactionId,
        url: data.interactive_url || data.url,
        message: data.instructions_url || 'Follow the link to complete the transaction',
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const errorMessage = error.response?.data?.error || error.message;
        
        // Store failed transaction for tracking
        await saveSep24Transaction({
          transaction_id: transactionId,
          anchor_id: anchor_id,
          direction: direction,
          status: 'error',
          asset_code: asset_code,
          amount: amount,
          user_id: user_id,
        });

        throw new Sep24AnchorError(
          `Failed to initiate ${direction}: ${errorMessage}`,
          statusCode
        );
      }
      
      throw error;
    }
  }

  /**
   * Poll all pending SEP-24 transactions for status updates
   */
  async pollAllTransactions(): Promise<void> {
    for (const [anchorId, config] of this.anchorConfigs) {
      try {
        await this.pollAnchorTransactions(anchorId, config);
      } catch (error) {
        console.error(`Failed to poll transactions for anchor ${anchorId}:`, error);
      }
    }
  }

  /**
   * Poll transactions for a specific anchor
   */
  private async pollAnchorTransactions(
    anchorId: string,
    config: AnchorSep24Config
  ): Promise<void> {
    // Get pending transactions for this anchor
    const pendingTransactions = await getPendingSep24Transactions(
      anchorId,
      config.polling_interval_minutes
    );

    console.log(`Polling ${pendingTransactions.length} transactions for anchor ${anchorId}`);

    for (const transaction of pendingTransactions) {
      try {
        const createdAt = transaction.created_at || new Date();
        const timeSinceCreationMinutes = (Date.now() - createdAt.getTime()) / (1000 * 60);
        const timeSinceCreationHours = timeSinceCreationMinutes / 60;

        // Stall detection: pending_anchor transactions older than anchorTimeoutHours → error
        if (
          transaction.status === 'pending_anchor' &&
          timeSinceCreationHours >= this.anchorTimeoutHours
        ) {
          await updateSep24TransactionStatus(transaction.transaction_id, 'error');
          this.stalledTransactionsTotal++;
          continue;
        }

        // Check for anchor timeout (expired refund flow)
        if (timeSinceCreationMinutes > config.timeout_minutes) {
          // Trigger refund flow (idempotent)
          await this.processExpiredRefund(transaction);
          continue;
        }

        // Query anchor for status
        const statusResponse = await this.queryTransactionStatus(
          config.sep_server_url,
          transaction.transaction_id
        );

        if (statusResponse) {
          const { transaction: txn } = statusResponse;
          
          // Map anchor status to our status
          const newStatus = this.mapAnchorStatusToInternal(txn.status);
          
          // Update if status changed
          if (newStatus !== transaction.status) {
            await updateSep24TransactionStatus(
              transaction.transaction_id,
              newStatus,
              txn.amount_in,
              txn.amount_out,
              txn.amount_fee,
              txn.stellar_transaction_id,
              txn.external_transaction_id,
              txn.message
            );
            
            console.log(`Transaction ${transaction.transaction_id} updated to ${newStatus}`);
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Failed to poll transaction ${transaction.transaction_id}:`, error);
      }
    }
  }

  /**
   * Process an expired SEP-24 transaction:
   *  1. Idempotency check — skip if already refunded or refund-in-flight.
   *  2. Detect partial deposits — refund actual received amount, not quoted.
   *  3. Call cancel_remittance on the Soroban contract with retry + escalation.
   *  4. Mark the transaction as 'refunded' in the DB.
   *  5. Emit a sep24.expired_refund webhook event.
   *  6. Send localised user notifications at each lifecycle stage.
   */
  private async processExpiredRefund(transaction: any): Promise<void> {
    const { transaction_id, status } = transaction;

    // ── 1. Idempotency ──────────────────────────────────────────────────────
    // Status 'refunded' is the terminal idempotency sentinel.
    if (status === 'refunded') {
      console.log(`Transaction ${transaction_id} already refunded, skipping`);
      return;
    }

    // Additional in-flight guard: a row in sep24_refund_attempts with
    // idempotency_key = REFUND_IDEMPOTENCY_PREFIX + transaction_id.
    const idempotencyKey = `${REFUND_IDEMPOTENCY_PREFIX}${transaction_id}`;
    const alreadyAttempted = await this.getRefundAttemptCount(transaction_id);
    if (alreadyAttempted >= MAX_REFUND_RETRIES) {
      // Already escalated — do not retry
      console.log(`Transaction ${transaction_id} already escalated after ${alreadyAttempted} attempts`);
      return;
    }

    // ── 2. Notify user: expiry ──────────────────────────────────────────────
    await this.sendUserNotification(transaction, 'sep24.expired', {
      direction:      transaction.direction ?? 'deposit',
      amount:         transaction.amount ?? transaction.amount_in ?? '0',
      asset_code:     transaction.asset_code,
      transaction_id: transaction_id,
      anchor_id:      transaction.anchor_id,
    });

    // ── 3. Determine refund amount (partial-deposit handling) ───────────────
    // If amount_in (actual received) differs from amount (quoted), refund
    // the actual received amount so the customer gets back exactly what they sent.
    const quotedAmount  = transaction.amount   ?? '0';
    const actualAmount  = transaction.amount_in ?? quotedAmount;
    const isPartial     = actualAmount !== quotedAmount && actualAmount !== '0';

    if (isPartial) {
      console.log(
        `Transaction ${transaction_id}: partial deposit detected — ` +
        `quoted=${quotedAmount}, actual=${actualAmount}`
      );
      await this.sendUserNotification(transaction, 'sep24.partial_deposit', {
        transaction_id: transaction_id,
        quoted_amount:  quotedAmount,
        actual_amount:  actualAmount,
        asset_code:     transaction.asset_code,
      });
    }

    // ── 4. Notify user: refund requested ───────────────────────────────────
    await this.sendUserNotification(transaction, 'sep24.refund_requested', {
      transaction_id: transaction_id,
      amount:         actualAmount,
      asset_code:     transaction.asset_code,
      anchor_id:      transaction.anchor_id,
    });

    // ── 5. On-chain cancel with retry + escalation ──────────────────────────
    const remittanceId = transaction.external_transaction_id
      ? parseInt(transaction.external_transaction_id, 10)
      : null;

    let onChainSuccess = false;
    if (remittanceId !== null && !isNaN(remittanceId)) {
      let attempt = 0;
      while (attempt < MAX_REFUND_RETRIES) {
        attempt++;
        try {
          await cancelRemittanceOnChain(remittanceId);
          onChainSuccess = true;
          break;
        } catch (err) {
          await this.recordRefundAttempt(transaction_id, attempt, err);
          console.error(
            `cancel_remittance attempt ${attempt}/${MAX_REFUND_RETRIES} failed for ` +
            `transaction ${transaction_id} (remittance ${remittanceId}):`,
            err
          );

          if (attempt < MAX_REFUND_RETRIES) {
            const delay = this.calcBackoff(attempt);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      if (!onChainSuccess) {
        // Escalate to manual-review queue
        const reviewId = await this.enqueueManualReview(transaction, actualAmount, idempotencyKey);
        console.error(
          `Transaction ${transaction_id} escalated to manual review after ` +
          `${MAX_REFUND_RETRIES} failed cancel attempts. Review ID: ${reviewId}`
        );

        await this.sendUserNotification(transaction, 'sep24.refund_failed', {
          transaction_id:   transaction_id,
          amount:           actualAmount,
          asset_code:       transaction.asset_code,
          retry_count:      String(MAX_REFUND_RETRIES),
          manual_review_id: reviewId,
        });
        // Do NOT mark as refunded — leave for manual resolution.
        return;
      }
    } else {
      console.warn(
        `Transaction ${transaction_id} has no valid external_transaction_id; skipping on-chain cancel`
      );
    }

    // ── 6. Mark as refunded (idempotent terminal status) ───────────────────
    await updateSep24TransactionStatus(transaction_id, 'refunded', actualAmount);
    console.log(`Transaction ${transaction_id} marked as refunded (amount: ${actualAmount})`);

    // ── 7. Notify user: refund complete ────────────────────────────────────
    await this.sendUserNotification(transaction, 'sep24.refunded', {
      transaction_id: transaction_id,
      amount:         actualAmount,
      asset_code:     transaction.asset_code,
      refunded_at:    new Date().toISOString(),
    });

    // ── 8. Emit webhook event ───────────────────────────────────────────────
    try {
      await this.dispatcher.dispatchSep24ExpiredRefund({
        transaction_id,
        anchor_id:   transaction.anchor_id,
        user_id:     transaction.user_id,
        asset_code:  transaction.asset_code,
        amount:      actualAmount,
        refunded_at: new Date().toISOString(),
      });
      await this.dispatcher.dispatch('sep24.expired_refund', {
        event: 'sep24.expired_refund',
        timestamp: new Date().toISOString(),
        data: {
          transaction_id,
          anchor_id: transaction.anchor_id,
          user_id: transaction.user_id,
          asset_code: transaction.asset_code,
          amount: transaction.amount ?? transaction.amount_in,
          refunded_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error(`Failed to dispatch sep24.expired_refund webhook for ${transaction_id}:`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Refund-attempt helpers
  // ---------------------------------------------------------------------------

  /**
   * Record a failed refund attempt in sep24_refund_attempts.
   * Table is created lazily (CREATE TABLE IF NOT EXISTS) to avoid hard migration dependency.
   */
  private async recordRefundAttempt(
    transactionId: string,
    attemptNumber: number,
    error: unknown
  ): Promise<void> {
    try {
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS sep24_refund_attempts (
           id              SERIAL PRIMARY KEY,
           transaction_id  VARCHAR(255) NOT NULL,
           attempt_number  INTEGER NOT NULL,
           error_message   TEXT,
           attempted_at    TIMESTAMP NOT NULL DEFAULT NOW()
         )`
      );
      await this.pool.query(
        `INSERT INTO sep24_refund_attempts (transaction_id, attempt_number, error_message)
         VALUES ($1, $2, $3)`,
        [
          transactionId,
          attemptNumber,
          error instanceof Error ? error.message : String(error),
        ]
      );
    } catch (dbErr) {
      console.error('Failed to record refund attempt:', dbErr);
    }
  }

  /** Return the number of recorded refund attempts for a transaction. */
  private async getRefundAttemptCount(transactionId: string): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) FROM sep24_refund_attempts WHERE transaction_id = $1`,
        [transactionId]
      );
      return parseInt(result.rows[0].count, 10);
    } catch {
      return 0; // table may not exist yet
    }
  }

  // ---------------------------------------------------------------------------
  // Manual-review queue
  // ---------------------------------------------------------------------------

  /**
   * Insert a row into the sep24_manual_reviews table so admins can see it.
   * Returns an opaque review ID shown to the user.
   */
  private async enqueueManualReview(
    transaction: any,
    refundAmount: string,
    idempotencyKey: string
  ): Promise<string> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS sep24_manual_reviews (
         id              SERIAL PRIMARY KEY,
         review_id       VARCHAR(64) NOT NULL UNIQUE,
         transaction_id  VARCHAR(255) NOT NULL,
         anchor_id       VARCHAR(100),
         user_id         VARCHAR(255),
         asset_code      VARCHAR(12),
         refund_amount   VARCHAR(40),
         idempotency_key VARCHAR(255),
         status          VARCHAR(20) NOT NULL DEFAULT 'pending',
         reason          TEXT,
         created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
         resolved_at     TIMESTAMP
       )`
    );

    const reviewId = `MR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    await this.pool.query(
      `INSERT INTO sep24_manual_reviews
         (review_id, transaction_id, anchor_id, user_id, asset_code, refund_amount,
          idempotency_key, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (review_id) DO NOTHING`,
      [
        reviewId,
        transaction.transaction_id,
        transaction.anchor_id ?? null,
        transaction.user_id ?? null,
        transaction.asset_code ?? null,
        refundAmount,
        idempotencyKey,
        `Anchor refund failed after ${MAX_REFUND_RETRIES} attempts`,
      ]
    );

    return reviewId;
  }

  // ---------------------------------------------------------------------------
  // Notification dispatch
  // ---------------------------------------------------------------------------

  /**
   * Send a localised notification to the user for a lifecycle event.
   * The locale is looked up from the user profile (best-effort; falls back to 'en').
   * In production this would delegate to an email/SMS/push service; here we
   * log the rendered payload and emit it through the webhook dispatcher so
   * integrators can consume it.
   */
  private async sendUserNotification(
    transaction: any,
    event: NotificationEventType,
    variables: Record<string, string>
  ): Promise<void> {
    try {
      const locale = await this.getUserLocale(transaction.user_id);
      const rendered = renderNotification({ event, locale, variables });

      console.log(
        `[Notification] user=${transaction.user_id} event=${event} locale=${locale}\n` +
        `  Subject: ${rendered.subject}`
      );

      // Persist for audit / delivery pipeline
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS user_notifications (
           id             SERIAL PRIMARY KEY,
           user_id        VARCHAR(255) NOT NULL,
           transaction_id VARCHAR(255),
           event          VARCHAR(100) NOT NULL,
           locale         VARCHAR(10),
           subject        TEXT,
           body           TEXT,
           sent_at        TIMESTAMP NOT NULL DEFAULT NOW()
         )`
      );
      await this.pool.query(
        `INSERT INTO user_notifications (user_id, transaction_id, event, locale, subject, body)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          transaction.user_id ?? 'unknown',
          transaction.transaction_id,
          event,
          locale,
          rendered.subject,
          rendered.body,
        ]
      );
    } catch (err) {
      // Notifications are best-effort — never let them block the refund flow
      console.error(`Failed to send ${event} notification for ${transaction.transaction_id}:`, err);
    }
  }

  /** Look up a user's preferred locale from the DB. Falls back to 'en'. */
  private async getUserLocale(userId: string): Promise<string> {
    try {
      const result = await this.pool.query(
        `SELECT preferred_locale FROM user_profiles WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      return result.rows[0]?.preferred_locale ?? 'en';
    } catch {
      return 'en';
    }
  }

  /**
   * Exponential backoff with ±10% jitter, capped at 16 s.
   */
  private calcBackoff(attempt: number): number {
    const BASE_MS = 1000;
    const MAX_MS = 16000;
    const exponential = BASE_MS * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, MAX_MS);
    const jitter = capped * 0.1 * (Math.random() * 2 - 1);
    return Math.round(capped + jitter);
  }

  /**
   * Query transaction status from anchor with exponential backoff retry for
   * transient errors (network failures and 5xx responses). 404 is treated as
   * "not found" and returned immediately without retrying. 4xx client errors
   * (other than 429) are also not retried.
   */
  private async queryTransactionStatus(
    sepServerUrl: string,
    transactionId: string,
    maxRetries = 3
  ): Promise<Sep24TransactionStatusResponse | null> {
    const url = `${sepServerUrl}/transaction?id=${transactionId}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response: AxiosResponse<Sep24TransactionStatusResponse> = await this.httpClient.get(url, {
          headers: { 'Accept': 'application/json' },
        });
        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;

          if (status === 404) {
            return null;
          }

          // Non-transient 4xx errors (except 429 Too Many Requests) — do not retry
          if (status && status >= 400 && status < 500 && status !== 429) {
            console.error(`HTTP ${status} querying transaction ${transactionId}; not retrying`);
            return null;
          }
        }

        if (attempt < maxRetries) {
          const delay = this.calcBackoff(attempt);
          console.warn(
            `Transient error polling transaction ${transactionId} (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`Failed to query transaction ${transactionId} after ${maxRetries} attempts:`, error);
        }
      }
    }

    return null;
  }

  /**
   * Map anchor status to our internal status
   */
  private mapAnchorStatusToInternal(anchorStatus: string): Sep24TransactionStatus {
    // SEP-24 status mapping
    const statusMap: Record<string, Sep24TransactionStatus> = {
      'pending_user_transfer_start': 'pending_user_transfer_start',
      'pending_anchor': 'pending_anchor',
      'pending_stellar': 'pending_stellar',
      'pending_external': 'pending_external',
      'pending_trust': 'pending_trust',
      'pending_user': 'pending_user',
      'completed': 'completed',
      'refunded': 'refunded',
      'expired': 'expired',
      'error': 'error',
    };

    return statusMap[anchorStatus] || 'error';
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(transactionId: string): Promise<Sep24TransactionRecord | null> {
    const record = await getSep24TransactionById(transactionId);
    if (!record) return null;
    
    // Transform database record to proper types
    return {
      transaction_id: record.transaction_id,
      anchor_id: record.anchor_id,
      direction: record.direction as Sep24Direction,
      status: record.status as Sep24TransactionStatus,
      asset_code: record.asset_code,
      amount: record.amount,
      amount_in: record.amount_in,
      amount_out: record.amount_out,
      amount_fee: record.amount_fee,
      stellar_transaction_id: record.stellar_transaction_id,
      external_transaction_id: record.external_transaction_id,
      user_id: record.user_id,
      interactive_url: record.interactive_url,
      instructions_url: record.instructions_url,
      kyc_status: record.kyc_status as 'pending' | 'approved' | 'rejected' | 'not_required' | undefined,
      kyc_web_url: record.kyc_web_url,
      status_eta: record.status_eta,
      last_polled: record.last_polled,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }

  /**
   * Handle webhook notification for transaction completion
   */
  async handleWebhookNotification(payload: {
    transaction_id: string;
    status: string;
    amount_in?: string;
    amount_out?: string;
    amount_fee?: string;
    stellar_transaction_id?: string;
    external_transaction_id?: string;
    message?: string;
  }): Promise<void> {
    const { transaction_id, status } = payload;
    const newStatus = this.mapAnchorStatusToInternal(status);

    await updateSep24TransactionStatus(
      transaction_id,
      newStatus,
      payload.amount_in,
      payload.amount_out,
      payload.amount_fee,
      payload.stellar_transaction_id,
      payload.external_transaction_id,
      payload.message
    );

    console.log(`Transaction ${transaction_id} updated via webhook to ${newStatus}`);
  }
}

/**
 * Create a new SEP-24 service instance
 */
export function createSep24Service(pool: Pool): Sep24Service {
  return new Sep24Service(pool);
}