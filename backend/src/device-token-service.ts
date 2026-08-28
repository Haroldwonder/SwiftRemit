/**
 * Device Token Service — SR-095
 *
 * Manages Expo push tokens per user, sends push notifications via the
 * Expo Push API, and integrates with the existing notification-templates
 * system for localised payloads.
 *
 * Push notification payloads deliberately omit financial amounts and PII
 * to comply with lock-screen preview requirements. Deep-link data is
 * embedded in the `data` field and handled client-side.
 */

import axios from 'axios';
import { Pool } from 'pg';
import { buildLocalizedMessage, TemplateKey } from './notification-templates';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Platform = 'ios' | 'android' | 'web';

export interface DeviceToken {
  id: number;
  user_id: string;
  token: string;
  platform: Platform;
  created_at: string;
  updated_at: string;
}

export interface RegisterDevicePayload {
  userId: string;
  token: string;
  platform: Platform;
}

/** Data attached to every push notification for deep-linking on the client. */
export type PushNotificationData =
  | { type: 'remittance'; remittanceId: string }
  | { type: 'kyc' };

export interface SendPushPayload {
  userId: string;
  templateKey: TemplateKey;
  locale?: string;
  data: PushNotificationData;
}

// ─── Expo Push API ────────────────────────────────────────────────────────────

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo error codes that mean the token is permanently dead and must be dropped. */
const EXPO_PERMANENT_ERROR_CODES = new Set(['DeviceNotRegistered']);

interface ExpoMessage {
  to: string;
  title: string;
  /** Body deliberately omits amounts/PII — only a generic localised string. */
  body: string;
  data: PushNotificationData;
  /**
   * iOS: 'default' sends sound; 'critical' bypasses Do Not Disturb.
   * We use 'default' throughout.
   */
  sound?: 'default' | null;
  /** Badge count update. null = don't change. */
  badge?: number;
  /** Channel ID for Android O+ notification channels. */
  channelId?: string;
  /** Priority hint — 'high' wakes the device immediately. */
  priority?: 'default' | 'normal' | 'high';
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** Per-message outcome of a `sendExpoPush` call, keyed back to the source token. */
export interface ExpoSendOutcome {
  token: string;
  ticket: ExpoTicket;
}

/**
 * POST a batch of messages to the Expo Push API.
 *
 * Returns the raw ticket for every message so callers can react to
 * `details.error === 'DeviceNotRegistered'` (permanently dead token — must be
 * deleted) and record the ticket `id` of successful sends so a later job can
 * poll `/getReceipts` for delivery failures that only surface after Expo has
 * actually attempted delivery to APNs/FCM.
 */
async function sendExpoPush(messages: ExpoMessage[]): Promise<ExpoSendOutcome[]> {
  if (messages.length === 0) return [];

  // Expo allows up to 100 messages per request.
  const chunks: ExpoMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  const outcomes: ExpoSendOutcome[] = [];

  for (const chunk of chunks) {
    try {
      const { data: result } = await axios.post<{ data: ExpoTicket[] }>(
        EXPO_PUSH_URL,
        chunk,
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
      );

      result.data.forEach((ticket, index) => {
        const message = chunk[index];
        if (!message) return;

        if (ticket.status === 'error') {
          console.error('[push] Expo push error:', ticket.message, ticket.details?.error ?? '');
        }

        outcomes.push({ token: message.to, ticket });
      });
    } catch (err) {
      console.error('[push] Failed to send Expo push batch:', err);
    }
  }

  return outcomes;
}

/**
 * POST a batch of previously-issued ticket IDs to Expo's `/getReceipts`
 * endpoint. Expo only accepts up to 1000 IDs per request.
 */
async function fetchExpoReceipts(ticketIds: string[]): Promise<Record<string, ExpoReceipt>> {
  if (ticketIds.length === 0) return {};

  const receipts: Record<string, ExpoReceipt> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < ticketIds.length; i += 1000) {
    chunks.push(ticketIds.slice(i, i + 1000));
  }

  for (const chunk of chunks) {
    try {
      const { data: result } = await axios.post<{ data: Record<string, ExpoReceipt> }>(
        EXPO_RECEIPTS_URL,
        { ids: chunk },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
      );
      Object.assign(receipts, result.data);
    } catch (err) {
      console.error('[push] Failed to fetch Expo push receipts:', err);
    }
  }

  return receipts;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class DeviceTokenService {
  private pushTicketsTableReady = false;

  constructor(private readonly pool: Pool) {}

  /**
   * Lazily create the table that tracks in-flight Expo push tickets so the
   * receipt-polling job can later resolve them via `/getReceipts`.
   */
  private async ensurePushTicketsTable(): Promise<void> {
    if (this.pushTicketsTableReady) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS expo_push_tickets (
        id          SERIAL PRIMARY KEY,
        ticket_id   TEXT UNIQUE NOT NULL,
        token       TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_expo_push_tickets_created_at ON expo_push_tickets(created_at);
    `);
    this.pushTicketsTableReady = true;
  }

  /**
   * Register (upsert) a device token for a user.
   * If the token already exists for a different user it is re-assigned
   * (handles device hand-off / re-login scenarios).
   */
  async register(payload: RegisterDevicePayload): Promise<void> {
    const { userId, token, platform } = payload;
    await this.pool.query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET
         user_id    = EXCLUDED.user_id,
         platform   = EXCLUDED.platform,
         updated_at = NOW()`,
      [userId, token, platform],
    );
  }

  /**
   * Deregister a specific device token.
   * Called on logout so the device stops receiving notifications.
   */
  async deregister(token: string): Promise<void> {
    await this.pool.query('DELETE FROM device_tokens WHERE token = $1', [token]);
  }

  /**
   * Deregister ALL tokens for a user.
   * Called when a user account is deleted.
   */
  async deregisterAll(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM device_tokens WHERE user_id = $1', [userId]);
  }

  /**
   * Retrieve all active push tokens for a user.
   */
  async getTokensForUser(userId: string): Promise<DeviceToken[]> {
    const result = await this.pool.query<DeviceToken>(
      'SELECT * FROM device_tokens WHERE user_id = $1',
      [userId],
    );
    return result.rows;
  }

  /**
   * Send a localised push notification to all devices belonging to a user.
   *
   * The push body contains only the generic localised subject line —
   * no financial amounts or PII — to satisfy lock-screen preview requirements.
   * Detailed data is surfaced only after the user unlocks and opens the app
   * via the `data` payload used for deep-linking.
   */
  async sendToUser(payload: SendPushPayload): Promise<void> {
    const { userId, templateKey, locale, data } = payload;

    const tokens = await this.getTokensForUser(userId);
    if (tokens.length === 0) return;

    // Build localised title/body — body is the safe subject line only, no amounts.
    const { subject } = buildLocalizedMessage(locale, templateKey, {});

    const messages: ExpoMessage[] = tokens.map((device) => ({
      to: device.token,
      title: 'SwiftRemit',
      body: subject,          // Generic subject: no amounts, no PII on lock screen.
      data,
      sound: 'default',
      priority: 'high',
      channelId: data.type === 'remittance' ? 'remittance' : 'kyc',
    }));

    const outcomes = await sendExpoPush(messages);
    await this.processSendOutcomes(userId, outcomes);
  }

  /**
   * React to the ticket phase of an Expo push send: permanently invalid
   * tokens (`details.error === 'DeviceNotRegistered'`) are deleted
   * immediately per Expo's client contract, and successful tickets are
   * persisted so `pollReceiptsAndPruneStaleTokens()` can later resolve the
   * delivery-receipt phase, which is the only place non-registration
   * failures (rejected, invalid credentials, etc.) actually surface.
   */
  private async processSendOutcomes(userId: string, outcomes: ExpoSendOutcome[]): Promise<void> {
    if (outcomes.length === 0) return;

    for (const { token, ticket } of outcomes) {
      if (ticket.status === 'error') {
        if (ticket.details?.error && EXPO_PERMANENT_ERROR_CODES.has(ticket.details.error)) {
          console.warn(`[push] Deregistering permanently invalid token for user ${userId} (${ticket.details.error})`);
          await this.deregister(token).catch((err) =>
            console.error('[push] Failed to deregister dead token:', err),
          );
        }
        continue;
      }

      if (ticket.status === 'ok' && ticket.id) {
        await this.recordPushTicket(ticket.id, token, userId).catch((err) =>
          console.error('[push] Failed to record Expo push ticket:', err),
        );
      }
    }
  }

  /** Persist a successful Expo ticket ID for later receipt polling. */
  private async recordPushTicket(ticketId: string, token: string, userId: string): Promise<void> {
    await this.ensurePushTicketsTable();
    await this.pool.query(
      `INSERT INTO expo_push_tickets (ticket_id, token, user_id) VALUES ($1, $2, $3)
       ON CONFLICT (ticket_id) DO NOTHING`,
      [ticketId, token, userId],
    );
  }

  /**
   * Poll Expo's `/getReceipts` endpoint for previously-issued ticket IDs and
   * prune device tokens whose receipt reports `DeviceNotRegistered`.
   *
   * Expo receipts typically become available a few minutes after the ticket
   * is issued and remain retrievable for about 24 hours, so this only
   * resolves tickets in that window and drops (without re-checking) any
   * ticket older than that — Expo would return "not found" for those anyway.
   *
   * Intended to run on a schedule (see scheduler.ts). Returns the number of
   * tokens pruned.
   */
  async pollReceiptsAndPruneStaleTokens(): Promise<number> {
    await this.ensurePushTicketsTable();

    const pending = await this.pool.query<{ ticket_id: string; token: string; user_id: string }>(
      `SELECT ticket_id, token, user_id FROM expo_push_tickets
       WHERE created_at <= NOW() - INTERVAL '2 minutes'
         AND created_at >= NOW() - INTERVAL '24 hours'
       LIMIT 1000`,
    );

    // Tickets older than 24h can never be resolved — drop them so the table
    // doesn't grow unbounded.
    await this.pool.query(`DELETE FROM expo_push_tickets WHERE created_at < NOW() - INTERVAL '24 hours'`);

    if (pending.rows.length === 0) return 0;

    const receipts = await fetchExpoReceipts(pending.rows.map((row) => row.ticket_id));
    let prunedCount = 0;
    const resolvedTicketIds: string[] = [];

    for (const row of pending.rows) {
      const receipt = receipts[row.ticket_id];
      if (!receipt) continue; // Not ready yet — leave it for the next run.

      resolvedTicketIds.push(row.ticket_id);

      if (receipt.status === 'error' && receipt.details?.error && EXPO_PERMANENT_ERROR_CODES.has(receipt.details.error)) {
        console.warn(`[push] Pruning token for user ${row.user_id} after receipt error: ${receipt.details.error}`);
        await this.deregister(row.token).catch((err) =>
          console.error('[push] Failed to deregister token after receipt check:', err),
        );
        prunedCount++;
      } else if (receipt.status === 'error') {
        console.error(`[push] Delivery receipt error for user ${row.user_id}:`, receipt.message);
      }
    }

    if (resolvedTicketIds.length > 0) {
      await this.pool.query(`DELETE FROM expo_push_tickets WHERE ticket_id = ANY($1::text[])`, [resolvedTicketIds]);
    }

    return prunedCount;
  }
}
