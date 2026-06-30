import axios, { AxiosResponse } from 'axios';
import { KycStatus, DbUserKycStatus, AnchorKycConfig } from './types';
import { getAnchorKycConfigs, getUsersNeedingKycCheck, saveUserKycStatus, getApprovedUsers, getPool, saveAnchorPollFailure } from './database';
import { getMetricsService } from './metrics';
import { updateKycStatusOnChain } from './stellar';

interface Sep12KycResponse {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  expires_at?: string;
  rejection_reason?: string;
  fields?: any;
}

const DEFAULT_INTER_REQUEST_DELAY_MS = 1000;
const MAX_BACKOFF_MS = 32000;
const BACKOFF_MULTIPLIER = 2;

/** Returns a promise that resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff delay with jitter.
 * @param attempt - zero-based retry attempt number
 * @param baseDelayMs - the base delay for this anchor
 */
function calcBackoff(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(BACKOFF_MULTIPLIER, attempt);
  const capped = Math.min(exponential, MAX_BACKOFF_MS);
  // Add ±10% jitter to avoid thundering herd
  const jitter = capped * 0.1 * (Math.random() * 2 - 1);
  return Math.round(capped + jitter);
}

export class KycService {
  private configs: Map<string, AnchorKycConfig> = new Map();
  private metricsService = getMetricsService(getPool());

  async initialize(): Promise<void> {
    const configs = await getAnchorKycConfigs();
    this.configs = new Map(configs.map(config => [config.anchor_id, config]));
    console.log(`Initialized KYC service with ${configs.length} anchor configurations`);
  }

  async pollAllAnchors(): Promise<void> {
    this.metricsService.recordKycPollerRun();

    for (const [anchorId, config] of this.configs) {
      try {
        await this.pollAnchorKycStatus(anchorId, config);
      } catch (error) {
        this.metricsService.recordKycPollFailure();
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to poll KYC status for anchor ${anchorId}:`, error);
        await saveAnchorPollFailure({ anchor_id: anchorId, error_message: errorMessage }).catch(() => {});
      }
    }
  }

  private async pollAnchorKycStatus(anchorId: string, config: AnchorKycConfig): Promise<void> {
    const usersToCheck = await getUsersNeedingKycCheck(anchorId, config.polling_interval_minutes);
    const baseDelayMs = config.inter_request_delay_ms ?? DEFAULT_INTER_REQUEST_DELAY_MS;

    console.log(`Checking KYC status for ${usersToCheck.length} users on anchor ${anchorId} (base delay: ${baseDelayMs}ms)`);

    for (const userKyc of usersToCheck) {
      let attempt = 0;
      let success = false;

      while (!success) {
        try {
          const kycResponse = await this.queryAnchorKycStatus(config, userKyc.user_id);

          if (kycResponse) {
            const updatedStatus: DbUserKycStatus = {
              ...userKyc,
              status: this.mapSep12StatusToInternal(kycResponse.status),
              last_checked: new Date(),
              expires_at: kycResponse.expires_at ? new Date(kycResponse.expires_at) : undefined,
              rejection_reason: kycResponse.rejection_reason,
              verification_data: kycResponse.fields,
            };

            await saveUserKycStatus(updatedStatus);

            // Update on-chain status if approved or rejected
            if (updatedStatus.status === 'approved') {
              try {
                await updateKycStatusOnChain(userKyc.user_id, true);
              } catch (error) {
                console.error(`Failed to update on-chain KYC status for user ${userKyc.user_id}:`, error);
              }
            } else if (updatedStatus.status === 'rejected') {
              try {
                await updateKycStatusOnChain(userKyc.user_id, false);
              } catch (error) {
                console.error(`Failed to update on-chain KYC status for user ${userKyc.user_id}:`, error);
              }
            }
          }

          success = true;

          // Configurable inter-request delay (adaptive: reset after a successful request)
          await sleep(baseDelayMs);
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 429) {
            attempt++;
            const retryAfterHeader = error.response.headers['retry-after'];
            const retryAfterMs = retryAfterHeader
              ? parseInt(retryAfterHeader, 10) * 1000
              : calcBackoff(attempt, baseDelayMs);

            console.warn(
              `Rate limited (429) by anchor ${anchorId} for user ${userKyc.user_id}. ` +
              `Retrying in ${retryAfterMs}ms (attempt ${attempt})...`
            );
            await sleep(retryAfterMs);
          } else {
            console.error(`Failed to check KYC status for user ${userKyc.user_id} on anchor ${anchorId}:`, error);
            success = true; // Don't retry on non-429 errors; move to next user
          }
        }
      }
    }
  }

  private async queryAnchorKycStatus(config: AnchorKycConfig, userId: string): Promise<Sep12KycResponse | null> {
    try {
      const url = `${config.kyc_server_url}/customer/${userId}`;
      const response: AxiosResponse<Sep12KycResponse> = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${config.auth_token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          // User not found in anchor's system
          return null;
        }
        if (error.response?.status === 429) {
          // Re-throw so the caller can apply exponential backoff
          throw error;
        }
        console.error(`HTTP error querying KYC status: ${error.response?.status} ${error.response?.statusText}`);
      } else {
        console.error('Error querying KYC status:', error);
      }
      return null;
    }
  }

  private mapSep12StatusToInternal(sep12Status: string): KycStatus {
    switch (sep12Status.toLowerCase()) {
      case 'approved':
        return 'approved';
      case 'rejected':
        return 'rejected';
      case 'pending':
      default:
        return 'pending';
    }
  }

  async getUserKycStatus(userId: string, anchorId: string): Promise<DbUserKycStatus | null> {
    return await import('./database').then(db => db.getUserKycStatus(userId, anchorId));
  }

  async isUserKycApproved(userId: string): Promise<boolean> {
    // Check if user has approved KYC with any anchor
    const approvedUsers = await getApprovedUsers();
    return approvedUsers.some(user => user.user_id === userId);
  }

  async registerUserForKyc(userId: string, anchorId: string): Promise<void> {
    const initialStatus: DbUserKycStatus = {
      user_id: userId,
      anchor_id: anchorId,
      status: 'pending',
      last_checked: new Date(),
    };

    await saveUserKycStatus(initialStatus);
  }
}