export enum VerificationStatus {
  Verified = 'verified',
  Unverified = 'unverified',
  Suspicious = 'suspicious',
}

export interface AssetVerification {
  asset_code: string;
  issuer: string;
  status: VerificationStatus;
  reputation_score: number;
  last_verified: Date;
  trustline_count: number;
  has_toml: boolean;
  stellar_expert_verified?: boolean;
  toml_data?: any;
  community_reports?: number;
}

export interface VerificationSource {
  name: string;
  verified: boolean;
  score: number;
  details?: any;
}

export interface VerificationResult {
  asset_code: string;
  issuer: string;
  status: VerificationStatus;
  reputation_score: number;
  sources: VerificationSource[];
  trustline_count: number;
  has_toml: boolean;
}

export interface FxRate {
  transaction_id: string;
  rate: number;
  provider: string;
  timestamp: Date;
  from_currency: string;
  to_currency: string;
}

export interface FxRateRecord {
  id: number;
  transaction_id: string;
  rate: number;
  provider: string;
  timestamp: Date;
  from_currency: string;
  to_currency: string;
  created_at: Date;
}

export type KycStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type KycLevel = 'basic' | 'intermediate' | 'advanced';

export interface KycRecord {
  user_id: string;
  anchor_id: string;
  kyc_status: KycStatus;
  kyc_level?: KycLevel;
  rejection_reason?: string;
  verified_at: Date;
  expires_at?: Date;
}

export interface AnchorKycRecord {
  anchor_id: string;
  kyc_status: KycStatus;
  kyc_level?: KycLevel;
  verified_at: Date;
  expires_at?: Date;
  rejection_reason?: string;
}

export interface UserKycStatus {
  overall_status: KycStatus;
  can_transfer: boolean;
  reason?: string;
  anchors: AnchorKycRecord[];
  last_checked: Date;
}

export interface AnchorKycConfig {
  anchor_id: string;
  kyc_server_url: string;
  auth_token: string;
  polling_interval_minutes: number;
  enabled: boolean;
}

/** Raw database row from user_kyc_status table */
export interface DbUserKycStatus {
  user_id: string;
  anchor_id: string;
  status: KycStatus;
  last_checked: Date;
  expires_at?: Date;
  rejection_reason?: string;
  verification_data?: any;
}
