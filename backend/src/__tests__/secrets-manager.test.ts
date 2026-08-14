import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SecretsManager,
  getSecretsManager,
  _setSecretsManagerInstance,
} from '../../../shared/src/secrets-manager';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeAwsClient(secretString: string) {
  return {
    send: vi.fn().mockResolvedValue({ SecretString: secretString }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SecretsManager — env-var fallback (store disabled)', () => {
  beforeEach(() => {
    delete process.env.AWS_REGION;
    delete process.env.NODE_ENV;
    delete process.env.SECRETS_MANAGER_ENABLED;
    // Reset singleton so each test starts fresh
    _setSecretsManagerInstance(undefined as any);
  });

  afterEach(() => {
    delete process.env.MY_SECRET;
    delete process.env.NODE_ENV;
    _setSecretsManagerInstance(undefined as any);
  });

  it('resolves an optional secret from env var in non-production', async () => {
    process.env.MY_SECRET = 'hello-world';
    const sm = new SecretsManager();
    const value = await sm.getSecret({ secretId: 'MY_SECRET', required: false });
    expect(value).toBe('hello-world');
  });

  it('returns undefined for a missing optional secret', async () => {
    const sm = new SecretsManager();
    const value = await sm.getSecret({ secretId: 'MISSING_SECRET', required: false });
    expect(value).toBeUndefined();
  });

  it('throws for a missing required secret', async () => {
    const sm = new SecretsManager();
    await expect(
      sm.getSecret({ secretId: 'REQUIRED_MISSING', required: true }),
    ).rejects.toThrow('not found');
  });

  it('throws PRODUCTION SECURITY VIOLATION for required secret from env in production', async () => {
    process.env.NODE_ENV    = 'production';
    process.env.MY_SECRET   = 'plaintext-prod-secret';
    // No AWS_REGION → store stays disabled
    const sm = new SecretsManager();
    await expect(
      sm.getSecret({ secretId: 'MY_SECRET', required: true }),
    ).rejects.toThrow('PRODUCTION SECURITY VIOLATION');
  });

  it('does NOT throw for optional secret from env in production', async () => {
    process.env.NODE_ENV  = 'production';
    process.env.MY_SECRET = 'optional-value';
    const sm = new SecretsManager();
    const value = await sm.getSecret({ secretId: 'MY_SECRET', required: false });
    expect(value).toBe('optional-value');
  });
});

describe('SecretsManager — in-process TTL cache', () => {
  afterEach(() => {
    delete process.env.MY_SECRET;
    _setSecretsManagerInstance(undefined as any);
  });

  it('returns cached value within TTL without a second env read', async () => {
    process.env.MY_SECRET = 'first-value';
    const sm = new SecretsManager();

    const v1 = await sm.getSecret({ secretId: 'MY_SECRET', required: false, refreshIntervalMs: 60_000 });
    process.env.MY_SECRET = 'changed-value'; // mutate env after first read
    const v2 = await sm.getSecret({ secretId: 'MY_SECRET', required: false, refreshIntervalMs: 60_000 });

    expect(v1).toBe('first-value');
    expect(v2).toBe('first-value'); // served from cache
  });

  it('clearCache() forces a fresh read on next call', async () => {
    process.env.MY_SECRET = 'original';
    const sm = new SecretsManager();
    await sm.getSecret({ secretId: 'MY_SECRET', required: false });

    process.env.MY_SECRET = 'updated';
    sm.clearCache();

    const fresh = await sm.getSecret({ secretId: 'MY_SECRET', required: false });
    expect(fresh).toBe('updated');
  });
});

describe('SecretsManager — rotation hooks', () => {
  afterEach(() => {
    _setSecretsManagerInstance(undefined as any);
  });

  it('registerRotationHook stores the hook (no timer when store disabled)', () => {
    const sm   = new SecretsManager();
    const hook = { secretId: 'JWT_SECRET', onRotate: vi.fn() };
    // Should not throw even when client is null
    expect(() => sm.registerRotationHook(hook)).not.toThrow();
  });

  it('rotateSecret throws when store is disabled', async () => {
    const sm = new SecretsManager();
    await expect(sm.rotateSecret('JWT_SECRET', 'new-value')).rejects.toThrow(
      'not enabled',
    );
  });
});

describe('SecretsManager — shutdown', () => {
  it('shutdown() resolves without error and clears cache', async () => {
    process.env.MY_SECRET = 'val';
    const sm = new SecretsManager();
    await sm.getSecret({ secretId: 'MY_SECRET', required: false });
    await expect(sm.shutdown()).resolves.toBeUndefined();
  });
});

describe('getSecretsManager singleton', () => {
  beforeEach(() => _setSecretsManagerInstance(undefined as any));
  afterEach(()  => _setSecretsManagerInstance(undefined as any));

  it('returns the same instance on repeated calls', () => {
    const a = getSecretsManager();
    const b = getSecretsManager();
    expect(a).toBe(b);
  });

  it('_setSecretsManagerInstance replaces the singleton', () => {
    const custom = new SecretsManager();
    _setSecretsManagerInstance(custom);
    expect(getSecretsManager()).toBe(custom);
  });
});

describe('SecretsManager — secret values never logged', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not echo the secret value in any log call', async () => {
    const logSpy   = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    process.env.SUPER_SECRET_KEY = 'test_secret_abcdefghijklmnop_1234567890_should_not_appear';
    const sm = new SecretsManager();
    await sm.getSecret({ secretId: 'SUPER_SECRET_KEY', required: false });

    const allOutput = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]
      .flat()
      .join(' ');

    expect(allOutput).not.toContain('test_secret_abcdefghijklmnop_1234567890_should_not_appear');

    delete process.env.SUPER_SECRET_KEY;
    _setSecretsManagerInstance(undefined as any);
  });
});
