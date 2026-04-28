/**
 * Webhook Types
 * 
 * Shared types for webhook system
 */

export type EventType =
  | 'remittance.created'
  | 'remittance.updated'
  | 'remittance.completed'
  | 'remittance.failed'
  | 'remittance.cancelled'
  | 'kyc.expiry_warning';

export interface WebhookSubscriber {
  id: string;
  url: string;
  events: EventType[];
  secret: string;
  active: boolean;
  /** Content-Type to use when delivering payloads. Defaults to 'application/json'. */
  content_type?: 'application/json' | 'application/x-www-form-urlencoded';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WebhookPayload<T = any> {
  event: EventType;
  timestamp: string;
  data: T;
  id?: string; // Unique event ID for idempotency
}

export interface RemittanceData {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  amount: number;
  currency: string;
  sourceCurrency?: string;
  recipientId: string;
  reason?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface RemittanceEventPayload extends WebhookPayload {
  data: RemittanceData;
}

export interface WebhookDeliveryRecord {
  id?: string;
  webhookId: string;
  eventType: EventType;
  payload: any;
  status: 'pending' | 'success' | 'failed';
  attempt: number;
  maxRetries: number;
  error?: string;
  responseStatus?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WebhookDeliveryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

export interface WebhookSignatureHeaders {
  'x-webhook-signature': string;
  'x-webhook-timestamp': string;
  'x-webhook-id': string;
}

export interface DeadLetterRecord {
  id: string;
  deliveryId: string;
  webhookId: string;
  eventType: EventType;
  payload: any;
  lastError?: string;
  attempts: number;
  createdAt: Date;
  replayedAt?: Date;
}

export interface KycExpiryWarningData {
  user_id: string;
  anchor_id: string;
  expires_at: string;
  days_until_expiry: number;
  renewal_url: string;
}

export interface KycExpiryWarningPayload extends WebhookPayload {
  event: 'kyc.expiry_warning';
  data: KycExpiryWarningData;
}
