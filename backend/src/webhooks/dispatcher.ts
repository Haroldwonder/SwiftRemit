/**
 * Webhook Dispatcher
 * 
 * Handles the delivery of webhook payloads with:
 * - Automatic retries with exponential backoff
 * - HMAC-SHA256 signature generation and verification
 * - Timeout handling
 * - Comprehensive logging and error tracking
 */

import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { EventType, WebhookPayload, WebhookDeliveryRecord, WebhookDeliveryOptions, WebhookSignatureHeaders } from './types';
import { IWebhookStore } from './store';

const DEFAULT_OPTIONS: WebhookDeliveryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 60000,
  timeoutMs: 30000,
};

export class WebhookDispatcher {
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
   * Generate webhook headers including signature
   */
  private generateHeaders(payload: string, secret: string): Record<string, string> {
    const timestamp = Date.now().toString();
    const webhookId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const signature = this.generateSignature(
      `${timestamp}.${payload}`,
      secret
    );

    return {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
      'x-webhook-id': webhookId,
      'User-Agent': 'SwiftRemit-Webhook/1.0',
    };
  }

  /**
   * Calculate exponential backoff delay
   */
  private getBackoffDelay(attempt: number): number {
    const delay = this.options.initialDelayMs! * Math.pow(this.options.backoffMultiplier!, attempt - 1);
    return Math.min(delay, this.options.maxDelayMs!);
  }

  /**
   * Dispatch a webhook event to all subscribers
   */
  async dispatch(event: EventType, payload: WebhookPayload): Promise<{ success: number; failed: number }> {
    try {
      const subscribers = await this.store.getSubscribers(event);

      if (subscribers.length === 0) {
        this.logger.info(`No subscribers for event: ${event}`);
        return { success: 0, failed: 0 };
      }

      this.logger.info(`Dispatching ${event} to ${subscribers.length} subscriber(s)`);

      let successCount = 0;
      let failedCount = 0;

      for (const subscriber of subscribers) {
        try {
          const deliveryRecord: Partial<WebhookDeliveryRecord> = {
            webhookId: subscriber.id,
            eventType: event,
            payload,
            maxRetries: this.options.maxRetries!,
          };

          const deliveryId = await this.store.recordDelivery({
            ...deliveryRecord,
            status: 'pending',
            attempt: 0,
          } as WebhookDeliveryRecord);

          const success = await this.attemptDelivery(deliveryId, subscriber.url, subscriber.secret, payload, 1, deliveryRecord);

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
    deliveryRecord?: Partial<WebhookDeliveryRecord>
  ): Promise<boolean> {
    try {
      const payloadJson = JSON.stringify(payload);
      const headers = this.generateHeaders(payloadJson, secret);

      this.logger.debug(`Attempting delivery ${attempt}/${this.options.maxRetries} to ${url}`);

      const response = await axios.post(url, payload, {
        headers,
        timeout: this.options.timeoutMs,
        validateStatus: () => true, // Don't throw on any status
      });

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

        return this.attemptDelivery(deliveryId, url, secret, payload, attempt + 1, deliveryRecord);
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
          delivery
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
