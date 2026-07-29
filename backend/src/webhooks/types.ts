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
  | 'kyc.expiry_warning'
  | 'sep24.expired_refund';

export interface WebhookSubscriber {
  id: string;
  url: string;
  events: EventType[];
  secret: string;
  active: boolean;
  /** Content-Type to use when delivering payloads. Defaults to 'application/json'. */
  content_type?: 'application/json' | 'application/x-www-form-urlencoded';
  /**
   * Previous HMAC secret, set during a key rotation.
   * While `secret_rotated_at` is within the 24-hour grace period both the
   * current and the previous secret are used to sign outbound deliveries so
   * that receivers can verify against either key without downtime.
   */
  previous_secret?: string;
  /**
   * ISO-8601 timestamp (or Date) at which the most recent secret rotation
   * occurred.  Used together with `previous_secret` to enforce the 24-hour
   * rotation grace period.
   */
  secret_rotated_at?: string | Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WebhookPayload<T = any> {
  event: EventType;
  timestamp: string;
  data: T;
  id?: string; // Unique event ID for idempotency
  correlation_id?: string; // Correlation ID for end-to-end tracing
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
  correlation_id?: string; // Correlation ID for tracing
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
