import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const PREFIX = 'enc:v1:';

/**
 * Derived deterministically at module load so tests never need to set
 * ENCRYPTION_KEY, without shipping a literal, publicly-visible key that
 * every column would silently fall back to in a misconfigured deployment
 * (see SR-131). Never used outside NODE_ENV=test.
 */
const TEST_ONLY_KEY = crypto.createHash('sha256').update('swiftremit-test-fixture-key-do-not-use').digest();

/**
 * Resolve the AES-256 master key from ENCRYPTION_KEY.
 *
 * There is no fallback key outside test. Before this change, an unset
 * ENCRYPTION_KEY silently fell back to a literal hex constant committed to
 * this file — anyone who had read the source already knew the "encryption"
 * key, so a misconfigured deploy would encrypt every PII column with zero
 * real confidentiality while application code treated it as protected.
 * Failing closed here mirrors env-guard.ts's treatment of other required
 * secrets and backend/src/index.ts's fail-fast startup behaviour.
 */
function getMasterKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    if (envKey.length === 64) {
      return Buffer.from(envKey, 'hex');
    }
    // Hash key if it's arbitrary string length
    return crypto.createHash('sha256').update(envKey).digest();
  }

  if (process.env.NODE_ENV === 'test') {
    return TEST_ONLY_KEY;
  }

  throw new Error(
    'ENCRYPTION_KEY is not set. Refusing to encrypt/decrypt with a known fallback key — ' +
      'set ENCRYPTION_KEY (64 hex chars, sourced from the secrets manager) before starting this service.',
  );
}

/**
 * Check if a given string is already encrypted in enc:v1 format.
 */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext string using AES-256-GCM column-level encryption.
 * Returns string format: enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptColumn(plaintext: string | null | undefined): string | null | undefined {
  if (plaintext === null || plaintext === undefined) {
    return plaintext;
  }

  const textToEncrypt = String(plaintext);
  if (isEncrypted(textToEncrypt)) {
    return textToEncrypt; // Already encrypted
  }

  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(textToEncrypt, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag().toString('hex');
  return `${PREFIX}${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypt an encrypted column string format: enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 * Returns original plaintext string.
 */
export function decryptColumn(ciphertext: string | null | undefined): string | null | undefined {
  if (ciphertext === null || ciphertext === undefined) {
    return ciphertext;
  }

  if (!isEncrypted(ciphertext)) {
    return ciphertext; // Plaintext or unknown format, return as is
  }

  const payload = ciphertext.slice(PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted column payload format');
  }

  const [ivHex, tagHex, encryptedHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypt specific fields inside an object.
 */
export function encryptObject<T extends Record<string, any>>(obj: T, fields: string[]): T {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj } as any;

  for (const field of fields) {
    if (field in result && typeof result[field] === 'string') {
      result[field] = encryptColumn(result[field]);
    } else if (field in result && result[field] && typeof result[field] === 'object') {
      result[field] = encryptColumn(JSON.stringify(result[field]));
    }
  }

  return result;
}

/**
 * Decrypt specific fields inside an object.
 */
export function decryptObject<T extends Record<string, any>>(obj: T, fields: string[]): T {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj } as any;

  for (const field of fields) {
    if (field in result && isEncrypted(result[field])) {
      try {
        const decryptedStr = decryptColumn(result[field])!;
        try {
          result[field] = JSON.parse(decryptedStr);
        } catch {
          result[field] = decryptedStr;
        }
      } catch {
        // Keep ciphertext if decryption fails
      }
    }
  }

  return result;
}
