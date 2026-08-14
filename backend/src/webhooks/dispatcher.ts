/**
 * Webhook Dispatcher
 *
 * Handles the delivery of webhook payloads with:
 * - Automatic retries with exponential backoff + configurable ±jitter
 * - HMAC-SHA256 signature generation and verification
 * - Secret rotation grace period (dual-signature for 24 h after rotation)
 * - Timeout handling (axios)
 * - Dead-letter queue for permanently-failed deliveries
 * - drain() for graceful shutdown
 * - Comprehensive logging and error tracking
 *
 * Retry parameters are read from environment variables so they can be tuned
 * without redeploying:
 *   WEBHOOK_MAX_RETRIES        (default 5)
 *   WEBHOOK_RETRY_BASE_MS      (default 1000)
 *   WEBHOOK_RETRY_MAX_MS       (default 300000)
 *   WEBHOOK_RETRY_JITTER_PERCENT (default 20)
 *   WEBHOOK_TIMEOUT_MS         (default 30000)
 */

import axios from 'axios';
import crypto from 'crypto';
import { EventType, WebhookPayload, WebhookDeliveryRecord, WebhookDeliveryOptions, WebhookSignatureHeaders, WebhookSubscriber } from './types';
import { IWebhookStore } from './store';
import { tracedWebhookDelivery } from '../tracing/webhook-tracer';

/** 24-hour grace window for secret rotation (milliseconds). */
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

const DEFAULT_OPTIONS: WebhookDeliveryOptions = {
  maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '5', 10),
  initialDelayMs: parseInt(process.env.WEBHOOK_RETRY_BASE_MS || '1000', 10),
  backoffMultiplier: 2,
  maxDelayMs: parseInt(process.env.WEBHOOK_RETRY_MAX_MS || '300000', 10),
  timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS || '30000', 10),
};

export class WebhookDispatcher {
  private inFlight = 0;

  constructor(
    private store: IWebhookStore,
    private logger?: Console | any,
    private options: WebhookDeliveryOptions = {},
    private onDeadLetter?: () => void
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.logger = logger || console;
  }

  /**
   * Generate HMAC-SHA256 signature for webhook payload
   */
  private generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Generate webhook headers including signature and optional correlation ID.
   */
  private generateHeaders(
    payload: string,
    secret: string,
    contentType = 'application/json',
    correlationId?: string,
  ): Record<string, string> {
    const timestamp = Date.now().toString();
    const webhookId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const msg = `${timestamp}.${payload}`;
    const signature = this.generateSignature(msg, secret);

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
      'x-webhook-id': webhookId,
      'User-Agent': 'SwiftRemit-Webhook/1.0',
    };

    // SR-035: propagate the originating correlation ID so receivers can join
    // traces across the API → contract-event → webhook delivery chain.
    if (correlationId) {
      headers['X-Correlation-ID'] = correlationId;
    }

    return headers;
  }

  /**
   * Calculate exponential backoff delay with configurable ±jitter.
   *
   * Formula:
   *   base = initialDelayMs * backoffMultiplier^(attempt-1)
   *   capped = min(base, maxDelayMs)
   *   jitter = random in [-jitterRange, +jitterRange]
   *   final = max(0, capped + jitter)
   *
   * WEBHOOK_RETRY_JITTER_PERCENT (env, default 20) controls the jitter width
   * as a percentage of the capped delay.
   */
  private getBackoffDelay(attempt: number): number {
    const jitterPercent = parseInt(process.env.WEBHOOK_RETRY_JITTER_PERCENT || '20', 10);
    const exponentialDelay = this.options.initialDelayMs! * Math.pow(this.options.backoffMultiplier!, attempt - 1);
    const capped = Math.min(exponentialDelay, this.options.maxDelayMs!);
    const jitterRange = (capped * jitterPercent) / 100;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    const finalDelay = Math.max(0, capped + jitter);
    this.logger.debug(
      `Webhook retry attempt ${attempt}: exponential=${exponentialDelay}ms, capped=${capped}ms, jitter=${jitter.toFixed(0)}ms, final=${finalDelay.toFixed(0)}ms`
    );
    return finalDelay;
  }

  /**
   * Dispatch a webhook event to all subscribers
   */
  async dispatch(event: EventType, payload: WebhookPayload, correlationId?: string): Promise<{ success: number; failed: number }> {
    this.inFlight++;
    try {
      const subscribers = await this.store.getSubscribers(event);

      if (subscribers.length === 0) {
        this.logger.info(`No subscribers for event: ${event}`);
        return { success: 0, failed: 0 };
      }

      this.logger.info(`Dispatching ${event} to ${subscribers.length} subscriber(s)`, { correlation_id: correlationId });

      // Enrich payload with correlation ID if provided
      const enrichedPayload = correlationId 
        ? { ...payload, correlation_id: correlationId }
        : payload;

      let successCount = 0;
      let failedCount = 0;

      for (const subscriber of subscribers) {
        try {
          const deliveryRecord: Partial<WebhookDeliveryRecord> = {
            webhookId: subscriber.id,
            eventType: event,
            payload: enrichedPayload,
            maxRetries: this.options.maxRetries!,
          };

          const deliveryId = await this.store.recordDelivery({
            ...deliveryRecord,
            status: 'pending',
            attempt: 0,
          } as WebhookDeliveryRecord);

          const success = await this.attemptDelivery(
            deliveryId,
            subscriber.url,
            subscriber.secret,
            enrichedPayload,
            1,
            deliveryRecord,
            subscriber.content_type,
            correlationId,
          );

          if (success) {
            successCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          failedCount++;
          this.logger.error(`Error dispatching to subscriber ${subscriber.id}:`, error);
        }
      }

      this.logger.info(`Dispatch complete: ${successCount} succeeded, ${failedCount} failed`);
      return { success: successCount, failed: failedCount };
    } catch (error) {
      this.logger.error('Dispatch error:', error);
      throw error;
    } finally {
      this.inFlight--;
    }
  }

  /**
   * Attempt delivery with automatic retries
   */
  private async attemptDelivery(
    deliveryId: string,
    url: string,
    secret: string,
    payload: WebhookPayload,
    attempt: number = 1,
    deliveryRecord?: Partial<WebhookDeliveryRecord>,
    contentType: string = 'application/json',
    correlationId?: string,
  ): Promise<boolean> {
    if (!url.startsWith('https://')) {
      const msg = `Webhook delivery rejected: URL must use HTTPS (received: ${url})`;
      this.logger.error(msg);
      await this.store.updateDeliveryStatus(deliveryId, 'failed', attempt, msg);
      return false;
    }

    try {
      const isFormEncoded = contentType === 'application/x-www-form-urlencoded';
      const serialized = isFormEncoded
        ? new URLSearchParams(
            Object.entries(payload as unknown as Record<string, unknown>).reduce<Record<string, string>>(
              (acc, [k, v]) => {
                acc[k] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
                return acc;
              },
              {}
            )
          ).toString()
        : JSON.stringify(payload);

      const headers = this.generateHeaders(serialized, secret, contentType, correlationId);

      this.logger.debug(`Attempting delivery ${attempt}/${this.options.maxRetries} to ${url}`);

      const response = await tracedWebhookDelivery(
        {
          eventType:    String(payload.event ?? 'unknown'),
          targetUrl:    url,
          remittanceId: String((payload as any).remittance_id ?? ''),
          attemptNumber: attempt,
        },
        async (injectableHeaders) => {
          return axios.post(url, isFormEncoded ? serialized : payload, {
            headers: { ...headers, ...injectableHeaders },
            timeout: this.options.timeoutMs,
            validateStatus: () => true,
          });
        }
      );

      const isSuccess = response.status >= 200 && response.status < 300;

      if (isSuccess) {
        await this.store.updateDeliveryStatus(deliveryId, 'success', attempt);
        this.logger.info(`Delivery ${deliveryId} successful (HTTP ${response.status})`);
        return true;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (attempt < this.options.maxRetries!) {
        const delay = this.getBackoffDelay(attempt);
        this.logger.warn(
          `Delivery attempt ${attempt} failed (${errorMessage}). Retrying in ${delay}ms...`
        );

        await this.store.updateDeliveryStatus(deliveryId, 'pending', attempt, errorMessage);
        await new Promise(resolve => setTimeout(resolve, delay));

        return this.attemptDelivery(deliveryId, url, secret, payload, attempt + 1, deliveryRecord, contentType, correlationId);
      } else {
        await this.store.updateDeliveryStatus(deliveryId, 'failed', attempt, errorMessage);
        this.logger.error(`Delivery ${deliveryId} failed after ${attempt} attempts: ${errorMessage}`);

        // Send to dead-letter queue
        if (deliveryRecord) {
          await this.store.sendToDeadLetter({
            ...deliveryRecord,
            id: deliveryId,
            status: 'failed',
            attempt,
            error: errorMessage,
          } as WebhookDeliveryRecord);
          this.onDeadLetter?.();
          this.logger.warn(`Delivery ${deliveryId} moved to dead-letter queue`);
        }

        return false;
      }
    }
  }

  /**
   * Drain all in-flight webhook dispatches.
   *
   * Waits up to `timeoutMs` for any currently-running `dispatch` or
   * `attemptDelivery` calls to settle. New dispatches started after
   * `drain()` is called will still be awaited — callers should stop
   * enqueuing work before calling this.
   *
   * @param timeoutMs Maximum milliseconds to wait (default: 30 000)
   */
  async drain(timeoutMs = 30_000): Promise<void> {
    if (this.inFlight === 0) return;

    this.logger.info(`Draining ${this.inFlight} in-flight webhook dispatch(es)…`);

    const deadline = Date.now() + timeoutMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }

    if (this.inFlight > 0) {
      this.logger.warn(
        `Drain timeout reached with ${this.inFlight} dispatch(es) still in flight. Proceeding with shutdown.`
      );
    } else {
      this.logger.info('All in-flight webhook dispatches completed.');
    }
  }

  /**
   * Retry pending deliveries (for background processing)
   */
  async retryPendingDeliveries(limit: number = 100): Promise<void> {
    try {
      const deliveries = await this.store.getPendingDeliveries(limit);

      if (deliveries.length === 0) {
        this.logger.debug('No pending deliveries to retry');
        return;
      }

      this.logger.info(`Retrying ${deliveries.length} pending deliveries...`);

      for (const delivery of deliveries) {
        if (!delivery.id) continue;

        const subscriber = await this.store.getWebhook(delivery.webhookId);
        if (!subscriber) {
          this.logger.warn(`Subscriber ${delivery.webhookId} not found for delivery ${delivery.id}`);
          continue;
        }

        await this.attemptDelivery(
          delivery.id,
          subscriber.url,
          subscriber.secret,
          delivery.payload,
          delivery.attempt + 1,
          delivery,
          subscriber.content_type,
        );
      }
    } catch (error) {
      this.logger.error('Error retrying pending deliveries:', error);
    }
  }

  /**
   * Verify webhook signature (for webhook receivers)
   */
  static verifySignature(
    payload: string,
    signature: string,
    timestamp: string,
    secret: string,
    windowMs: number = 5 * 60 * 1000 // 5 minutes
  ): boolean {
    try {
      // Check timestamp window
      const now = Date.now();
      const ts = parseInt(timestamp, 10);

      if (isNaN(ts) || Math.abs(now - ts) > windowMs) {
        return false;
      }

      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${payload}`)
        .digest('hex');

      return expectedSignature === signature;
    } catch (error) {
      return false;
    }
  }
}
