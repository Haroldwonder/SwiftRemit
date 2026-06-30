/**
 * KYC Expiry Notifier (#480 / #862)
 *
 * Queries user_kyc_status for records expiring within the next 7 days,
 * dispatches a `kyc.expiry_warning` webhook, initiates SEP-12 re-verification
 * via the anchor, and marks the user as `re_verification_pending` in the DB
 * so that new remittances are blocked until the anchor confirms re-KYC.
 */

import axios from 'axios';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { IWebhookStore } from './webhooks/store';
import { WebhookDispatcher } from './webhooks/dispatcher';
import type { KycExpiryWarningPayload } from './webhooks/types';
import { getAnchorKycConfigs } from './database';

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
    const maxRetries = 5;
    const baseDelayMs = 1000;

    const queryRows = async (): Promise<Array<{ user_id: string; anchor_id: string; expires_at: Date }>> => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
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
          return result.rows;
        } catch (err) {
          if (attempt === maxRetries) {
            console.error('KYC expiry notifier: DB query failed after max retries', err);
            return [];
          }
          const delay = baseDelayMs * 2 ** attempt;
          console.error(`KYC expiry notifier: DB query failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, err);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      return [];
    };

    const rows = await queryRows();

    let dispatched = 0;

    for (const row of rows) {
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

      // Initiate re-verification: call SEP-12 PUT /customer and mark as re_verification_pending
      try {
        await this.initiateReVerification(row.user_id, row.anchor_id);
      } catch (err) {
        console.error('KYC re-verification initiation failed', { user_id: row.user_id, anchor_id: row.anchor_id, err });
      }
    }

    console.log(`KYC expiry notifier: ${dispatched} notification(s) dispatched`);
    return dispatched;
  }

  /**
   * Call anchor SEP-12 PUT /customer to queue re-KYC, then set the user's
   * status to `re_verification_pending` so new remittances are blocked.
   */
  async initiateReVerification(userId: string, anchorId: string): Promise<void> {
    const configs = await getAnchorKycConfigs();
    const config = configs.find(c => c.anchor_id === anchorId);
    if (!config) {
      console.warn(`KYC re-verification: no config for anchor ${anchorId}`);
      return;
    }

    // SEP-12 PUT /customer — signals to the anchor that re-KYC is needed
    await axios.put(
      `${config.kyc_server_url}/customer`,
      { account: userId },
      {
        headers: {
          Authorization: `Bearer ${config.auth_token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      }
    );

    // Mark in DB so remittances are blocked
    await this.pool.query(
      `UPDATE user_kyc_status
          SET status = 're_verification_pending', last_checked = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND anchor_id = $2`,
      [userId, anchorId]
    );
    console.log(`KYC re-verification initiated for user ${userId} on anchor ${anchorId}`);
  }
}