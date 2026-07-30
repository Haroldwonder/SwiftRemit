import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const PREFIX = 'enc:v1:';

// Default key for development/test environment if ENCRYPTION_KEY is not set
const DEFAULT_KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

function getMasterKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    if (envKey.length === 64) {
      return Buffer.from(envKey, 'hex');
    }
    // Hash key if it's arbitrary string length
    return crypto.createHash('sha256').update(envKey).digest();
  }
  return Buffer.from(DEFAULT_KEY_HEX, 'hex');
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
