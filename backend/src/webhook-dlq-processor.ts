/**
 * WebhookDlqProcessor — SR-027
 *
 * Scheduled processor for the webhook dead-letter queue.
 *
 * Responsibilities:
 *  1. Retry eligible DLQ entries with exponential backoff up to a
 *     configurable per-entry max age (DLQ_MAX_AGE_HOURS).
 *  2. Expire entries that have exceeded the max age (set expired_at; entries
 *     are never deleted so auditors can still query them).
 *  3. After each retry failure, increment consecutive_failures on the webhook
 *     row.  When consecutive_failures reaches DLQ_DISABLE_THRESHOLD, mark
 *     the webhook inactive (disabled_at) and send an email to the owner if
 *     owner_email is set.
 *
 * Environment variables (all optional; defaults shown):
 *   DLQ_MAX_AGE_HOURS        – hours before entry is expired without retry  (default: 72)
 *   DLQ_RETRY_BASE_MS        – base delay for backoff in ms                 (default: 30000)
 *   DLQ_RETRY_MAX_MS         – max delay cap in ms                          (default: 3600000)
 *   DLQ_RETRY_JITTER_PERCENT – ±% jitter added to capped delay              (default: 20)
 *   DLQ_DISABLE_THRESHOLD    – consecutive failures before auto-disable     (default: 10)
 *   DLQ_BATCH_SIZE           – max entries processed per scheduler run      (default: 50)
 */

import crypto from 'crypto';
import { Pool } from 'pg';
import { sendEmail } from './email';
import { createLogger } from './correlation-id';

const logger = createLogger('WebhookDlqProcessor');

// ── Configuration ─────────────────────────────────────────────────────────────

const DLQ_MAX_AGE_HOURS       = parseInt(process.env.DLQ_MAX_AGE_HOURS       ?? '72',      10);
const DLQ_RETRY_BASE_MS       = parseInt(process.env.DLQ_RETRY_BASE_MS       ?? '30000',   10);
const DLQ_RETRY_MAX_MS        = parseInt(process.env.DLQ_RETRY_MAX_MS        ?? '3600000', 10);
const DLQ_RETRY_JITTER_PERCENT= parseInt(process.env.DLQ_RETRY_JITTER_PERCENT?? '20',      10);
export const DLQ_DISABLE_THRESHOLD = parseInt(process.env.DLQ_DISABLE_THRESHOLD ?? '10',   10);
const DLQ_BATCH_SIZE          = parseInt(process.env.DLQ_BATCH_SIZE          ?? '50',      10);

// ── Types ─────────────────────────────────────────────────────────────────────

interface DlqEntry {
  id: string;
  webhook_id: string;
  subscription_id: string | null;
  event_type: string;
  payload: unknown;
  last_error: string | null;
  attempts: number;
  created_at: Date;
}

interface WebhookRow {
  id: string;
  url: string;
  secret: string | null;
  active: boolean;
  owner_email: string | null;
  consecutive_failures: number;
  disabled_at: Date | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute exponential backoff delay with ±jitter.
 * `attempt` is 1-indexed (the attempt count *after* the failure).
 */
function retryDelayMs(attempt: number): number {
  const base   = DLQ_RETRY_BASE_MS * Math.pow(2, attempt - 1);
  const capped = Math.min(base, DLQ_RETRY_MAX_MS);
  const jitterRange = (capped * DLQ_RETRY_JITTER_PERCENT) / 100;
  const jitter = (Math.random() - 0.5) * 2 * jitterRange;
  return Math.max(0, capped + jitter);
}

/** Build HMAC-SHA256 signature headers for a re-delivery attempt. */
function signatureHeaders(body: string, secret: string | null): Record<string, string> {
  if (!secret) return {};
  const ts  = Date.now().toString();
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return { 'x-webhook-timestamp': ts, 'x-webhook-signature': sig };
}

// ── Processor ─────────────────────────────────────────────────────────────────

export class WebhookDlqProcessor {
  constructor(private readonly pool: Pool) {}

  /**
   * Main entry point — called by the scheduler (every 5 minutes).
   * Step 1: expire entries older than DLQ_MAX_AGE_HOURS.
   * Step 2: retry eligible pending entries with exponential backoff.
   */
  async run(): Promise<void> {
    await this.expireStaleEntries();
    await this.retryPendingEntries();
  }

  // ── Step 1: expire stale entries ──────────────────────────────────────────

  private async expireStaleEntries(): Promise<void> {
    try {
      const result = await this.pool.query(
        `UPDATE webhook_dead_letters
            SET expired_at = NOW()
          WHERE replayed_at IS NULL
            AND expired_at  IS NULL
            AND created_at  < NOW() - ($1 || ' hours')::INTERVAL
          RETURNING id`,
        [DLQ_MAX_AGE_HOURS]
      );
      const count = result.rowCount ?? 0;
      if (count > 0) {
        logger.info(`DLQ expiry: marked ${count} entries as expired (age > ${DLQ_MAX_AGE_HOURS}h)`);
      }
    } catch (err) {
      logger.error('DLQ expiry step failed', err);
    }
  }

  // ── Step 2: retry pending entries ─────────────────────────────────────────

  private async retryPendingEntries(): Promise<void> {
    let entries: DlqEntry[];
    try {
      const res = await this.pool.query<DlqEntry>(
        `SELECT id,
                webhook_id,
                COALESCE(subscription_id, webhook_id) AS subscription_id,
                event_type,
                payload,
                last_error,
                attempts,
                created_at
           FROM webhook_dead_letters
          WHERE replayed_at IS NULL
            AND expired_at  IS NULL
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          ORDER BY created_at ASC
          LIMIT $1`,
        [DLQ_BATCH_SIZE]
      );
      entries = res.rows;
    } catch (err) {
      logger.error('DLQ retry: failed to fetch pending entries', err);
      return;
    }

    if (entries.length === 0) return;

    logger.info(`DLQ retry: processing ${entries.length} entries`);

    for (const entry of entries) {
      await this.processEntry(entry);
    }
  }

  // ── Process one entry ──────────────────────────────────────────────────────

  private async processEntry(entry: DlqEntry): Promise<void> {
    // Load the webhook row
    let webhook: WebhookRow | null = null;
    try {
      const res = await this.pool.query<WebhookRow>(
        `SELECT id, url, secret, active, owner_email,
                consecutive_failures, disabled_at
           FROM webhooks
          WHERE id = $1`,
        [entry.webhook_id]
      );
      webhook = res.rows[0] ?? null;
    } catch (err) {
      logger.error(`DLQ retry: failed to load webhook ${entry.webhook_id}`, err);
      return;
    }

    // Webhook gone or already disabled — expire the entry
    if (!webhook || !webhook.active) {
      await this.markExpired(entry.id);
      logger.info(
        `DLQ retry: expired entry ${entry.id} — webhook ${entry.webhook_id} inactive/not found`
      );
      return;
    }

    const delivered = await this.attemptDelivery(entry, webhook);

    if (delivered) {
      await this.markReplayed(entry.id, 'dlq-scheduler');
      await this.resetConsecutiveFailures(webhook.id);
      logger.info(`DLQ retry: entry ${entry.id} re-delivered successfully`);
    } else {
      const newAttempts = entry.attempts + 1;
      const delay       = retryDelayMs(newAttempts);
      const nextRetry   = new Date(Date.now() + delay);

      await this.recordFailure(entry.id, newAttempts, nextRetry);

      const newConsecutive = await this.incrementConsecutiveFailures(webhook.id);

      logger.warn(
        `DLQ retry: entry ${entry.id} failed (attempt ${newAttempts}), ` +
        `next retry in ${Math.round(delay / 1000)}s, ` +
        `consecutive_failures=${newConsecutive}`
      );

      if (newConsecutive >= DLQ_DISABLE_THRESHOLD) {
        await this.disableSubscription(webhook, newConsecutive);
      }
    }
  }

  // ── Delivery attempt ───────────────────────────────────────────────────────

  private async attemptDelivery(entry: DlqEntry, webhook: WebhookRow): Promise<boolean> {
    try {
      if (!webhook.url.startsWith('https://')) {
        logger.warn(`DLQ retry: skipping non-HTTPS webhook ${webhook.id} (${webhook.url})`);
        return false;
      }

      const body    = JSON.stringify(entry.payload);
      const headers: Record<string, string> = {
        'Content-Type':   'application/json',
        'x-event-type':   entry.event_type,
        'x-dlq-attempt':  String(entry.attempts + 1),
        'User-Agent':     'SwiftRemit-DLQ-Retry/1.0',
        ...signatureHeaders(body, webhook.secret),
      };

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30_000),
      });

      return response.ok; // 2xx
    } catch (err) {
      logger.warn(`DLQ retry: network error for entry ${entry.id}`, err);
      return false;
    }
  }

  // ── DB helpers ─────────────────────────────────────────────────────────────

  private async markReplayed(entryId: string, replayedBy: string): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_dead_letters
          SET replayed_at = NOW(), replayed_by = $2
        WHERE id = $1`,
      [entryId, replayedBy]
    );
  }

  private async markExpired(entryId: string): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_dead_letters SET expired_at = NOW() WHERE id = $1`,
      [entryId]
    );
  }

  private async recordFailure(
    entryId: string,
    newAttempts: number,
    nextRetry: Date
  ): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_dead_letters
          SET attempts = $2, next_retry_at = $3
        WHERE id = $1`,
      [entryId, newAttempts, nextRetry]
    );
  }

  private async incrementConsecutiveFailures(webhookId: string): Promise<number> {
    const res = await this.pool.query<{ consecutive_failures: number }>(
      `UPDATE webhooks
          SET consecutive_failures = consecutive_failures + 1
        WHERE id = $1
        RETURNING consecutive_failures`,
      [webhookId]
    );
    return res.rows[0]?.consecutive_failures ?? 0;
  }

  private async resetConsecutiveFailures(webhookId: string): Promise<void> {
    await this.pool.query(
      `UPDATE webhooks SET consecutive_failures = 0 WHERE id = $1`,
      [webhookId]
    );
  }

  // ── Auto-disable + owner notification ─────────────────────────────────────

  /**
   * Mark the subscription inactive and email the owner.
   * Idempotent: if disabled_at is already set this is a no-op.
   */
  async disableSubscription(webhook: WebhookRow, failureCount: number): Promise<void> {
    if (webhook.disabled_at) return; // already disabled

    try {
      const res = await this.pool.query(
        `UPDATE webhooks
            SET active = FALSE, disabled_at = NOW()
          WHERE id = $1 AND active = TRUE
          RETURNING id`,
        [webhook.id]
      );

      if ((res.rowCount ?? 0) === 0) return; // another process beat us to it

      logger.warn(
        `DLQ auto-disable: webhook ${webhook.id} (${webhook.url}) disabled ` +
        `after ${failureCount} consecutive failures`
      );

      if (webhook.owner_email) {
        await this.notifyOwner(webhook, failureCount);
      }
    } catch (err) {
      logger.error(`DLQ auto-disable: failed for webhook ${webhook.id}`, err);
    }
  }

  private async notifyOwner(webhook: WebhookRow, failureCount: number): Promise<void> {
    const disabledAt = new Date().toISOString();

    const subject = `[SwiftRemit] Webhook subscription auto-disabled — ${webhook.url}`;

    const text = [
      `Your webhook subscription has been automatically disabled after`,
      `${failureCount} consecutive failed delivery attempts.`,
      ``,
      `Subscription ID : ${webhook.id}`,
      `URL             : ${webhook.url}`,
      `Disabled at     : ${disabledAt}`,
      ``,
      `Dead-letter entries for this subscription remain accessible via the`,
      `admin API (/admin/webhooks/dlq) and can be bulk-replayed once your`,
      `endpoint is restored.`,
      ``,
      `To re-enable the subscription, fix the endpoint and ask your`,
      `SwiftRemit administrator to set active=true and reset consecutive_failures.`,
      ``,
      `— SwiftRemit Platform`,
    ].join('\n');

    const html = `
<p>Your webhook subscription has been automatically disabled after
<strong>${failureCount} consecutive failed delivery attempts</strong>.</p>
<table cellpadding="4">
  <tr><th align="left">Subscription ID</th><td>${webhook.id}</td></tr>
  <tr><th align="left">URL</th><td>${webhook.url}</td></tr>
  <tr><th align="left">Disabled at</th><td>${disabledAt}</td></tr>
</table>
<p>Dead-letter entries remain accessible via the admin API
(<code>/admin/webhooks/dlq</code>) and can be bulk-replayed once your
endpoint is restored.</p>
<p>To re-enable the subscription, fix the endpoint and contact your
SwiftRemit administrator.</p>`;

    try {
      await sendEmail(webhook.owner_email!, subject, text, html);
      logger.info(`DLQ auto-disable: notification sent to ${webhook.owner_email}`);
    } catch (err) {
      logger.error(
        `DLQ auto-disable: could not send notification to ${webhook.owner_email}`,
        err
      );
    }
  }
}
