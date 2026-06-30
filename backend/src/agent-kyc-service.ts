import axios from 'axios';
import { upsertAgentKyc, getAgentKyc } from './database';
import { sendEmail } from './email';
import { AgentKycRecord } from './types';

/**
 * SEP-12 anchor config for business KYC.
 * Populated from env vars: SEP12_KYC_SERVER, SEP12_AUTH_TOKEN.
 */
interface Sep12Config {
  kycServer: string;
  authToken: string;
}

function getSep12Config(): Sep12Config | null {
  const kycServer = process.env.SEP12_KYC_SERVER;
  const authToken = process.env.SEP12_AUTH_TOKEN;
  if (!kycServer || !authToken) return null;
  return { kycServer, authToken };
}

/**
 * Push business KYC fields to the SEP-12 anchor (PUT /customer).
 * Returns the SEP-12 customer id assigned by the anchor.
 */
async function sep12PutBusinessCustomer(
  config: Sep12Config,
  record: Partial<AgentKycRecord>
): Promise<string | undefined> {
  const body: Record<string, string> = { type: 'business' };
  if (record.business_registration)
    body.business_registration_number =
      typeof record.business_registration === 'string'
        ? record.business_registration
        : JSON.stringify(record.business_registration);
  if (record.owner_id) body.owner_id = record.owner_id;
  if (record.operating_country) body.country_code = record.operating_country;
  if (record.payout_address) body.payout_address = record.payout_address;
  if (record.contact_email) body.email_address = record.contact_email;

  const response = await axios.put(`${config.kycServer}/customer`, body, {
    headers: { Authorization: `Bearer ${config.authToken}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  return response.data?.id as string | undefined;
}

/**
 * Fetch SEP-12 customer status (GET /customer?id=...).
 * Maps anchor status to internal AgentKycStatus.
 */
async function sep12GetCustomerStatus(
  config: Sep12Config,
  customerId: string
): Promise<{ status: AgentKycRecord['status']; rejectionReason?: string }> {
  const response = await axios.get(`${config.kycServer}/customer`, {
    params: { id: customerId, type: 'business' },
    headers: { Authorization: `Bearer ${config.authToken}` },
    timeout: 15000,
  });

  const sep12Status: string = response.data?.status ?? 'PROCESSING';
  switch (sep12Status.toUpperCase()) {
    case 'ACCEPTED':
      return { status: 'approved' };
    case 'REJECTED':
      return { status: 'rejected', rejectionReason: response.data?.message };
    case 'PROCESSING':
    default:
      return { status: 'under_review' };
  }
}

export class AgentKycService {
  async submitKyc(payload: any): Promise<AgentKycRecord> {
    const record: AgentKycRecord = {
      agent_id: payload.agent_id,
      business_registration: payload.business_registration ?? null,
      owner_id: payload.owner_id ?? null,
      operating_country: payload.operating_country ?? null,
      payout_address: payload.payout_address ?? null,
      contact_email: payload.contact_email ?? null,
      status: 'submitted',
      rejection_reason: undefined,
      submitted_at: payload.submitted_at ?? new Date(),
      reviewed_at: undefined,
    };

    // Push to SEP-12 anchor if configured
    const sep12Config = getSep12Config();
    if (sep12Config) {
      try {
        const customerId = await sep12PutBusinessCustomer(sep12Config, record);
        if (customerId) {
          (record as any).sep12_customer_id = customerId;
          // Anchor accepted the submission; treat as under_review immediately
          record.status = 'under_review';
        }
      } catch (err) {
        console.error('SEP-12 PUT /customer failed:', err);
        // Non-fatal: record is still saved locally as 'submitted'
      }
    }

    await upsertAgentKyc(record);

    if (record.contact_email) {
      await sendEmail(
        record.contact_email,
        'Agent KYC submitted',
        `Your agent KYC for ${record.agent_id} has been received and is pending review.`
      );
    }

    return record;
  }

  async getKyc(agentId: string): Promise<AgentKycRecord | null> {
    return await getAgentKyc(agentId);
  }

  /**
   * Poll the SEP-12 anchor for the current status of a pending/under_review agent
   * and sync it back to the local DB.
   */
  async syncSep12Status(agentId: string): Promise<AgentKycRecord | null> {
    const existing = await getAgentKyc(agentId);
    if (!existing) return null;

    const customerId = (existing as any).sep12_customer_id;
    const sep12Config = getSep12Config();
    if (!sep12Config || !customerId) return existing;

    try {
      const { status, rejectionReason } = await sep12GetCustomerStatus(sep12Config, customerId);
      if (status !== existing.status) {
        await this.reviewKyc(agentId, status as any, rejectionReason);
        return await getAgentKyc(agentId);
      }
    } catch (err) {
      console.error(`SEP-12 GET /customer failed for ${agentId}:`, err);
    }

    return existing;
  }

  async reviewKyc(
    agentId: string,
    status: 'under_review' | 'approved' | 'rejected',
    rejectionReason?: string
  ): Promise<AgentKycRecord> {
    const existing = await getAgentKyc(agentId);
    if (!existing) throw new Error('Agent KYC not found');

    const updated: AgentKycRecord = {
      ...existing,
      status,
      rejection_reason: rejectionReason ?? undefined,
      reviewed_at: new Date(),
    };

    await upsertAgentKyc(updated);

    if (updated.contact_email) {
      const subjects: Record<string, string> = {
        approved: 'Agent KYC approved',
        rejected: 'Agent KYC rejected',
        under_review: 'Agent KYC under review',
      };
      const bodies: Record<string, string> = {
        approved: `Congratulations — your agent KYC for ${agentId} has been approved. You may now register on-chain.`,
        rejected: `Your agent KYC for ${agentId} was rejected. Reason: ${rejectionReason ?? 'Not provided'}`,
        under_review: `Your agent KYC for ${agentId} is under review.`,
      };
      await sendEmail(updated.contact_email, subjects[status], bodies[status]);
    }

    return updated;
  }
}
