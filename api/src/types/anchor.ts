export interface AnchorProvider {
  id: string;
  name: string;
  domain: string;
  logo_url?: string;
  description: string;
  status: 'active' | 'inactive' | 'maintenance';
  
  // Fee structure
  fees: {
    deposit_fee_percent: number;
    deposit_fee_fixed?: number;
    withdrawal_fee_percent: number;
    withdrawal_fee_fixed?: number;
    min_fee?: number;
    max_fee?: number;
  };
  
  // Transaction limits
  limits: {
    min_amount: number;
    max_amount: number;
    daily_limit?: number;
    monthly_limit?: number;
  };
  
  // Compliance requirements
  compliance: {
    kyc_required: boolean;
    kyc_level: 'basic' | 'intermediate' | 'advanced';
    supported_countries: string[];
    restricted_countries: string[];
    documents_required: string[];
  };
  
  // Additional info
  supported_currencies: string[];
  processing_time: string;
  rating?: number;
  total_transactions?: number;
  verified: boolean;
}

export interface AnchorListResponse {
  success: boolean;
  data: AnchorProvider[];
  count: number;
  timestamp: string;
}

export interface AnchorDetailResponse {
  success: boolean;
  data: AnchorProvider;
  timestamp: string;
}
