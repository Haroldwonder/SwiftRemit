import { Pool } from 'pg';
import { AnchorKycClient } from './anchor-kyc-client';
import { KycUpsertService } from './kyc-upsert-service';

export interface PollCycleResult {
  updated: number;
  errors: number;
}

export class KycPoller {
  constructor(
    private pool: Pool,
    private upsertService: KycUpsertService,
    private delayMs: number = 1000
  ) {}

  /**
   * Run one full poll cycle across all enabled anchors that have a kyc_endpoint configured.
   */
  async runCycle(): Promise<PollCycleResult> {
    const result = await this.pool.query<{
      id: string;
      kyc_endpoint: string;
      webhook_secret: string;
    }>(
      `SELECT id, kyc_endpoint, webhook_secret
       FROM anchors
       WHERE enabled = true AND kyc_endpoint IS NOT NULL`
    );

    const anchors = result.rows;
    let updated = 0;
    let errors = 0;

    for (const anchor of anchors) {
      try {
        const client = new AnchorKycClient({
          anchor_id: anchor.id,
          kyc_endpoint: anchor.kyc_endpoint,
          webhook_secret: anchor.webhook_secret ?? '',
        });

        const records = await client.fetchKycStatuses();

        for (const record of records) {
          try {
            await this.upsertService.upsert(record);
            updated++;
          } catch (recordErr) {
            console.warn('Skipping invalid KYC record', { anchor_id: anchor.id, error: recordErr });
            errors++;
          }
        }
      } catch (anchorErr) {
        console.error('KYC poll failed for anchor', { anchor_id: anchor.id, error: anchorErr });
        errors++;
      }

      // Rate-limit between anchor calls
      if (this.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
    }

    console.log('KYC poll cycle complete', { updated, errors });
    return { updated, errors };
  }
}
