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
  recipient_name?: string;
  recipient_country?: string;
  recipient_currency?: string;
  anchor_id?: string;
  proof_of_payout_url?: string;
  dispute?: Dispute;
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
  anchorId?: string;
}

// ─── Fee breakdown ────────────────────────────────────────────────────────────

/** A single line item in the fee breakdown returned by the pricing endpoint. */
export interface FeeLineItem {
  amount: string;
  currency: string;
  description?: string;
}

export interface FeeBreakdown {
  sendFee: FeeLineItem;
  fxFee: FeeLineItem;
  payoutFee: FeeLineItem;
  total: FeeLineItem;
  recipientReceives: string;
  recipientCurrency: string;
}

// ─── Payout anchors ───────────────────────────────────────────────────────────

export type AnchorAvailability = 'available' | 'limited' | 'unavailable';

export interface Anchor {
  anchor_id: string;
  name: string;
  country: string;
  currency: string;
  availability: AnchorAvailability;
  settlement_time_hours: number;
  fee_percentage: number;
}

// ─── Receipts ─────────────────────────────────────────────────────────────────

export interface Receipt {
  remittance_id: string;
  sender: string;
  recipient: string;
  amount_sent: string;
  currency_from: string;
  amount_received: string;
  currency_to: string;
  fx_rate: number;
  fees_charged: string;
  transfer_date: string;
  completion_date?: string;
  status: RemittanceStatus;
  proof_of_payout_url?: string;
}

// ─── Disputes ─────────────────────────────────────────────────────────────────

export type DisputeReason =
  | 'funds_not_received'
  | 'incorrect_amount'
  | 'duplicate'
  | 'other';

export type DisputeStatus = 'open' | 'under_investigation' | 'resolved' | 'closed';

export interface Dispute {
  dispute_id: string;
  remittance_id: string;
  reason: DisputeReason;
  status: DisputeStatus;
  description: string;
  resolution?: string;
  created_at: string;
  updated_at: string;
}

// ─── Localisation ─────────────────────────────────────────────────────────────

/** Locales shipped with the app (see src/services/i18n.ts). */
export type AppLocale = 'en-US' | 'es-ES' | 'fr-FR' | 'pt-BR';

// ─── Push notification data (deep-link payload) ───────────────────────────────

/** Typed payload embedded in every push notification's `data` field. */
export type PushNotificationData =
  | { type: 'remittance'; remittanceId: string }
  | { type: 'kyc' };
