/**
 * KYC Expiry Notifier (#480)
 *
 * Queries user_kyc_status for records expiring within the next 7 days
 * and dispatches a `kyc.expiry_warning` webhook to all subscribers.
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { IWebhookStore } from './webhooks/store';
import { WebhookDispatcher } from './webhooks/dispatcher';
import type { KycExpiryWarningPayload } from './webhooks/types';

const WARN_DAYS = 7;
const RENEWAL_BASE_URL = process.env.KYC_RENEWAL_BASE_URL ?? 'https://app.swiftremit.io/kyc/renew';

export class KycExpiryNotifier {
  private dispatcher: WebhookDispatcher;

  constructor(private pool: Pool, store: IWebhookStore) {
    this.dispatcher = new WebhookDispatcher(store);
  }

  /**
   * Find KYC records expiring in the next WARN_DAYS days and send warnings.
   * Returns the number of notifications dispatched.
   */
  async run(): Promise<number> {
    const result = await this.pool.query<{
      user_id: string;
      anchor_id: string;
      expires_at: Date;
    }>(
      `SELECT user_id, anchor_id, expires_at
       FROM user_kyc_status
       WHERE expires_at IS NOT NULL
         AND expires_at > NOW()
         AND expires_at <= NOW() + INTERVAL '${WARN_DAYS} days'
         AND status = 'approved'`
    );

    let dispatched = 0;

    for (const row of result.rows) {
      const expiresAt = new Date(row.expires_at);
      const daysUntilExpiry = Math.ceil(
        (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      const payload: KycExpiryWarningPayload = {
        event: 'kyc.expiry_warning',
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        data: {
          user_id: row.user_id,
          anchor_id: row.anchor_id,
          expires_at: expiresAt.toISOString(),
          days_until_expiry: daysUntilExpiry,
          renewal_url: `${RENEWAL_BASE_URL}?user=${encodeURIComponent(row.user_id)}&anchor=${encodeURIComponent(row.anchor_id)}`,
        },
      };

      try {
        await this.dispatcher.dispatch('kyc.expiry_warning', payload);
        dispatched++;
      } catch (err) {
        console.error('KYC expiry notification failed', { user_id: row.user_id, anchor_id: row.anchor_id, err });
      }
    }

    console.log(`KYC expiry notifier: ${dispatched} notification(s) dispatched`);
    return dispatched;
  }
}
