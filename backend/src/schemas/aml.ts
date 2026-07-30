/**
 * SR-112 — request schemas for the AML/CTF endpoints.
 *
 * Kept separate from schemas/zod.ts so the compliance surface can be reviewed
 * as a unit, which is what an examiner or auditor will ask for.
 */

import { z } from 'zod';

const SubjectTypeEnum = z.enum(['sender', 'recipient', 'agent']);
const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);

// Mirrors ALERT_STATUSES / ALERT_DISPOSITIONS in ../aml/types — kept as literals
// here so the wire contract is readable at the schema definition.
const AlertStatusEnum = z.enum([
  'open',
  'in_review',
  'closed_no_action',
  'escalated',
  'reported',
]);
const AlertDispositionEnum = z.enum([
  'false_positive',
  'true_positive',
  'duplicate',
  'insufficient_data',
]);
const SarStatusEnum = z.enum(['draft', 'under_review', 'filed', 'acknowledged', 'withdrawn']);

// ─── Screening ──────────────────────────────────────────────────────────────

export const ScreenSubjectSchema = z.object({
  subject_type: SubjectTypeEnum,
  subject_id: z.string().min(1).max(255),
  name: z.string().min(2).max(400),
  country: z.string().min(2).max(80).optional(),
  date_of_birth: z.string().max(20).optional(),
  trigger: z.enum(['onboarding', 'periodic', 'manual', 'transaction']).default('onboarding'),
});

export const ScreeningSubjectParamSchema = z.object({
  subjectType: SubjectTypeEnum,
  subjectId: z.string().min(1).max(255),
});

export const RescreenQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

// ─── Alerts ─────────────────────────────────────────────────────────────────

export const AlertListQuerySchema = z.object({
  status: AlertStatusEnum.optional(),
  severity: SeverityEnum.optional(),
  rule_code: z.string().max(60).optional(),
  subject_id: z.string().max(255).optional(),
  assigned_to: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const AlertIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const AlertDispositionSchema = z.object({
  status: AlertStatusEnum,
  disposition: AlertDispositionEnum.optional(),
  notes: z.string().max(4000).optional(),
  assigned_to: z.string().max(255).optional(),
});

// ─── Monitoring ─────────────────────────────────────────────────────────────

export const EvaluateTransferSchema = z.object({
  transaction_id: z.string().min(1).max(255),
  sender_address: z.string().min(1).max(56),
  amount: z.coerce.number().positive(),
  currency: z.string().min(2).max(10),
  corridor: z.string().max(20).optional(),
  created_at: z.string().datetime().optional(),
});

export const RuleCodeParamSchema = z.object({
  code: z.string().min(1).max(60),
});

export const RuleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  severity: SeverityEnum.optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).refine(
  (v) => v.enabled !== undefined || v.severity !== undefined || v.params !== undefined,
  { message: 'At least one of enabled, severity, or params must be provided' },
);

// ─── SAR ────────────────────────────────────────────────────────────────────

export const SarCreateSchema = z.object({
  jurisdiction: z.string().min(2).max(10),
  subject_type: SubjectTypeEnum.default('sender'),
  subject_id: z.string().min(1).max(255),
  alert_ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
  narrative: z.string().min(120).max(20000),
  currency: z.string().min(2).max(10).optional(),
});

export const SarListQuerySchema = z.object({
  status: SarStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const SarIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const SarTransitionSchema = z.object({
  status: SarStatusEnum,
  notes: z.string().max(4000).optional(),
  external_reference: z.string().max(120).optional(),
});

// ─── Travel rule ────────────────────────────────────────────────────────────

const OriginatorSchema = z.object({
  name: z.string().min(1).max(400),
  account_identifier: z.string().min(1).max(255),
  address: z.string().max(500).optional(),
  national_identifier: z.string().max(120).optional(),
  date_of_birth: z.string().max(20).optional(),
  place_of_birth: z.string().max(200).optional(),
  country: z.string().max(80).optional(),
});

const BeneficiarySchema = z.object({
  name: z.string().min(1).max(400),
  account_identifier: z.string().min(1).max(255),
  country: z.string().max(80).optional(),
});

export const TravelRuleRecordSchema = z.object({
  transaction_id: z.string().min(1).max(255),
  jurisdiction: z.string().min(2).max(10),
  amount: z.coerce.number().positive(),
  currency: z.string().min(2).max(10),
  amount_usd: z.coerce.number().nonnegative(),
  originator: OriginatorSchema.optional(),
  beneficiary: BeneficiarySchema.optional(),
  counterparty_vasp: z.string().max(255).optional(),
});

export const TravelRuleTransactionParamSchema = z.object({
  transactionId: z.string().min(1).max(255),
});

// ─── Retention ──────────────────────────────────────────────────────────────

export const RetentionEnforceSchema = z.object({
  entity: z.string().max(80).optional(),
});

export type ScreenSubjectRequest = z.infer<typeof ScreenSubjectSchema>;
export type AlertDispositionRequest = z.infer<typeof AlertDispositionSchema>;
export type SarCreateRequest = z.infer<typeof SarCreateSchema>;
export type TravelRuleRecordRequest = z.infer<typeof TravelRuleRecordSchema>;
