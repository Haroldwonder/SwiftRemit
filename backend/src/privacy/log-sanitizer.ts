/**
 * Log Sanitizer & Data Redaction Module
 * Ensures logs, traces, and error reports never contain personal data (PII) or secrets.
 */

// Regex patterns for sensitive PII detection
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IP_V4_REGEX = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const STELLAR_SECRET_REGEX = /\bS[A-Z0-9]{50,55}\b/g;
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g;
const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'auth_token',
  'authorization',
  'ssn',
  'tax_id',
  'id_number',
  'credit_card',
  'card_number',
  'cvv',
  'email',
  'phone_number',
  'address',
  'full_name',
  'first_name',
  'last_name',
  'ip_address',
]);

/**
 * Sanitize a string by replacing PII patterns with redacted placeholders.
 */
export function sanitizeString(text: string): string {
  if (!text || typeof text !== 'string') return text;

  return text
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(IP_V4_REGEX, '[REDACTED_IP]')
    .replace(SSN_REGEX, '[REDACTED_TAX_ID]')
    .replace(STELLAR_SECRET_REGEX, '[REDACTED_SECRET_KEY]')
    .replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED_TOKEN]');
}

/**
 * Recursively sanitize any object, array, error, or primitive to ensure no PII leaks in log output.
 */
export function sanitizeLogValue(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === 'string') {
    return sanitizeString(val);
  }

  if (typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }

  if (val instanceof Error) {
    return {
      name: val.name,
      message: sanitizeString(val.message),
      stack: val.stack ? sanitizeString(val.stack) : undefined,
    };
  }

  if (Array.isArray(val)) {
    return val.map(item => sanitizeLogValue(item));
  }

  if (typeof val === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        result[key] = `[REDACTED_${key.toUpperCase()}]`;
      } else {
        result[key] = sanitizeLogValue(value);
      }
    }
    return result;
  }

  return sanitizeString(String(val));
}

/**
 * Helper to sanitize log arguments.
 */
export function sanitizeLogArgs(args: unknown[]): unknown[] {
  return args.map(arg => sanitizeLogValue(arg));
}
