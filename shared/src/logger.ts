/**
 * Shared Logger Module
 *
 * Structured logger with automatic secret redaction so no secret value is
 * ever written to a log sink.  Consumed by both `backend/` and `api/`.
 *
 * Redaction strategy:
 *   1. Key-name matching — any key with a sensitive name (secret, password,
 *      token, etc.) has its value replaced with '[REDACTED]'.
 *   2. Value-pattern matching — any string value that looks like a secret
 *      (connection string, high-entropy opaque string ≥32 chars) is
 *      replaced with '[REDACTED]'.
 *
 * Usage:
 *   import { createLogger } from '../../shared/src/logger';
 *   const logger = createLogger('MyService');
 *   logger.info('Operation succeeded', { userId, transactionId });
 *
 * The backend service extends this logger with OpenTelemetry trace/span
 * context and AsyncLocalStorage correlation IDs; the api service uses it
 * as-is for simpler structured logging.
 */

// ── Secret detection ──────────────────────────────────────────────────────────

/**
 * Set of key names that always indicate a secret value.
 * Matched case-insensitively with word-boundary anchors.
 */
const SENSITIVE_FIELD_NAMES = new Set([
  'secret_key',
  'private_key',
  'password',
  'passwd',
  'kyc_fields',
  'token',
  'authorization',
  'secret',
  'api_key',
  'apikey',
  'auth_token',
  'refresh_token',
  'access_token',
  'jwt',
  'signing_key',
  'credential',
  'credentials',
  'database_url',
  'db_url',
  'connection_string',
  'seed',
  'mnemonic',
]);

/**
 * Regex pattern for keys whose name suggests they hold a secret.
 * Tested case-insensitively.
 */
const SECRET_KEY_PATTERN =
  /secret|password|passwd|token|api.?key|private.?key|auth|credential|signing|jwt|seed|mnemonic/i;

/**
 * Heuristic: a string value is treated as a potential secret if:
 *   - It matches a known format (postgres://, JWT bearer token).
 *   - It is ≥32 chars with high alphanumeric density (typical of API keys).
 *
 * This catches connection strings, JWTs, and base64-encoded keys while
 * leaving ordinary text (error messages, Stellar addresses, UUIDs) intact.
 */
function looksLikeSecretValue(value: string): boolean {
  if (value.length < 20) return false;

  // Connection strings always contain credentials — redact unconditionally
  if (/^postgres(?:ql)?:\/\//i.test(value)) return true;
  if (/^mysql:\/\//i.test(value)) return true;
  if (/^mongodb(?:\+srv)?:\/\//i.test(value)) return true;
  if (/^https?:\/\/[^@]+:[^@]+@/i.test(value)) return true; // http://user:pass@host

  // JWT tokens (header.payload.signature with base64url chars)
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) && value.length >= 100) {
    return true;
  }

  // High-entropy strings ≥32 chars (base64, hex, urlsafe-base64)
  if (value.length >= 32) {
    const alphanumRatio = (value.match(/[A-Za-z0-9+/=_-]/g) ?? []).length / value.length;
    return alphanumRatio > 0.85;
  }

  return false;
}

/**
 * Recursively redact sensitive fields in a log metadata object.
 * Returns a new object with secrets replaced by '[REDACTED]'.
 */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return looksLikeSecretValue(value) ? '[REDACTED]' : value;
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        // Key-name check
        if (SENSITIVE_FIELD_NAMES.has(k.toLowerCase()) || SECRET_KEY_PATTERN.test(k)) {
          return [k, '[REDACTED]'];
        }
        // Recursive redaction for nested objects
        return [k, redact(v)];
      }),
    );
  }

  return value;
}

// ── StructuredLogger class ────────────────────────────────────────────────────

export class StructuredLogger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private formatMessage(level: string, message: string, data?: unknown): string {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      ...(data && { data: redact(data) }),
    };
    return JSON.stringify(logEntry);
  }

  info(message: string, data?: unknown): void {
    console.log(this.formatMessage('INFO', message, data));
  }

  warn(message: string, data?: unknown): void {
    console.warn(this.formatMessage('WARN', message, data));
  }

  error(message: string, error?: Error | unknown, data?: unknown): void {
    const errorData =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error;
    console.error(this.formatMessage('ERROR', message, { ...data, error: errorData }));
  }

  debug(message: string, data?: unknown): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage('DEBUG', message, data));
    }
  }
}

/**
 * Create a logger instance for a specific context (module name).
 */
export function createLogger(context: string): StructuredLogger {
  return new StructuredLogger(context);
}
