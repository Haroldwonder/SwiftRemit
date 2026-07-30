import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import {
  sanitizeForJson,
  sanitizeOnChainMemo,
} from '../../../shared/src/sanitizer';

extendZodWithOpenApi(z);

/**
 * Sanitization is applied at the schema layer via .transform() so every
 * path that parses user input (route handlers, background jobs, tests)
 * automatically gets clean values.  A field added to a schema without a
 * sanitize transform will fail the schema-level test in sanitizer.test.ts.
 */

// ── Reusable sanitized primitives ─────────────────────────────────────────────

/**
 * A free-text string that is sanitized for JSON/storage contexts.
 * Strips all HTML tags and encodes residual angle-bracket characters.
 */
const sanitizedString = (base: z.ZodString) =>
  base.transform((v) => sanitizeForJson(v));

// ── Schemas ───────────────────────────────────────────────────────────────────

export const RemittanceCreateSchema = z
  .object({
    sender: sanitizedString(z.string().min(1, 'Sender address required').max(256)),
    agent: sanitizedString(z.string().min(1, 'Agent address required').max(256)),
    amount: z.string().refine((val) => /^\d+(\.\d+)?$/.test(val), {
      message: 'Amount must be a valid number',
    }),
    fee: z
      .string()
      .refine((val) => /^\d+(\.\d+)?$/.test(val), {
        message: 'Fee must be a valid number',
      })
      .optional(),
    expiry: z.number().int().positive().optional(),
    /**
     * Memo is sanitized via sanitizeOnChainMemo so the same value is safe
     * both for the database and for writing on-chain via Stellar.
     * Max 28 bytes enforced after sanitization (Stellar text memo limit).
     */
    memo: z
      .string()
      .max(100, 'Memo must not exceed 100 characters')
      .transform((v) => sanitizeOnChainMemo(v))
      .optional(),
  })
  .openapi('RemittanceCreate');

export const RemittanceIdParamSchema = z.object({
  remittanceId: z.string().min(1, 'remittanceId is required').max(100),
});

export const RemittanceGetQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Asset verification schemas
// ---------------------------------------------------------------------------

export const VerificationRequestSchema = z
  .object({
    assetCode: sanitizedString(
      z
        .string()
        .min(1, 'Asset code required')
        .max(12, 'Asset code must not exceed 12 characters'),
    ),
    issuer: sanitizedString(z.string().length(56, 'Issuer must be 56 characters')),
  })
  .openapi('VerificationRequest');

export const VerificationAssetParamSchema = z.object({
  assetCode: z.string().min(1).max(12),
  issuer: stellarAddress('issuer'),
});

export const VerificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const ReportAssetSchema = z.object({
  assetCode: z.string().min(1).max(12),
  issuer: stellarAddress('issuer'),
  reason: z.string().min(1).max(500, 'Reason must not exceed 500 characters'),
});

export const BatchVerificationSchema = z.object({
  assets: z
    .array(
      z.object({
        assetCode: z.string().min(1).max(12),
        issuer: stellarAddress('issuer'),
      })
    )
    .min(1, 'At least one asset required')
    .max(50, 'Maximum 50 assets per batch'),
});

// ---------------------------------------------------------------------------
// Settlement simulation schema
// ---------------------------------------------------------------------------

export const SettlementSimulationSchema = z
  .object({
    remittanceId: z.number().int().positive('Remittance ID must be positive').optional(),
    amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be valid').optional(),
    asset: sanitizedString(z.string().max(12)).optional(),
    corridor: sanitizedString(z.string()).optional(),
  })
  .openapi('SettlementSimulation');

export const SimulateSettlementBodySchema = z.object({
  remittanceId: z
    .number({ required_error: 'remittanceId is required' })
    .int('remittanceId must be an integer')
    .positive('remittanceId must be a positive integer'),
});

// ---------------------------------------------------------------------------
// FX rate schemas
// ---------------------------------------------------------------------------

export const FxRateStoreSchema = z.object({
  transactionId: z.string().min(1).max(100),
  rate: z.number().positive('Rate must be positive'),
  provider: z.string().min(1).max(100),
  fromCurrency: z.string().min(1).max(10).toUpperCase(),
  toCurrency: z.string().min(1).max(10).toUpperCase(),
});

export const FxRateTransactionParamSchema = z.object({
  transactionId: z.string().min(1).max(100),
});

export const FxRateCurrentQuerySchema = z.object({
  from: z.string().min(1).max(10),
  to: z.string().min(1).max(10),
});

// ---------------------------------------------------------------------------
// KYC schemas
// ---------------------------------------------------------------------------

export const KycConfigSchema = z.object({
  anchorId: z.string().min(1).max(100),
  kycServerUrl: z.string().url('kycServerUrl must be a valid URL'),
  authToken: z.string().min(1).max(500),
  pollingIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  enabled: z.boolean().optional(),
});

export const KycStatusParamSchema = z.object({
  userId: z.string().min(1).max(255),
  anchorId: z.string().min(1).max(100),
});

export const KycUserParamSchema = z.object({
  userId: z.string().min(1).max(255),
});

export const KycRegisterSchema = z.object({
  userId: z.string().min(1).max(255),
  anchorId: z.string().min(1).max(100),
});

// ---------------------------------------------------------------------------
// SEP-24 schemas
// ---------------------------------------------------------------------------

export const Sep24InitiateSchema = z.object({
  user_id: z.string().min(1).max(255),
  anchor_id: z.string().min(1).max(100),
  direction: z.enum(['deposit', 'withdrawal'], {
    errorMap: () => ({ message: 'direction must be "deposit" or "withdrawal"' }),
  }),
  asset_code: z.string().min(1).max(12),
  amount: positiveIntegerAmount('amount'),
  user_address: stellarAddress('user_address').optional(),
  user_email: z.string().email('Invalid email address').max(255).optional(),
});

export const Sep24TransactionParamSchema = z.object({
  transactionId: z.string().min(1).max(255),
});

// ---------------------------------------------------------------------------
// Webhook schemas
// ---------------------------------------------------------------------------

export const WebhookRotateSecretSchema = z
  .object({})
  .openapi('WebhookRotateSecret');

export const WebhookSubscriberParamSchema = z.object({
  id: uuidParam,
});

// ---------------------------------------------------------------------------
// Audit log schemas
// ---------------------------------------------------------------------------

export const AuditLogFilterSchema = z
  .object({
    admin_address: sanitizedString(z.string()).optional(),
    action: sanitizedString(z.string()).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    cursor: z.string().optional(),
  })
  .openapi('AuditLogFilter');

export const WebhookRotateSecretSchema = z.object({}).openapi('WebhookRotateSecret');

// ── Inferred types ────────────────────────────────────────────────────────────

export type RemittanceCreate = z.infer<typeof RemittanceCreateSchema>;
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;
export type SettlementSimulation = z.infer<typeof SettlementSimulationSchema>;
export type AuditLogFilter = z.infer<typeof AuditLogFilterSchema>;
export type AuditLogExportQuery = z.infer<typeof AuditLogExportQuerySchema>;
export type Sep24Initiate = z.infer<typeof Sep24InitiateSchema>;
