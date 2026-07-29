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

export const SettlementSimulationSchema = z
  .object({
    remittanceId: z.number().int().positive('Remittance ID must be positive').optional(),
    amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be valid').optional(),
    asset: sanitizedString(z.string().max(12)).optional(),
    corridor: sanitizedString(z.string()).optional(),
  })
  .openapi('SettlementSimulation');

export const AuditLogFilterSchema = z
  .object({
    admin_address: sanitizedString(z.string()).optional(),
    action: sanitizedString(z.string()).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .openapi('AuditLogFilter');

export const WebhookRotateSecretSchema = z.object({}).openapi('WebhookRotateSecret');

// ── Inferred types ────────────────────────────────────────────────────────────

export type RemittanceCreate = z.infer<typeof RemittanceCreateSchema>;
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;
export type SettlementSimulation = z.infer<typeof SettlementSimulationSchema>;
export type AuditLogFilter = z.infer<typeof AuditLogFilterSchema>;
