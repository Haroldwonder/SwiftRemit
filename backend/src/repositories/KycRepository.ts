import { Pool } from 'pg';
import { KycStatus, DbUserKycStatus, AnchorKycConfig } from '../types';

export class KycRepository {
  constructor(private readonly pool: Pool) {}

  async saveConfig(config: AnchorKycConfig): Promise<void> {
    await this.pool.query(
      `INSERT INTO anchor_kyc_configs
         (anchor_id, kyc_server_url, auth_token, polling_interval_minutes, enabled)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (anchor_id) DO UPDATE SET
         kyc_server_url           = EXCLUDED.kyc_server_url,
         auth_token               = EXCLUDED.auth_token,
         polling_interval_minutes = EXCLUDED.polling_interval_minutes,
         enabled                  = EXCLUDED.enabled,
         updated_at               = NOW()`,
      [config.anchor_id, config.kyc_server_url, config.auth_token, config.polling_interval_minutes, config.enabled]
    );
  }

  async getConfigs(): Promise<AnchorKycConfig[]> {
    const result = await this.pool.query(`SELECT * FROM anchor_kyc_configs WHERE enabled = TRUE`);
    return result.rows.map((r) => ({
      anchor_id: r.anchor_id,
      kyc_server_url: r.kyc_server_url,
      auth_token: r.auth_token,
      polling_interval_minutes: r.polling_interval_minutes,
      enabled: r.enabled,
    }));
  }

  async saveUserStatus(kycStatus: DbUserKycStatus): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_kyc_status
         (user_id, anchor_id, status, last_checked, expires_at, rejection_reason, verification_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, anchor_id) DO UPDATE SET
         status            = EXCLUDED.status,
         last_checked      = EXCLUDED.last_checked,
         expires_at        = EXCLUDED.expires_at,
         rejection_reason  = EXCLUDED.rejection_reason,
         verification_data = EXCLUDED.verification_data,
         updated_at        = NOW()`,
      [
        kycStatus.user_id,
        kycStatus.anchor_id,
        kycStatus.status,
        kycStatus.last_checked,
        kycStatus.expires_at ?? null,
        kycStatus.rejection_reason ?? null,
        kycStatus.verification_data ? JSON.stringify(kycStatus.verification_data) : null,
      ]
    );
  }

  async getUserStatus(userId: string, anchorId: string): Promise<DbUserKycStatus | null> {
    const result = await this.pool.query(
      `SELECT * FROM user_kyc_status WHERE user_id = $1 AND anchor_id = $2`,
      [userId, anchorId]
    );
    if (!result.rows[0]) return null;
    const r = result.rows[0];
    return {
      user_id: r.user_id,
      anchor_id: r.anchor_id,
      status: r.status as KycStatus,
      last_checked: r.last_checked,
      expires_at: r.expires_at,
      rejection_reason: r.rejection_reason,
      verification_data: r.verification_data,
    };
  }

  async getUsersNeedingCheck(anchorId: string, minutesSinceLastCheck: number): Promise<DbUserKycStatus[]> {
    const result = await this.pool.query(
      `SELECT * FROM user_kyc_status
       WHERE anchor_id = $1
         AND last_checked < NOW() - ($2 || ' minutes')::INTERVAL
         AND status IN ('pending', 'approved')
       ORDER BY last_checked ASC
       LIMIT 100`,
      [anchorId, minutesSinceLastCheck]
    );
    return result.rows.map((r) => ({
      user_id: r.user_id,
      anchor_id: r.anchor_id,
      status: r.status as KycStatus,
      last_checked: r.last_checked,
      expires_at: r.expires_at,
      rejection_reason: r.rejection_reason,
      verification_data: r.verification_data,
    }));
  }

  async getApprovedUsers(): Promise<DbUserKycStatus[]> {
    const result = await this.pool.query(
      `SELECT * FROM user_kyc_status
       WHERE status = 'approved' AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY last_checked DESC`
    );
    return result.rows.map((r) => ({
      user_id: r.user_id,
      anchor_id: r.anchor_id,
      status: r.status as KycStatus,
      last_checked: r.last_checked,
      expires_at: r.expires_at,
      rejection_reason: r.rejection_reason,
      verification_data: r.verification_data,
    }));
  }
}
