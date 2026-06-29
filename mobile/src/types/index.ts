export interface Remittance {
  remittance_id: string;
  sender: string;
  agent: string;
  amount: string;
  fee: string | null;
  currency: string;
  status: RemittanceStatus;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export type RemittanceStatus =
  | 'pending_user_transfer_start'
  | 'pending_external'
  | 'pending_anchor'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'error';

export interface KycStatus {
  user_id: string;
  anchor_id: string;
  kyc_status: 'not_started' | 'pending' | 'approved' | 'denied' | 'expired';
  fields_needed?: string[];
  rejection_reason?: string;
  updated_at: string;
}

export interface FxRate {
  from: string;
  to: string;
  rate: number;
  timestamp: string;
  provider: string;
  cached: boolean;
}

export interface SendMoneyFormData {
  recipientName: string;
  recipientCountry: string;
  recipientCurrency: string;
  amountUSD: string;
  memo: string;
}
