import Joi from 'joi';

/**
 * Stellar public key validation pattern
 * Format: G followed by 55 alphanumeric characters (56 total)
 */
const STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{54}$/;

/**
 * Validate a Stellar public key address
 */
export const stellarAddressSchema = Joi.string()
  .pattern(STELLAR_ADDRESS_PATTERN)
  .required()
  .messages({
    'string.pattern.base': 'agent must be a valid Stellar public key (G... format, 56 chars)',
    'any.required': 'agent is required',
  });

/**
 * Validate fee basis points (0-10000)
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
 * Validate positive integer amounts
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
 * Validate currency code (ISO 4217, 3 uppercase letters)
 */
export const currencyCodeSchema = Joi.string()
  .length(3)
  .uppercase()
  .pattern(/^[A-Z]{3}$/)
  .required()
  .messages({
    'string.length': 'currency must be exactly 3 characters',
    'string.pattern.base': 'currency must be 3 uppercase letters (ISO 4217)',
    'any.required': 'currency is required',
  });

/**
 * Validate country code (ISO 3166-1 alpha-2, 2 uppercase letters)
 */
export const countryCodeSchema = Joi.string()
  .length(2)
  .uppercase()
  .pattern(/^[A-Z]{2}$/)
  .required()
  .messages({
    'string.length': 'country must be exactly 2 characters',
    'string.pattern.base': 'country must be 2 uppercase letters (ISO 3166-1 alpha-2)',
    'any.required': 'country is required',
  });

/**
 * Admin: Register agent request validation
 */
export const registerAgentSchema = Joi.object({
  agent: stellarAddressSchema,
}).unknown(false);

/**
 * Admin: Update fee request validation
 */
export const updateFeeSchema = Joi.object({
  fee_bps: feeBpsSchema,
}).unknown(false);

/**
 * Admin: Set daily limit request validation
 */
export const setDailyLimitSchema = Joi.object({
  currency: currencyCodeSchema,
  country: countryCodeSchema,
  limit: positiveAmountSchema,
}).unknown(false);

/**
 * Admin: Withdraw fees request validation
 */
export const withdrawFeesSchema = Joi.object({
  to: stellarAddressSchema,
}).unknown(false);

/**
 * Remittance: Create remittance request validation
 */
export const createRemittanceSchema = Joi.object({
  sender: stellarAddressSchema,
  agent: stellarAddressSchema,
  amount: positiveAmountSchema,
  token: Joi.string()
    .pattern(STELLAR_ADDRESS_PATTERN)
    .optional()
    .messages({
      'string.pattern.base': 'token must be a valid Stellar address if provided',
    }),
}).unknown(false);

/**
 * Validate request body against a schema
 * Returns validation error details or null if valid
 */
export function validateRequest(
  body: unknown,
  schema: Joi.ObjectSchema,
): { error: string; details: string[] } | null {
  const { error, value } = schema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const details = error.details.map(
      (detail) => `${detail.path.join('.')}: ${detail.message}`,
    );
    return {
      error: 'Validation failed',
      details,
    };
  }

  return null;
}
