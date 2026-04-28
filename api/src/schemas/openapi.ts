import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// Currency schemas
export const CurrencySchema = z.object({
  code: z.string().min(1).max(12).openapi({ example: 'USD' }),
  symbol: z.string().openapi({ example: '$' }),
  decimal_precision: z.number().int().min(0).max(18).openapi({ example: 2 }),
  name: z.string().optional().openapi({ example: 'US Dollar' }),
}).openapi('Currency');

export const CurrencyResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(CurrencySchema),
  count: z.number().int(),
  timestamp: z.string().datetime(),
}).openapi('CurrencyResponse');

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
  }),
  timestamp: z.string().datetime(),
}).openapi('ErrorResponse');

// Anchor schemas
export const AnchorFeesSchema = z.object({
  deposit_fee_percent: z.number(),
  deposit_fee_fixed: z.number().optional(),
  withdrawal_fee_percent: z.number(),
  withdrawal_fee_fixed: z.number().optional(),
  min_fee: z.number().optional(),
  max_fee: z.number().optional(),
}).openapi('AnchorFees');

export const AnchorLimitsSchema = z.object({
  min_amount: z.number(),
  max_amount: z.number(),
  daily_limit: z.number().optional(),
  monthly_limit: z.number().optional(),
}).openapi('AnchorLimits');

export const AnchorComplianceSchema = z.object({
  kyc_required: z.boolean(),
  kyc_level: z.enum(['basic', 'intermediate', 'advanced']),
  supported_countries: z.array(z.string()),
  restricted_countries: z.array(z.string()),
  documents_required: z.array(z.string()),
}).openapi('AnchorCompliance');

export const AnchorProviderSchema = z.object({
  id: z.string().openapi({ example: 'anchor-1' }),
  name: z.string().openapi({ example: 'Example Anchor' }),
  domain: z.string().openapi({ example: 'anchor.example.com' }),
  logo_url: z.string().url().optional(),
  description: z.string(),
  status: z.enum(['active', 'inactive', 'maintenance']),
  fees: AnchorFeesSchema,
  limits: AnchorLimitsSchema,
  compliance: AnchorComplianceSchema,
  supported_currencies: z.array(z.string()),
  processing_time: z.string().openapi({ example: '1-2 business days' }),
  rating: z.number().min(0).max(5).optional(),
  total_transactions: z.number().int().optional(),
  verified: z.boolean(),
}).openapi('AnchorProvider');

export const AnchorListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(AnchorProviderSchema),
  count: z.number().int(),
  timestamp: z.string().datetime(),
}).openapi('AnchorListResponse');

export const AnchorDetailResponseSchema = z.object({
  success: z.literal(true),
  data: AnchorProviderSchema,
  timestamp: z.string().datetime(),
}).openapi('AnchorDetailResponse');

export const HealthResponseSchema = z.object({
  status: z.string().openapi({ example: 'ok' }),
  timestamp: z.string().datetime(),
  uptime: z.number(),
}).openapi('HealthResponse');
