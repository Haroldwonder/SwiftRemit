import crypto from 'crypto';
import { KycRecord, KycStatus, KycLevel } from './types';

export interface AnchorKycConfig {
  anchor_id: string;
  kyc_endpoint: string;
  webhook_secret: string;
}

export class AnchorKycClient {
  constructor(private config: AnchorKycConfig) {}

  /**
   * Fetch KYC statuses for all users from this anchor.
   * Signs the request with x-signature, x-timestamp, x-nonce, x-anchor-id headers.
   */
  async fetchKycStatuses(): Promise<KycRecord[]> {
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const signature = this.computeSignature(timestamp, nonce, this.config.anchor_id);

    const response = await fetch(this.config.kyc_endpoint, {
      method: 'GET',
      headers: {
        'x-signature': signature,
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-anchor-id': this.config.anchor_id,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Anchor KYC endpoint returned ${response.status} for anchor ${this.config.anchor_id}`
      );
    }

    const data = await response.json() as { users?: any[] };
    const users: any[] = data.users ?? (Array.isArray(data) ? data : []);

    return users.map(u => this.parseRecord(u));
  }

  /** HMAC-SHA256 over timestamp + nonce + anchor_id */
  private computeSignature(timestamp: string, nonce: string, anchorId: string): string {
    return crypto
      .createHmac('sha256', this.config.webhook_secret)
      .update(`${timestamp}${nonce}${anchorId}`)
      .digest('hex');
  }

  private parseRecord(raw: any): KycRecord {
    const validStatuses: KycStatus[] = ['pending', 'approved', 'rejected'];
    const kyc_status: KycStatus = validStatuses.includes(raw.kyc_status)
      ? raw.kyc_status
      : (() => { throw new Error(`Unrecognised kyc_status "${raw.kyc_status}" from anchor ${this.config.anchor_id}`); })();

    return {
      user_id: String(raw.user_id),
      anchor_id: this.config.anchor_id,
      kyc_status,
      kyc_level: raw.kyc_level as KycLevel | undefined,
      rejection_reason: raw.rejection_reason,
      verified_at: new Date(raw.verified_at ?? Date.now()),
      expires_at: raw.expires_at ? new Date(raw.expires_at) : undefined,
    };
  }
}
