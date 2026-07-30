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

async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;

  // Expo allows up to 100 messages per request.
  const chunks: ExpoMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      const { data: result } = await axios.post<{ data: { status: string; message?: string }[] }>(
        EXPO_PUSH_URL,
        chunk,
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
      );

      for (const ticket of result.data) {
        if (ticket.status === 'error') {
          console.error('[push] Expo push error:', ticket.message);
        }
      }
    } catch (err) {
      console.error('[push] Failed to send Expo push batch:', err);
    }
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class DeviceTokenService {
  constructor(private readonly pool: Pool) {}

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

    await sendExpoPush(messages);
  }
}
