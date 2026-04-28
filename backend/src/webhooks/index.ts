/**
 * Webhooks Module
 * 
 * Main export point for all webhook functionality
 */

export { WebhookService } from './service';
export { WebhookDispatcher } from './dispatcher';
export { createWebhookStore, InMemoryWebhookStore, PostgresWebhookStore } from './store';
export type { IWebhookStore } from './store';
export { remittanceEventEmitter, updateRemittanceStatus } from '../remittance/events';
export type {
  EventType,
  WebhookSubscriber,
  WebhookPayload,
  RemittanceData,
  RemittanceEventPayload,
  WebhookDeliveryRecord,
  WebhookDeliveryOptions,
  WebhookSignatureHeaders,
} from './types';
