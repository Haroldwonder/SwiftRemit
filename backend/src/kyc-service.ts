import axios, { AxiosResponse } from 'axios';
import { KycStatus, DbUserKycStatus, AnchorKycConfig } from './types';
import { getAnchorKycConfigs, getUsersNeedingKycCheck, saveUserKycStatus, getApprovedUsers } from './database';
import { updateKycStatusOnChain } from './stellar';

interface Sep12KycResponse {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  expires_at?: string;
  rejection_reason?: string;
  fields?: any;
}

export class KycService {
  private configs: Map<string, AnchorKycConfig> = new Map();

  async initialize(): Promise<void> {
    const configs = await getAnchorKycConfigs();
    this.configs = new Map(configs.map(config => [config.anchor_id, config]));
    console.log(`Initialized KYC service with ${configs.length} anchor configurations`);
  }

  async pollAllAnchors(): Promise<void> {
    for (const [anchorId, config] of this.configs) {
      try {
        await this.pollAnchorKycStatus(anchorId, config);
      } catch (error) {
        console.error(`Failed to poll KYC status for anchor ${anchorId}:`, error);
      }
    }
  }

  private async pollAnchorKycStatus(anchorId: string, config: AnchorKycConfig): Promise<void> {
    const usersToCheck = await getUsersNeedingKycCheck(anchorId, config.polling_interval_minutes);

    console.log(`Checking KYC status for ${usersToCheck.length} users on anchor ${anchorId}`);

    for (const userKyc of usersToCheck) {
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

          // Update on-chain status if approved
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

        // Rate limiting - wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to check KYC status for user ${userKyc.user_id} on anchor ${anchorId}:`, error);
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