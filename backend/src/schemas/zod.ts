import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/** Schemas for remittance operations */

export const RemittanceCreateSchema = z
  .object({
    sender: z.string().min(1, 'Sender address required').max(256),
    agent: z.string().min(1, 'Agent address required').max(256),
    amount: z.string().refine((val) => /^\d+(\.\d+)?$/.test(val), {
      message: 'Amount must be a valid number',
    }),
    fee: z.string().refine((val) => /^\d+(\.\d+)?$/.test(val), {
      message: 'Fee must be a valid number',
    }).optional(),
    expiry: z.number().int().positive().optional(),
    memo: z.string().max(100, 'Memo must not exceed 100 characters').optional(),
  })
  .openapi('RemittanceCreate');

export const VerificationRequestSchema = z
  .object({
    assetCode: z
      .string()
      .min(1, 'Asset code required')
      .max(12, 'Asset code must not exceed 12 characters'),
    issuer: z.string().length(56, 'Issuer must be 56 characters'),
  })
  .openapi('VerificationRequest');

export const SettlementSimulationSchema = z
  .object({
    remittanceId: z.number().int().positive('Remittance ID must be positive').optional(),
    amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be valid').optional(),
    asset: z.string().max(12).optional(),
    corridor: z.string().optional(),
  })
  .openapi('SettlementSimulation');

export const AuditLogFilterSchema = z
  .object({
    admin_address: z.string().optional(),
    action: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .openapi('AuditLogFilter');

export const WebhookRotateSecretSchema = z
  .object({})
  .openapi('WebhookRotateSecret');

export type RemittanceCreate = z.infer<typeof RemittanceCreateSchema>;
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;
export type SettlementSimulation = z.infer<typeof SettlementSimulationSchema>;
export type AuditLogFilter = z.infer<typeof AuditLogFilterSchema>;
