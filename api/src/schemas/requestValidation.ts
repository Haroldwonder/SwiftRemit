import Joi from 'joi';
import {
  sanitizeForJson,
  sanitizeOnChainMemo,
} from '../../../shared/src/sanitizer';

/**
 * Sanitization is applied at the Joi validation layer via .custom() so every
 * path through the API service that parses user input automatically receives
 * clean, encoded values before they reach route handlers or the database.
 *
 * Convention: wrap every free-text field with sanitizedString() or
 * sanitizedMemo() — the schema-level test in sanitizer.test.ts will catch
 * any field added without a sanitizer transform.
 */

// ── Sanitized Joi primitives ──────────────────────────────────────────────────

/**
 * Apply JSON-context sanitization to any Joi string schema.
 * Strips all HTML tags and encodes residual angle-bracket characters.
 */
function sanitizedString(base: Joi.StringSchema): Joi.StringSchema {
  return base.custom((value: string) => sanitizeForJson(value), 'xss-sanitize');
}

/**
 * Apply on-chain memo sanitization: strips HTML, removes control characters,
 * and truncates to 28 UTF-8 bytes (Stellar text memo limit).
 */
function sanitizedMemo(base: Joi.StringSchema): Joi.StringSchema {
  return base.custom((value: string) => sanitizeOnChainMemo(value), 'memo-sanitize');
}

// ── Field schemas ─────────────────────────────────────────────────────────────

/**
 * Stellar public key validation pattern
 * Format: G followed by 55 alphanumeric characters (56 total)
 */
const STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{54}$/;

/**
 * Validate a Stellar public key address.
 * Stellar addresses are base32 encoded — no HTML is possible — but we
 * sanitize anyway to guard against future format relaxation.
 */
export const stellarAddressSchema = sanitizedString(
  Joi.string()
    .pattern(STELLAR_ADDRESS_PATTERN)
    .required()
    .messages({
      'string.pattern.base': 'agent must be a valid Stellar public key (G... format, 56 chars)',
      'any.required': 'agent is required',
    }),
);

/**
 * Validate fee basis points (0–10000).
 * Numeric — no sanitization needed; type coercion is the guard here.
 */
export const feeBpsSchema = Joi.number()
  .integer()
  .min(0)
  .max(10000)
  .required()
  .messages({
    'number.base': 'fee_bps must be an integer',
    'number.min': 'fee_bps must be at least 0',
    'number.max': 'fee_bps must not exceed 10000',
    'any.required': 'fee_bps is required',
  });

/**
 * Validate positive integer amounts.
 * Numeric — no sanitization needed.
 */
export const positiveAmountSchema = Joi.number()
  .integer()
  .positive()
  .required()
  .messages({
    'number.base': 'amount must be a number',
    'number.positive': 'amount must be greater than 0',
    'any.required': 'amount is required',
  });

/**
 * Validate currency code (ISO 4217, 3 uppercase letters).
 * Allowlist pattern — sanitization is defence-in-depth.
 */
export const currencyCodeSchema = sanitizedString(
  Joi.string()
    .length(3)
    .uppercase()
    .pattern(/^[A-Z]{3}$/)
    .required()
    .messages({
      'string.length': 'currency must be exactly 3 characters',
      'string.pattern.base': 'currency must be 3 uppercase letters (ISO 4217)',
      'any.required': 'currency is required',
    }),
);

/**
 * Validate country code (ISO 3166-1 alpha-2, 2 uppercase letters).
 */
export const countryCodeSchema = sanitizedString(
  Joi.string()
    .length(2)
    .uppercase()
    .pattern(/^[A-Z]{2}$/)
    .required()
    .messages({
      'string.length': 'country must be exactly 2 characters',
      'string.pattern.base': 'country must be 2 uppercase letters (ISO 3166-1 alpha-2)',
      'any.required': 'country is required',
    }),
);

// ── Request schemas ───────────────────────────────────────────────────────────

/** Admin: Register agent */
export const registerAgentSchema = Joi.object({
  agent: stellarAddressSchema,
}).unknown(false);

/** Admin: Update fee */
export const updateFeeSchema = Joi.object({
  fee_bps: feeBpsSchema,
}).unknown(false);

/** Admin: Set daily limit */
export const setDailyLimitSchema = Joi.object({
  currency: currencyCodeSchema,
  country: countryCodeSchema,
  limit: positiveAmountSchema,
}).unknown(false);

/** Admin: Withdraw fees */
export const withdrawFeesSchema = Joi.object({
  to: stellarAddressSchema,
}).unknown(false);

/**
 * Memo field — sanitized with on-chain rules (max 28 bytes, no HTML,
 * no control chars) so the same value is safe for the DB and for Stellar.
 */
export const memoSchema = sanitizedMemo(
  Joi.string()
    .max(28)
    .optional()
    .messages({
      'string.max': 'memo must not exceed 28 characters (Stellar text memo limit)',
    }),
);

/**
 * Remittance: Create remittance request.
 * All string fields sanitized at schema parse time.
 */
export const createRemittanceSchema = Joi.object({
  sender: stellarAddressSchema,
  agent: stellarAddressSchema,
  amount: positiveAmountSchema,
  memo: memoSchema,
  token: sanitizedString(
    Joi.string()
      .pattern(STELLAR_ADDRESS_PATTERN)
      .max(56)
      .optional()
      .messages({
        'string.pattern.base': 'token must be a valid Stellar address if provided',
        'string.max': 'token must not exceed 56 characters',
      }),
  ),
}).unknown(false);

// ── Validation helper ─────────────────────────────────────────────────────────

/**
 * Validate a request body against a Joi schema.
 * Returns a structured error object, or null when valid.
 * `stripUnknown: true` is set so extra fields are silently dropped — this
 * prevents unvalidated (and therefore unsanitized) fields reaching handlers.
 */
export function validateRequest(
  body: unknown,
  schema: Joi.ObjectSchema,
): { error: string; details: string[] } | null {
  const { error } = schema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    const details = error.details.map(
      (detail) => `${detail.path.join('.')}: ${detail.message}`,
    );
    return { error: 'Validation failed', details };
  }

  return null;
}
