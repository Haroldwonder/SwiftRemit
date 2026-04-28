import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// Common schemas
export const ErrorResponseSchema = z.object({
  error: z.string(),
}).openapi('ErrorResponse');

export const SuccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
}).openapi('SuccessResponse');

// Asset Verification schemas
export const VerificationStatusSchema = z.enum(['verified', 'unverified', 'suspicious']).openapi('VerificationStatus');

export const AssetVerificationSchema = z.object({
  asset_code: z.string().max(12).openapi({ example: 'USDC' }),
  issuer: z.string().length(56).openapi({ example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' }),
  status: VerificationStatusSchema,
  reputation_score: z.number().int().min(0).max(100),
  last_verified: z.string().datetime(),
  trustline_count: z.number().int(),
  has_toml: z.boolean(),
  stellar_expert_verified: z.boolean().optional(),
  toml_data: z.any().optional(),
  community_reports: z.number().int().optional(),
}).openapi('AssetVerification');

export const VerifyAssetRequestSchema = z.object({
  assetCode: z.string().max(12),
  issuer: z.string().length(56),
}).openapi('VerifyAssetRequest');

export const ReportAssetRequestSchema = z.object({
  assetCode: z.string().max(12),
  issuer: z.string().length(56),
  reason: z.string().max(500),
}).openapi('ReportAssetRequest');

export const BatchVerificationRequestSchema = z.object({
  assets: z.array(z.object({
    assetCode: z.string().max(12),
    issuer: z.string().length(56),
  })).min(1).max(50),
}).openapi('BatchVerificationRequest');

export const BatchVerificationResponseSchema = z.object({
  results: z.array(z.object({
    assetCode: z.string(),
    issuer: z.string(),
    verification: AssetVerificationSchema.nullable(),
    error: z.string().optional(),
  })),
}).openapi('BatchVerificationResponse');

// KYC schemas
export const KycStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired']).openapi('KycStatus');
export const KycLevelSchema = z.enum(['basic', 'intermediate', 'advanced']).openapi('KycLevel');

export const AnchorKycRecordSchema = z.object({
  anchor_id: z.string(),
  kyc_status: KycStatusSchema,
  kyc_level: KycLevelSchema.optional(),
  verified_at: z.string().datetime(),
  expires_at: z.string().datetime().optional(),
  rejection_reason: z.string().optional(),
}).openapi('AnchorKycRecord');

export const UserKycStatusSchema = z.object({
  can_transfer: z.boolean(),
  reason: z.string().optional(),
  anchors: z.array(AnchorKycRecordSchema),
}).openapi('UserKycStatus');

// FX Rate schemas
export const FxRateRequestSchema = z.object({
  transactionId: z.string(),
  rate: z.number().positive(),
  provider: z.string(),
  fromCurrency: z.string(),
  toCurrency: z.string(),
}).openapi('FxRateRequest');

export const FxRateRecordSchema = z.object({
  id: z.number().int(),
  transaction_id: z.string(),
  rate: z.number(),
  provider: z.string(),
  timestamp: z.string().datetime(),
  from_currency: z.string(),
  to_currency: z.string(),
  created_at: z.string().datetime(),
}).openapi('FxRateRecord');

// Webhook schemas
export const WebhookEventSchema = z.object({
  event_type: z.string().openapi({ example: 'transaction.completed' }),
  transaction_id: z.string(),
  timestamp: z.string().datetime(),
  data: z.any(),
}).openapi('WebhookEvent');

export const WebhookResponseSchema = z.object({
  received: z.boolean(),
  webhook_id: z.string(),
}).openapi('WebhookResponse');

// Health check schema
export const HealthResponseSchema = z.object({
  status: z.string().openapi({ example: 'ok' }),
  timestamp: z.string().datetime(),
}).openapi('HealthResponse');
