import { Pool } from 'pg';
import { WebhookSubscriber, WebhookDelivery } from '../types';

function mapRow(row: Record<string, unknown>): WebhookDelivery {
  return {
    id: String(row.id),
    event_type: String(row.event_type),
    event_key: String(row.event_key),
    subscriber_id: String(row.subscriber_id),
    target_url: String(row.target_url),
    payload: row.payload,
    status: row.status as WebhookDelivery['status'],
    attempt_count: Number(row.attempt_count),
    max_attempts: Number(row.max_attempts),
    next_retry_at: row.next_retry_at as Date,
    last_error: row.last_error as string | null | undefined,
    response_status: row.response_status as number | null | undefined,
    delivered_at: row.delivered_at as Date | null | undefined,
  };
}

export class WebhookRepository {
  constructor(private readonly pool: Pool) {}

  async getActiveSubscribers(): Promise<WebhookSubscriber[]> {
    const result = await this.pool.query(
      `SELECT id, url, secret, active, created_at, updated_at
       FROM webhook_subscribers WHERE active = true`
    );
    return result.rows.map((r) => ({
      id: String(r.id),
      url: String(r.url),
      secret: r.secret as string | null,
      active: Boolean(r.active),
      created_at: r.created_at as Date,
      updated_at: r.updated_at as Date,
    }));
  }

  async enqueue(
    eventType: string,
    eventKey: string,
    subscriber: WebhookSubscriber,
    payload: unknown,
    maxAttempts: number
  ): Promise<WebhookDelivery> {
    const result = await this.pool.query(
      `INSERT INTO webhook_deliveries
         (event_type, event_key, subscriber_id, target_url, payload, max_attempts, status, attempt_count, next_retry_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'pending', 0, NOW())
       ON CONFLICT (event_type, event_key, subscriber_id) DO UPDATE SET
         payload      = EXCLUDED.payload,
         max_attempts = EXCLUDED.max_attempts,
         status       = 'pending',
         attempt_count = 0,
         next_retry_at = NOW(),
         updated_at   = NOW()
       RETURNING *`,
      [eventType, eventKey, subscriber.id, subscriber.url, JSON.stringify(payload), maxAttempts]
    );
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  async getPending(limit: number): Promise<WebhookDelivery[]> {
    const result = await this.pool.query(
      `SELECT * FROM webhook_deliveries
       WHERE status = 'pending' AND next_retry_at <= NOW()
       ORDER BY next_retry_at ASC LIMIT $1`,
      [limit]
    );
    return result.rows.map((r) => mapRow(r as Record<string, unknown>));
  }

  async markSuccess(id: string, responseStatus: number): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_deliveries
       SET status = 'success', response_status = $2, delivered_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id, responseStatus]
    );
  }

  async markFailure(
    id: string,
    attemptCount: number,
    maxAttempts: number,
    nextRetryAt: Date,
    message: string,
    responseStatus: number | null
  ): Promise<void> {
    const status: WebhookDelivery['status'] = attemptCount >= maxAttempts ? 'failed' : 'pending';
    await this.pool.query(
      `UPDATE webhook_deliveries
       SET attempt_count = $2, status = $3, next_retry_at = $4,
           last_error = $5, response_status = $6, updated_at = NOW()
       WHERE id = $1`,
      [id, attemptCount, status, nextRetryAt, message, responseStatus]
    );
  }
}
