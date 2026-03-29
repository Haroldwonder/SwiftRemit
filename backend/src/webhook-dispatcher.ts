import {
  enqueueWebhookDelivery,
  getActiveWebhookSubscribers,
  getPendingWebhookDeliveries,
  markWebhookDeliveryFailure,
  markWebhookDeliverySuccess,
} from './database';
import { RemittanceCreatedWebhookPayload, WebhookDelivery } from './types';

const MAX_RETRIES = 5;

export class WebhookDispatcher {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async dispatchRemittanceCreated(payload: RemittanceCreatedWebhookPayload): Promise<void> {
    const subscribers = await getActiveWebhookSubscribers();
    const deliveries = await Promise.all(
      subscribers.map((subscriber) =>
        enqueueWebhookDelivery('remittance.created', payload.remittance_id, subscriber, payload, MAX_RETRIES)
      )
    );

    for (const delivery of deliveries) {
      await this.attemptDelivery(delivery);
    }
  }

  async retryPendingDeliveries(limit: number = 100): Promise<void> {
    const deliveries = await getPendingWebhookDeliveries(limit);
    for (const delivery of deliveries) {
      await this.attemptDelivery(delivery);
    }
  }

  private async attemptDelivery(delivery: WebhookDelivery): Promise<void> {
    const nextAttempt = delivery.attempt_count + 1;

    try {
      const response = await this.fetchImpl(delivery.target_url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-event-type': delivery.event_type,
          'x-attempt': String(nextAttempt),
        },
        body: JSON.stringify(delivery.payload),
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
