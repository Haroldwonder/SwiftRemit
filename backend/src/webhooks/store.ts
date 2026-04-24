/**
 * Webhook Store
 * 
 * Manages webhook registration and retrieval.
 * Uses in-memory storage with optional database persistence.
 * 
 * This provides a database abstraction that can be swapped
 * for PostgreSQL, MongoDB, or other storage backends.
 */

import { Pool, QueryResult } from 'pg';
import { EventType, WebhookSubscriber, WebhookDeliveryRecord } from './types';

export interface IWebhookStore {
  // Webhook Registration
  registerWebhook(url: string, events: EventType[], secret?: string): Promise<WebhookSubscriber>;
  unregisterWebhook(id: string): Promise<boolean>;
  getWebhook(id: string): Promise<WebhookSubscriber | null>;
  getAllWebhooks(): Promise<WebhookSubscriber[]>;
  
  // Event Subscription
  getSubscribers(event: EventType): Promise<WebhookSubscriber[]>;
  
  // Delivery Tracking
  recordDelivery(delivery: WebhookDeliveryRecord): Promise<string>;
  updateDeliveryStatus(deliveryId: string, status: 'pending' | 'success' | 'failed', attempt: number, error?: string): Promise<void>;
  getPendingDeliveries(limit?: number): Promise<WebhookDeliveryRecord[]>;
}

/**
 * In-Memory Webhook Store
 * 
 * Suitable for development and testing. Data is lost on restart.
 */
export class InMemoryWebhookStore implements IWebhookStore {
  private webhooks: Map<string, WebhookSubscriber> = new Map();
  private deliveries: Map<string, WebhookDeliveryRecord> = new Map();

  async registerWebhook(url: string, events: EventType[], secret?: string): Promise<WebhookSubscriber> {
    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid webhook URL: ${url}`);
    }

    // Check for duplicates
    const existing = Array.from(this.webhooks.values()).find(w => w.url === url);
    if (existing) {
      throw new Error(`Webhook URL already registered: ${url}`);
    }

    const webhookId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const webhook: WebhookSubscriber = {
      id: webhookId,
      url,
      events: events || [],
      secret: secret || '',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.webhooks.set(webhookId, webhook);
    return webhook;
  }

  async unregisterWebhook(id: string): Promise<boolean> {
    return this.webhooks.delete(id);
  }

  async getWebhook(id: string): Promise<WebhookSubscriber | null> {
    return this.webhooks.get(id) || null;
  }

  async getAllWebhooks(): Promise<WebhookSubscriber[]> {
    return Array.from(this.webhooks.values());
  }

  async getSubscribers(event: EventType): Promise<WebhookSubscriber[]> {
    return Array.from(this.webhooks.values()).filter(
      w => w.active && w.events.includes(event)
    );
  }

  async recordDelivery(delivery: WebhookDeliveryRecord): Promise<string> {
    const deliveryId = `delivery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.deliveries.set(deliveryId, {
      ...delivery,
      id: deliveryId,
    });
    return deliveryId;
  }

  async updateDeliveryStatus(
    deliveryId: string,
    status: 'pending' | 'success' | 'failed',
    attempt: number,
    error?: string
  ): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (delivery) {
      delivery.status = status;
      delivery.attempt = attempt;
      if (error) delivery.error = error;
      delivery.updatedAt = new Date();
    }
  }

  async getPendingDeliveries(limit: number = 100): Promise<WebhookDeliveryRecord[]> {
    return Array.from(this.deliveries.values())
      .filter(d => d.status === 'pending' || (d.status === 'failed' && d.attempt < d.maxRetries))
      .sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0))
      .slice(0, limit);
  }
}

/**
 * PostgreSQL Webhook Store
 * 
 * Persistent storage using PostgreSQL.
 */
export class PostgresWebhookStore implements IWebhookStore {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async registerWebhook(url: string, events: EventType[], secret?: string): Promise<WebhookSubscriber> {
    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid webhook URL: ${url}`);
    }

    const result = await this.pool.query(
      `INSERT INTO webhooks (url, events, secret, active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (url) DO NOTHING
       RETURNING id, url, events, secret, active, created_at, updated_at`,
      [url, JSON.stringify(events), secret || null]
    );

    if (result.rows.length === 0) {
      throw new Error(`Webhook URL already registered: ${url}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      url: row.url,
      events: row.events,
      secret: row.secret,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async unregisterWebhook(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE webhooks SET active = FALSE WHERE id = $1`,
      [id]
    );
    return result.rowCount > 0;
  }

  async getWebhook(id: string): Promise<WebhookSubscriber | null> {
    const result = await this.pool.query(
      `SELECT id, url, events, secret, active, created_at, updated_at
       FROM webhooks WHERE id = $1 AND active = TRUE`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      url: row.url,
      events: row.events,
      secret: row.secret,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getAllWebhooks(): Promise<WebhookSubscriber[]> {
    const result = await this.pool.query(
      `SELECT id, url, events, secret, active, created_at, updated_at
       FROM webhooks WHERE active = TRUE ORDER BY created_at DESC`
    );

    return result.rows.map(row => ({
      id: row.id,
      url: row.url,
      events: row.events,
      secret: row.secret,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getSubscribers(event: EventType): Promise<WebhookSubscriber[]> {
    const result = await this.pool.query(
      `SELECT id, url, events, secret, active, created_at, updated_at
       FROM webhooks 
       WHERE active = TRUE 
       AND events @> $1::jsonb
       ORDER BY created_at ASC`,
      [JSON.stringify([event])]
    );

    return result.rows.map(row => ({
      id: row.id,
      url: row.url,
      events: row.events,
      secret: row.secret,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async recordDelivery(delivery: WebhookDeliveryRecord): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status, attempt, max_retries)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        delivery.webhookId,
        delivery.eventType,
        JSON.stringify(delivery.payload),
        delivery.status,
        delivery.attempt,
        delivery.maxRetries,
      ]
    );

    return result.rows[0].id;
  }

  async updateDeliveryStatus(
    deliveryId: string,
    status: 'pending' | 'success' | 'failed',
    attempt: number,
    error?: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_deliveries 
       SET status = $1, attempt = $2, error = $3, updated_at = NOW()
       WHERE id = $4`,
      [status, attempt, error || null, deliveryId]
    );
  }

  async getPendingDeliveries(limit: number = 100): Promise<WebhookDeliveryRecord[]> {
    const result = await this.pool.query(
      `SELECT id, webhook_id, event_type, payload, status, attempt, max_retries, created_at, updated_at, error
       FROM webhook_deliveries
       WHERE (status = 'pending' OR (status = 'failed' AND attempt < max_retries))
       AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      webhookId: row.webhook_id,
      eventType: row.event_type,
      payload: JSON.parse(row.payload),
      status: row.status,
      attempt: row.attempt,
      maxRetries: row.max_retries,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      error: row.error,
    }));
  }
}

/**
 * Factory function to create webhook store
 */
export function createWebhookStore(pool?: Pool): IWebhookStore {
  if (pool) {
    return new PostgresWebhookStore(pool);
  }
  return new InMemoryWebhookStore();
}
