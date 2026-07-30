import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { StrKey } from '@stellar/stellar-sdk';

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Stellar address validation using the official StrKey library.
// Rejects any value that is not a valid ed25519 public key on the Stellar
// network — regex-only checks are insufficient because they cannot validate
// the embedded checksum.
// ---------------------------------------------------------------------------
const stellarAddress = (fieldName = 'address') =>
  z
    .string()
    .length(56, `${fieldName} must be exactly 56 characters`)
    .refine((val) => StrKey.isValidEd25519PublicKey(val), {
      message: `${fieldName} must be a valid Stellar public key (G…)`,
    });

// ---------------------------------------------------------------------------
// Amount validation.
//  - Positive integer string only (no scientific notation, no floats).
//  - Upper bound of 10^15 stroops — far above any realistic transfer.
//  - Rejects "1e5", "1.5", "0", "-1", etc.
// ---------------------------------------------------------------------------
const MAX_AMOUNT = BigInt('1000000000000000'); // 10^15

const positiveIntegerAmount = (fieldName = 'amount') =>
  z
    .string()
    .regex(/^\d+$/, `${fieldName} must be a positive integer (no decimals or scientific notation)`)
    .refine((val) => BigInt(val) > BigInt(0), {
      message: `${fieldName} must be greater than zero`,
    })
    .refine((val) => BigInt(val) <= MAX_AMOUNT, {
      message: `${fieldName} exceeds maximum allowed value (${MAX_AMOUNT.toString()})`,
    });

// ---------------------------------------------------------------------------
// UUID parameter (webhook subscriber IDs)
// ---------------------------------------------------------------------------
const uuidParam = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Must be a valid UUID'
  );

// ---------------------------------------------------------------------------
// Remittance schemas
// ---------------------------------------------------------------------------

export const RemittanceCreateSchema = z
  .object({
    sender: stellarAddress('sender'),
    agent: stellarAddress('agent'),
    amount: positiveIntegerAmount('amount'),
    fee: positiveIntegerAmount('fee').optional(),
    expiry: z.number().int().positive().optional(),
    memo: z.string().max(100, 'Memo must not exceed 100 characters').optional(),
    fromCurrency: z.string().min(1).max(10).toUpperCase().optional(),
    toCurrency: z.string().min(1).max(10).toUpperCase().optional(),
    fxRateMaxStalenessSeconds: z.number().int().min(0).optional(),
    from_currency: z.string().min(1).max(10).toUpperCase().optional(),
    to_currency: z.string().min(1).max(10).toUpperCase().optional(),
    fx_rate_max_staleness_seconds: z.number().int().min(0).optional(),
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
    assetCode: z
      .string()
      .min(1, 'Asset code required')
      .max(12, 'Asset code must not exceed 12 characters'),
    issuer: stellarAddress('issuer'),
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
    amount: z.string().regex(/^\d+$/, 'Amount must be a positive integer').optional(),
    asset: z.string().max(12).optional(),
    corridor: z.string().optional(),
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

export const ProofOfPayoutValidationSchema = z.object({
  fileBase64: z.string().min(1).max(14_000_000),
  declaredType: z.enum(['image/png', 'image/jpeg', 'application/pdf']),
  proofHash: z.string().regex(/^[a-f0-9]{64}$/i),
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
    admin_address: z.string().optional(),
    action: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    cursor: z.string().optional(),
  })
  .openapi('AuditLogFilter');

// Max date range span for exports: 90 days
export const AUDIT_LOG_EXPORT_MAX_DAYS = 90;
export const AUDIT_LOG_EXPORT_ROW_CAP = 100_000;
export const AUDIT_LOG_PAGE_SIZE = 200;

export const AuditLogExportQuerySchema = z
  .object({
    admin_address: z.string().optional(),
    action: z.string().optional(),
    from: z
      .string({ required_error: 'from is required for export' })
      .datetime('from must be an ISO-8601 datetime'),
    to: z
      .string({ required_error: 'to is required for export' })
      .datetime('to must be an ISO-8601 datetime'),
  })
  .refine(
    (data) => {
      const fromMs = new Date(data.from).getTime();
      const toMs = new Date(data.to).getTime();
      return toMs > fromMs;
    },
    { message: 'to must be after from', path: ['to'] }
  )
  .refine(
    (data) => {
      const fromMs = new Date(data.from).getTime();
      const toMs = new Date(data.to).getTime();
      const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24);
      return diffDays <= AUDIT_LOG_EXPORT_MAX_DAYS;
    },
    {
      message: `Date range must not exceed ${AUDIT_LOG_EXPORT_MAX_DAYS} days. Narrow the range or paginate exports.`,
      path: ['from'],
    }
  );

export const AuditLogListQuerySchema = z.object({
  admin_address: z.string().optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Contract events query
// ---------------------------------------------------------------------------

export const ContractEventsQuerySchema = z.object({
  event_type: z.string().max(50).optional(),
  actor: z.string().max(56).optional(),
  remittance_id: z.coerce.number().int().positive().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type RemittanceCreate = z.infer<typeof RemittanceCreateSchema>;
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;
export type SettlementSimulation = z.infer<typeof SettlementSimulationSchema>;
export type AuditLogFilter = z.infer<typeof AuditLogFilterSchema>;
export type AuditLogExportQuery = z.infer<typeof AuditLogExportQuerySchema>;
export type Sep24Initiate = z.infer<typeof Sep24InitiateSchema>;
