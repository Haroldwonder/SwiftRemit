import { describe, it, expect, afterEach } from 'vitest';

/**
 * SR-131 — encryption.ts must fail closed when ENCRYPTION_KEY is unset.
 *
 * Before this fix, getMasterKey() silently returned a literal, publicly
 * visible constant (DEFAULT_KEY_HEX) committed to the repository whenever
 * ENCRYPTION_KEY was missing, in every environment including production —
 * "encrypted" PII would be ciphertext anyone reading the source already had
 * the key for. Import is deferred to a helper inside each test so the module
 * (and its NODE_ENV check) is re-evaluated per env var combination — Node's
 * module cache would otherwise serve the first import's behaviour.
 */
async function freshEncryptionModule() {
  const modPath = '../privacy/encryption';
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(modPath) as typeof import('../privacy/encryption');
}

describe('privacy/encryption — fail closed without ENCRYPTION_KEY', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    process.env.NODE_ENV = originalEnv;
  });

  it('throws instead of silently using a known default key outside test env', async () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    const { encryptColumn } = await freshEncryptionModule();

    expect(() => encryptColumn('sensitive-value')).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('throws on decryptColumn too, not just encryptColumn', async () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.NODE_ENV = 'development';
    const { decryptColumn } = await freshEncryptionModule();

    expect(() => decryptColumn('enc:v1:aa:bb:cc')).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('does not throw when ENCRYPTION_KEY is set, regardless of environment', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.NODE_ENV = 'production';
    const { encryptColumn, decryptColumn, isEncrypted } = await freshEncryptionModule();

    const encrypted = encryptColumn('sensitive-value')!;
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decryptColumn(encrypted)).toBe('sensitive-value');
  });
});
