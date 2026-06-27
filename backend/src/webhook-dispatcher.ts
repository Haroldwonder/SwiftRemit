import crypto from 'crypto';
import {
  enqueueWebhookDelivery,
  getActiveWebhookSubscribers,
  getWebhookSubscriberById,
  getPendingWebhookDeliveries,
  markWebhookDeliveryFailure,
  markWebhookDeliverySuccess,
} from './database';
import { RemittanceCreatedWebhookPayload, Sep24ExpiredRefundWebhookPayload, WebhookDelivery, WebhookSubscriber } from './types';

const MAX_RETRIES = 5;
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export class WebhookDispatcher {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async dispatchRemittanceCreated(payload: RemittanceCreatedWebhookPayload): Promise<void> {
    const subscribers = await getActiveWebhookSubscribers();
    const deliveries = await Promise.all(
      subscribers.map((subscriber) =>
        enqueueWebhookDelivery('remittance.created', payload.remittance_id, subscriber, payload, MAX_RETRIES)
      )
    );

    for (let i = 0; i < deliveries.length; i++) {
      await this.attemptDelivery(deliveries[i], subscribers[i]);
    }
  }

  async dispatchSep24ExpiredRefund(payload: Sep24ExpiredRefundWebhookPayload): Promise<void> {
    const subscribers = await getActiveWebhookSubscribers();
    const deliveries = await Promise.all(
      subscribers.map((subscriber) =>
        enqueueWebhookDelivery('sep24.expired_refund', payload.transaction_id, subscriber, payload, MAX_RETRIES)
      )
    );

    for (let i = 0; i < deliveries.length; i++) {
      await this.attemptDelivery(deliveries[i], subscribers[i]);
    }
  }

  async retryPendingDeliveries(limit: number = 100): Promise<void> {
    const deliveries = await getPendingWebhookDeliveries(limit);
    for (const delivery of deliveries) {
      const subscriber = await getWebhookSubscriberById(delivery.subscriber_id);
      await this.attemptDelivery(delivery, subscriber ?? undefined);
    }
  }

  private validateUrl(url: string): void {
    if (!url.startsWith('https://')) {
      throw new Error(`Webhook delivery rejected: URL must use HTTPS (received: ${url})`);
    }
  }

  private buildSignatureHeaders(body: string, subscriber: WebhookSubscriber | undefined): Record<string, string> {
    if (!subscriber?.secret) return {};

    const timestamp = Date.now().toString();
    const msg = `${timestamp}.${body}`;
    const headers: Record<string, string> = {
      'x-webhook-timestamp': timestamp,
      'x-webhook-signature': crypto.createHmac('sha256', subscriber.secret).update(msg).digest('hex'),
    };

    if (subscriber.previous_secret && subscriber.secret_rotated_at) {
      const age = Date.now() - new Date(subscriber.secret_rotated_at).getTime();
      if (age < ROTATION_GRACE_MS) {
        headers['x-webhook-signature-prev'] = crypto
          .createHmac('sha256', subscriber.previous_secret)
          .update(msg)
          .digest('hex');
      }
    }

    return headers;
  }

  private async attemptDelivery(delivery: WebhookDelivery, subscriber?: WebhookSubscriber): Promise<void> {
    const nextAttempt = delivery.attempt_count + 1;

    try {
      this.validateUrl(delivery.target_url);

      const body = JSON.stringify(delivery.payload);
      const response = await this.fetchImpl(delivery.target_url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-event-type': delivery.event_type,
          'x-attempt': String(nextAttempt),
          ...this.buildSignatureHeaders(body, subscriber),
        },
        body,
      });

      if (response.ok) {
        await markWebhookDeliverySuccess(delivery.id, response.status);
        return;
      }

      await this.scheduleFailure(
        delivery,
        nextAttempt,
        `Webhook delivery failed with status ${response.status}`,
        response.status
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown webhook delivery failure';
      await this.scheduleFailure(delivery, nextAttempt, message, null);
    }
  }

  private async scheduleFailure(
    delivery: WebhookDelivery,
    nextAttempt: number,
    message: string,
    responseStatus: number | null
  ): Promise<void> {
    const nextRetryAt = new Date(Date.now() + this.retryDelayMs(nextAttempt));
    await markWebhookDeliveryFailure(
      delivery.id,
      nextAttempt,
      delivery.max_attempts,
      nextRetryAt,
      message,
      responseStatus
    );

  }

  private retryDelayMs(attempt: number): number {
    return 1000 * attempt;
  }
}
