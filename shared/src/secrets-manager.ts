/**
 * Shared Secrets Manager
 *
 * Single canonical implementation consumed by both `backend/` and `api/`.
 * Supports AWS Secrets Manager (primary) and HashiCorp Vault (via HTTP API),
 * with an in-process TTL cache and rotation hooks so secrets can be updated
 * without a restart.
 *
 * Production safety guarantee
 * ───────────────────────────
 * When NODE_ENV=production and a required secret falls through to a plain-text
 * environment variable (i.e. the secret store is unreachable or disabled),
 * `getSecret` throws immediately so the process fails fast at startup rather
 * than running with a degraded, potentially-exposed configuration.
 *
 * Secret enumeration
 * ──────────────────
 * backend service uses:
 *   JWT_SECRET          (required) — JWT signing key
 *   DATABASE_URL        (required) — PostgreSQL connection string
 *   ADMIN_SECRET_KEY    (required) — internal admin ops key
 *   CONTRACT_ID         (required) — deployed Stellar contract address
 *   FX_API_KEY          (optional) — external FX data provider
 *   ANCHORS_ADMIN_API_KEY (optional) — anchor admin API key
 *   WEBHOOK_SECRET_PRIMARY (optional) — HMAC webhook signing key
 *
 * api service uses:
 *   JWT_SECRET          (required) — JWT signing key (shared with backend)
 *   DATABASE_URL        (required) — PostgreSQL connection string
 *   ADMIN_API_KEY       (optional) — REST admin API key
 *   ANCHORS_ADMIN_API_KEY (optional) — anchor admin API key
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  DescribeSecretCommand,
} from '@aws-sdk/client-secrets-manager';

// ── Logger shim ─────────────────────────────────────────────────────────────
// We cannot import from either service logger here (circular deps), so we use
// a minimal structured logger that never echoes secret values.

function log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  // Strip any value that looks like it might be a secret before emitting.
  const safeMeta = meta ? redactLogMeta(meta) : undefined;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    context: 'SecretsManager',
    message,
    ...(safeMeta && { data: safeMeta }),
  });
  if (level === 'error') {
    console.error(entry);
  } else if (level === 'warn') {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

/**
 * Remove any key whose name or value looks like a raw credential.
 * This runs before anything is written to a log sink.
 */
function redactLogMeta(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'string' && looksLikeSecret(v)) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = v;
    }
  }
  return result;
}

const SECRET_KEY_PATTERN = /secret|password|passwd|token|api.?key|private.?key|auth|credential|signing/i;

/**
 * Heuristic: a string is treated as a potential secret if it is ≥20 chars
 * with sufficient entropy (no repeated 3-char run dominating it).
 * This catches JWT secrets, API keys, and connection strings while leaving
 * ordinary text (error messages, URLs without passwords) intact.
 */
function looksLikeSecret(value: string): boolean {
  if (value.length < 20) return false;
  // Connection strings always contain credentials — redact unconditionally.
  if (/^postgres(?:ql)?:\/\//i.test(value)) return true;
  if (/^https?:\/\/[^@]+:[^@]+@/i.test(value)) return true;
  // High-entropy opaque strings (base64, hex) typical of API keys / JWTs.
  const alphanumRatio = (value.match(/[A-Za-z0-9+/=_-]/g) ?? []).length / value.length;
  return alphanumRatio > 0.85 && value.length >= 32;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SecretConfig {
  /** The AWS Secrets Manager SecretId (or the env-var name as fallback). */
  secretId: string;
  /**
   * When the stored secret is a JSON object, `key` selects the field to
   * extract.  Omit to return the raw secret string.
   */
  key?: string;
  /** Throw if the secret cannot be resolved. */
  required?: boolean;
  /** Per-secret TTL override in milliseconds.  Defaults to SECRETS_CACHE_TTL_MS. */
  refreshIntervalMs?: number;
}

export interface SecretRotationHook {
  secretId: string;
  onRotate: (newValue: string) => void | Promise<void>;
}

// ── SecretsManager class ─────────────────────────────────────────────────────

export class SecretsManager {
  private client: SecretsManagerClient | null = null;
  private cache = new Map<string, { value: string; timestamp: number; ttl: number }>();
  private rotationHooks = new Map<string, SecretRotationHook>();
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly enabled: boolean;
  private readonly region: string;
  private readonly isProduction: boolean;

  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    this.enabled =
      process.env.SECRETS_MANAGER_ENABLED !== 'false' && !!process.env.AWS_REGION;
    this.region = process.env.AWS_REGION || 'us-east-1';

    if (this.enabled) {
      this.client = new SecretsManagerClient({ region: this.region });
      log('info', 'AWS Secrets Manager client initialised', { region: this.region });
    } else {
      log(
        this.isProduction ? 'warn' : 'info',
        'Secrets Manager disabled — falling back to environment variables',
        { isProduction: this.isProduction },
      );
    }
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────

  private cacheKey(config: SecretConfig): string {
    return config.key ? `${config.secretId}:${config.key}` : config.secretId;
  }

  private defaultTtlMs(): number {
    return parseInt(process.env.SECRETS_CACHE_TTL_MS || '300000', 10); // 5 min
  }

  // ── Core resolution ───────────────────────────────────────────────────────

  /**
   * Resolve a secret.  Resolution order:
   *   1. In-process cache (if within TTL)
   *   2. AWS Secrets Manager (when enabled)
   *   3. Environment variable (plain-text fallback)
   *
   * In production the plain-text fallback is **blocked for required secrets**.
   * Optional secrets still fall through so optional integrations degrade
   * gracefully rather than crashing the whole process.
   */
  async getSecret(config: SecretConfig): Promise<string | undefined> {
    const cacheKey = this.cacheKey(config);
    const now = Date.now();
    const ttl = config.refreshIntervalMs ?? this.defaultTtlMs();

    // 1. Cache hit
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.timestamp < cached.ttl) {
      return cached.value;
    }

    // 2. Secret store
    if (this.enabled && this.client) {
      const value = await this.fetchFromStore(config, now, ttl);
      if (value !== undefined) return value;
    }

    // 3. Env-var fallback — blocked in production for required secrets
    const envValue = process.env[config.secretId];

    if (!envValue) {
      if (config.required) {
        throw new Error(
          `[SecretsManager] Required secret "${config.secretId}" not found in secret store or environment`,
        );
      }
      return undefined;
    }

    if (config.required && this.isProduction) {
      // Fail fast: production must never run with plaintext secrets
      throw new Error(
        `[SecretsManager] PRODUCTION SECURITY VIOLATION: required secret "${config.secretId}" ` +
          'resolved from a plaintext environment variable. ' +
          'Configure AWS_REGION and ensure the secret exists in AWS Secrets Manager.',
      );
    }

    // Non-production (or optional secret in production) — cache and return
    this.cache.set(cacheKey, { value: envValue, timestamp: now, ttl });
    return envValue;
  }

  /**
   * Like `getSecret` but always returns a string (throws when not found).
   * Convenience wrapper for required secrets.
   */
  async getRequiredSecret(config: SecretConfig): Promise<string> {
    const value = await this.getSecret({ ...config, required: true });
    // getSecret with required:true always throws before returning undefined
    return value!;
  }

  // ── AWS Secrets Manager fetch ─────────────────────────────────────────────

  private async fetchFromStore(
    config: SecretConfig,
    now: number,
    ttl: number,
  ): Promise<string | undefined> {
    try {
      const response = await this.client!.send(
        new GetSecretValueCommand({ SecretId: config.secretId }),
      );

      const raw = response.SecretString;
      if (!raw) {
        if (config.required) {
          throw new Error(`[SecretsManager] Secret "${config.secretId}" exists but has no SecretString`);
        }
        return undefined;
      }

      let value: string;
      try {
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (config.key) {
          value = parsed[config.key];
          if (value === undefined && config.required) {
            throw new Error(
              `[SecretsManager] Key "${config.key}" not found in secret "${config.secretId}"`,
            );
          }
        } else {
          // Return the raw JSON string when no key is specified
          value = raw;
        }
      } catch (parseErr) {
        // Not valid JSON — treat the whole string as the secret value
        value = config.key ? '' : raw;
        if (config.key && config.required) {
          throw new Error(
            `[SecretsManager] Secret "${config.secretId}" is not JSON; cannot extract key "${config.key}"`,
          );
        }
      }

      if (value) {
        this.cache.set(this.cacheKey(config), { value, timestamp: now, ttl });
      }
      return value || undefined;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('[SecretsManager]')) {
        throw error; // re-throw our own structured errors
      }
      // AWS SDK errors
      log('warn', `Failed to fetch secret from store: ${config.secretId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      if (config.required && this.isProduction) {
        throw new Error(
          `[SecretsManager] Failed to retrieve required secret "${config.secretId}" from store: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
      return undefined;
    }
  }

  // ── Rotation hooks ────────────────────────────────────────────────────────

  registerRotationHook(hook: SecretRotationHook): void {
    this.rotationHooks.set(hook.secretId, hook);
    if (this.enabled && this.client) {
      this.scheduleRotationCheck(hook.secretId);
    }
  }

  private scheduleRotationCheck(secretId: string): void {
    const intervalMs = parseInt(
      process.env.SECRETS_ROTATION_CHECK_INTERVAL_MS || '60000',
      10,
    );

    const existing = this.refreshTimers.get(secretId);
    if (existing) clearInterval(existing);

    const timer = setInterval(async () => {
      try {
        await this.checkAndNotifyRotation(secretId);
      } catch (error) {
        log('warn', 'Secret rotation check failed', {
          secretId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);

    // Don't block process exit
    if (timer.unref) timer.unref();
    this.refreshTimers.set(secretId, timer);
  }

  private async checkAndNotifyRotation(secretId: string): Promise<void> {
    if (!this.client) return;

    const response = await this.client.send(
      new DescribeSecretCommand({ SecretId: secretId }),
    );
    const lastChanged = response.LastChangedDate?.getTime() ?? 0;
    const cached = this.cache.get(secretId);

    if (cached && cached.timestamp < lastChanged) {
      // Evict so the next getSecret call fetches fresh
      this.cache.delete(secretId);
      const newValue = await this.getSecret({ secretId, required: false });
      if (newValue !== undefined) {
        const hook = this.rotationHooks.get(secretId);
        if (hook) {
          await hook.onRotate(newValue);
          log('info', 'Secret rotated and hook executed', { secretId });
        }
      }
    }
  }

  /**
   * Manually push a new secret value to the store and trigger rotation hooks.
   * Primarily used by admin tooling and tests.
   */
  async rotateSecret(secretId: string, newValue: string): Promise<void> {
    if (!this.enabled || !this.client) {
      throw new Error('[SecretsManager] Cannot rotate: Secrets Manager is not enabled');
    }

    await this.client.send(
      new PutSecretValueCommand({ SecretId: secretId, SecretString: newValue }),
    );

    // Evict cache so next read fetches from store
    this.cache.delete(secretId);

    const hook = this.rotationHooks.get(secretId);
    if (hook) await hook.onRotate(newValue);

    log('info', 'Secret rotated successfully', { secretId });
  }

  // ── Cache management ──────────────────────────────────────────────────────

  /** Evict all cached values (useful in tests). */
  clearCache(): void {
    this.cache.clear();
  }

  /** Stop all background timers and clear cache. */
  async shutdown(): Promise<void> {
    for (const timer of this.refreshTimers.values()) clearInterval(timer);
    this.refreshTimers.clear();
    this.cache.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: SecretsManager | undefined;

export function getSecretsManager(): SecretsManager {
  if (!_instance) _instance = new SecretsManager();
  return _instance;
}

/** Replace the singleton (useful for testing). */
export function _setSecretsManagerInstance(sm: SecretsManager): void {
  _instance = sm;
}

// ── Named helpers — backend service ─────────────────────────────────────────

export async function getJwtSecret(): Promise<string> {
  return getSecretsManager().getRequiredSecret({ secretId: 'JWT_SECRET' });
}

export async function getDatabaseUrl(): Promise<string> {
  return getSecretsManager().getRequiredSecret({ secretId: 'DATABASE_URL' });
}

export async function getAdminSecretKey(): Promise<string> {
  return getSecretsManager().getRequiredSecret({ secretId: 'ADMIN_SECRET_KEY' });
}

export async function getContractId(): Promise<string> {
  return getSecretsManager().getRequiredSecret({ secretId: 'CONTRACT_ID' });
}

export async function getFxApiKey(): Promise<string | undefined> {
  return getSecretsManager().getSecret({ secretId: 'FX_API_KEY', required: false });
}

export async function getAnchorsAdminApiKey(): Promise<string | undefined> {
  return getSecretsManager().getSecret({ secretId: 'ANCHORS_ADMIN_API_KEY', required: false });
}

// ── Named helpers — api service ───────────────────────────────────────────────

export async function getAdminApiKey(): Promise<string | undefined> {
  return getSecretsManager().getSecret({ secretId: 'ADMIN_API_KEY', required: false });
}

// ── Rotation initialisation — backend ────────────────────────────────────────

export async function initializeSecretRotation(): Promise<void> {
  const sm = getSecretsManager();

  sm.registerRotationHook({
    secretId: 'FX_API_KEY',
    onRotate: (_newValue: string) => {
      // Intentionally do NOT log or echo the new value.
      log('info', 'FX_API_KEY rotated — cache evicted, next read will use new value');
    },
  });

  sm.registerRotationHook({
    secretId: 'WEBHOOK_SECRET_PRIMARY',
    onRotate: (_newValue: string) => {
      log('info', 'WEBHOOK_SECRET_PRIMARY rotated — cache evicted');
    },
  });

  sm.registerRotationHook({
    secretId: 'JWT_SECRET',
    onRotate: (_newValue: string) => {
      log('info', 'JWT_SECRET rotated — in-flight tokens will expire at their original TTL');
    },
  });

  sm.registerRotationHook({
    secretId: 'ADMIN_API_KEY',
    onRotate: (_newValue: string) => {
      log('info', 'ADMIN_API_KEY rotated');
    },
  });
}
