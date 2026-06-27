/**
 * Notification Service — Issue #852
 *
 * Sends email (SendGrid) and SMS (Twilio) notifications when remittance
 * status changes to completed or failed. Respects per-user opt-out preferences.
 */

import axios from 'axios';
import { Pool } from 'pg';

export type NotificationChannel = 'email' | 'sms';
export type RemittanceNotificationStatus = 'completed' | 'failed' | 'created';

export interface NotificationPreferences {
  user_id: string;
  email?: string;
  phone?: string;
  email_opt_in: boolean;
  sms_opt_in: boolean;
}

export interface RemittanceNotificationPayload {
  remittanceId: string;
  status: RemittanceNotificationStatus;
  amount: number;
  currency: string;
  senderUserId: string;
}

// ─── Provider abstractions ────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL ?? 'noreply@swiftremit.io';
  if (!apiKey) {
    console.warn('[notification] SENDGRID_API_KEY not set — skipping email');
    return;
  }
  await axios.post(
    'https://api.sendgrid.com/v3/mail/send',
    { personalizations: [{ to: [{ email: to }] }], from: { email: from }, subject, content: [{ type: 'text/plain', value: text }] },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
  );
}

async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) {
    console.warn('[notification] Twilio credentials not set — skipping SMS');
    return;
  }
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    params.toString(),
    { auth: { username: accountSid, password: authToken }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildMessage(status: RemittanceNotificationStatus, id: string, amount: number, currency: string): { subject: string; text: string } {
  switch (status) {
    case 'completed':
      return {
        subject: 'Your remittance has been completed',
        text: `Your remittance ${id} of ${amount} ${currency} has been successfully completed.`,
      };
    case 'failed':
      return {
        subject: 'Your remittance has failed',
        text: `Your remittance ${id} of ${amount} ${currency} could not be completed. Funds will be refunded.`,
      };
    case 'created':
      return {
        subject: 'Your remittance has been created',
        text: `Your remittance ${id} of ${amount} ${currency} has been created and is pending processing.`,
      };
  }
}

// ─── Main service ─────────────────────────────────────────────────────────────

export class NotificationService {
  constructor(private readonly pool: Pool) {}

  /**
   * Fetch notification preferences for a user from the DB.
   * Returns null if no preferences row exists.
   */
  async getPreferences(userId: string): Promise<NotificationPreferences | null> {
    const result = await this.pool.query<NotificationPreferences>(
      `SELECT user_id, email, phone, email_opt_in, sms_opt_in
       FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Upsert notification preferences for a user.
   */
  async setPreferences(prefs: NotificationPreferences): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_preferences (user_id, email, phone, email_opt_in, sms_opt_in)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         email_opt_in = EXCLUDED.email_opt_in,
         sms_opt_in = EXCLUDED.sms_opt_in,
         updated_at = NOW()`,
      [prefs.user_id, prefs.email ?? null, prefs.phone ?? null, prefs.email_opt_in, prefs.sms_opt_in],
    );
  }

  /**
   * Send notifications for a remittance status change.
   * Only notifies for completed/failed/created statuses; silently skips others.
   * Respects opt-out preferences.
   */
  async notifyRemittanceStatus(payload: RemittanceNotificationPayload): Promise<void> {
    const { remittanceId, status, amount, currency, senderUserId } = payload;
    const prefs = await this.getPreferences(senderUserId);
    if (!prefs) return; // no contact info registered

    const { subject, text } = buildMessage(status, remittanceId, amount, currency);

    const tasks: Promise<void>[] = [];

    if (prefs.email_opt_in && prefs.email) {
      tasks.push(
        sendEmail(prefs.email, subject, text).catch(err =>
          console.error(`[notification] email failed for ${senderUserId}:`, err),
        ),
      );
    }

    if (prefs.sms_opt_in && prefs.phone) {
      tasks.push(
        sendSms(prefs.phone, text).catch(err =>
          console.error(`[notification] sms failed for ${senderUserId}:`, err),
        ),
      );
    }

    await Promise.all(tasks);
  }
}
