/**
 * Webhook Service
 * 
 * Main service for webhook management:
 * - Register/unregister webhooks
 * - Trigger events
 * - Query webhook status
 * - Manage delivery retries
 */

import { EventType, RemittanceEventPayload, RemittanceData, WebhookPayload } from './types';
import { IWebhookStore } from './store';
import { WebhookDispatcher } from './dispatcher';
import { v4 as uuidv4 } from 'uuid';

export interface WebhookRegistrationRequest {
  url: string;
  events: EventType[];
  secret?: string;
}

export interface WebhookRegistrationResponse {
  id: string;
  url: string;
  events: EventType[];
  active: boolean;
  createdAt?: Date;
}

export class WebhookService {
  private store: IWebhookStore;
  private dispatcher: WebhookDispatcher;

  constructor(store: IWebhookStore, logger?: Console | any) {
    this.store = store;
    this.dispatcher = new WebhookDispatcher(store, logger);
  }

  /**
   * Register a new webhook subscription
   */
  async registerWebhook(request: WebhookRegistrationRequest): Promise<WebhookRegistrationResponse> {
    // Validate request
    if (!request.url) {
      throw new Error('Webhook URL is required');
    }

    if (!request.events || request.events.length === 0) {
      throw new Error('At least one event must be subscribed');
    }

    // Validate events
    const validEvents: EventType[] = [
      'remittance.created',
      'remittance.updated',
      'remittance.completed',
      'remittance.failed',
      'remittance.cancelled',
      'kyc.expiry_warning',
    ];

    for (const event of request.events) {
      if (!validEvents.includes(event)) {
        throw new Error(`Invalid event type: ${event}`);
      }
    }

    // Register in store
    const webhook = await this.store.registerWebhook(request.url, request.events, request.secret);

    return {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
      createdAt: webhook.createdAt,
    };
  }

  /**
   * Unregister a webhook
   */
  async unregisterWebhook(id: string): Promise<boolean> {
    return this.store.unregisterWebhook(id);
  }

  /**
   * Get details of a specific webhook
   */
  async getWebhook(id: string): Promise<WebhookRegistrationResponse | null> {
    const webhook = await this.store.getWebhook(id);
    if (!webhook) return null;

    return {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
      createdAt: webhook.createdAt,
    };
  }

  /**
   * Get all active webhooks
   */
  async listWebhooks(): Promise<WebhookRegistrationResponse[]> {
    const webhooks = await this.store.getAllWebhooks();
    return webhooks.map(w => ({
      id: w.id,
      url: w.url,
      events: w.events,
      active: w.active,
      createdAt: w.createdAt,
    }));
  }

  /**
   * Trigger remittance event
   */
  async onRemittanceStatusChange(
    remittanceId: string,
    status: RemittanceData['status'],
    remittanceData: Omit<RemittanceData, 'id' | 'status'>
  ): Promise<{ success: number; failed: number }> {
    // Determine event type based on status
    let eventType: EventType;
    switch (status) {
      case 'pending':
        eventType = 'remittance.created';
        break;
      case 'processing':
      case 'completed':
        eventType = status === 'completed' ? 'remittance.completed' : 'remittance.updated';
        break;
      case 'failed':
        eventType = 'remittance.failed';
        break;
      case 'cancelled':
        eventType = 'remittance.cancelled';
        break;
      default:
        throw new Error(`Unknown status: ${status}`);
    }

    const payload: RemittanceEventPayload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      id: uuidv4(),
      data: {
        id: remittanceId,
        status,
        ...remittanceData,
        createdAt: remittanceData.createdAt,
        updatedAt: new Date().toISOString(),
      },
    };

    return this.dispatcher.dispatch(eventType, payload);
  }

  /**
   * Trigger custom event
   */
  async triggerEvent(event: EventType, data: any): Promise<{ success: number; failed: number }> {
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      id: uuidv4(),
      data,
    };

    return this.dispatcher.dispatch(event, payload);
  }

  /**
   * Retry pending webhook deliveries (for background jobs)
   */
  async retryPendingDeliveries(): Promise<void> {
    return this.dispatcher.retryPendingDeliveries();
  }

  /**
   * Get dispatcher for advanced usage
   */
  getDispatcher(): WebhookDispatcher {
    return this.dispatcher;
  }
}
