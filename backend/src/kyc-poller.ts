import { Pool } from 'pg';
import { AnchorKycClient } from './anchor-kyc-client';
import { KycUpsertService } from './kyc-upsert-service';

export interface PollCycleResult {
  updated: number;
  errors: number;
}

/**
 * Maximum number of KYC entries accepted by a single `batch_set_kyc_approved`
 * invocation. Must match the on-chain contract constant.
 */
export const MAX_KYC_BATCH_SIZE = 50;

/**
 * A single KYC approval/rejection to be submitted on-chain.
 * Tuple layout matches `batch_set_kyc_approved(entries: Vec<(Address, bool, u64)>)`.
 */
export type KycApprovalEntry = [address: string, approved: boolean, timestamp: number];

/**
 * Submits KYC approvals on-chain. Implementations are expected to call the
 * `batch_set_kyc_approved` entry point and throw if the batch is rejected.
 */
export interface KycApprovalSubmitter {
  batchSetKycApproved(entries: KycApprovalEntry[]): Promise<void>;
  setKycApproved(address: string, approved: boolean, timestamp: number): Promise<void>;
}

export class KycPoller {
  constructor(
    private pool: Pool,
    private upsertService: KycUpsertService,
    private delayMs: number = 1000,
    private approvalSubmitter?: KycApprovalSubmitter
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
    const pendingApprovals: KycApprovalEntry[] = [];

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

            if (this.approvalSubmitter && record.address && typeof record.approved === 'boolean') {
              pendingApprovals.push([
                record.address,
                record.approved,
                record.updated_at ? Math.floor(new Date(record.updated_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
              ]);
            }
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

    if (this.approvalSubmitter && pendingApprovals.length > 0) {
      const batchResult = await this.submitApprovals(pendingApprovals);
      errors += batchResult.errors;
    }

    console.log('KYC poll cycle complete', { updated, errors });
    return { updated, errors };
  }

  /**
   * Submit collected approvals in chunks of at most MAX_KYC_BATCH_SIZE.
   * If a batch is rejected, fall back to per-user updates for that chunk.
   */
  private async submitApprovals(
    entries: KycApprovalEntry[]
  ): Promise<{ submitted: number; errors: number }> {
    let submitted = 0;
    let errors = 0;

    for (let i = 0; i < entries.length; i += MAX_KYC_BATCH_SIZE) {
      const chunk = entries.slice(i, i + MAX_KYC_BATCH_SIZE);

      try {
        await this.approvalSubmitter!.batchSetKycApproved(chunk);
        submitted += chunk.length;
      } catch (batchErr) {
        console.warn('KYC batch rejected, falling back to per-user updates', {
          size: chunk.length,
          error: batchErr,
        });

        for (const entry of chunk) {
          try {
            await this.approvalSubmitter!.setKycApproved(entry[0], entry[1], entry[2]);
            submitted++;
          } catch (entryErr) {
            console.warn('KYC per-user update failed', { address: entry[0], error: entryErr });
            errors++;
          }
        }
      }
    }

    return { submitted, errors };
  }
}
