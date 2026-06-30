import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand, DescribeSecretCommand } from '@aws-sdk/client-secrets-manager';
import { createLogger } from './types';

const logger = createLogger('SecretsManager');

export interface SecretConfig {
  secretId: string;
  key?: string;
  required?: boolean;
  refreshIntervalMs?: number;
}

export interface SecretRotationHook {
  secretId: string;
  onRotate: (newValue: string) => void | Promise<void>;
}

export class SecretsManager {
  private client: SecretsManagerClient | null = null;
  private cache: Map<string, { value: string; timestamp: number; ttl: number }> = new Map();
  private rotationHooks: Map<string, SecretRotationHook> = new Map();
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();
  private enabled: boolean;
  private region: string;

  constructor() {
    this.enabled = process.env.SECRETS_MANAGER_ENABLED !== 'false' && !!process.env.AWS_REGION;
    this.region = process.env.AWS_REGION || 'us-east-1';

    if (this.enabled) {
      this.client = new SecretsManagerClient({ region: this.region });
    }
  }

  private getCacheKey(config: SecretConfig): string {
    return config.key ? `${config.secretId}:${config.key}` : config.secretId;
  }

  async getSecret(config: SecretConfig): Promise<string | undefined> {
    if (!this.enabled || !this.client) {
      const envValue = process.env[config.secretId];
      if (config.required && !envValue) {
        throw new Error(`Required secret ${config.secretId} not found in environment variables`);
      }
      return envValue;
    }

    const cacheKey = this.getCacheKey(config);
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    const ttl = config.refreshIntervalMs || parseInt(process.env.SECRETS_CACHE_TTL_MS || '300000', 10);

    if (cached && now - cached.timestamp < ttl) {
      return cached.value;
    }

    try {
      const response = await this.client.send(
        new GetSecretValueCommand({ SecretId: config.secretId })
      );

      const secretValue = response.SecretString;
      if (!secretValue) {
        throw new Error(`Secret ${config.secretId} has no SecretString value`);
      }

      let value: string;
      try {
        const parsed = JSON.parse(secretValue);
        value = config.key ? parsed[config.key] : secretValue;
      } catch {
        value = config.key ? undefined! : secretValue;
      }

      if (!value && config.required) {
        throw new Error(`Required secret ${config.secretId}${config.key ? `/${config.key}` : ''} not found`);
      }

      this.cache.set(cacheKey, { value, timestamp: now, ttl });
      return value;
    } catch (error) {
      if (config.required) {
        throw new Error(`Failed to retrieve required secret ${config.secretId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      return undefined;
    }
  }

  async getSecretWithFallback(config: SecretConfig): Promise<string> {
    const secretValue = await this.getSecret(config);
    if (secretValue !== undefined) {
      return secretValue;
    }
    const envValue = process.env[config.secretId];
    if (!envValue) {
      throw new Error(`Required secret ${config.secretId} not found in Secrets Manager or environment variables`);
    }
    return envValue;
  }

  registerRotationHook(hook: SecretRotationHook): void {
    this.rotationHooks.set(hook.secretId, hook);

    if (this.enabled && this.client) {
      this.scheduleRotationCheck(hook.secretId);
    }
  }

  private scheduleRotationCheck(secretId: string): void {
    const intervalMs = parseInt(process.env.SECRETS_ROTATION_CHECK_INTERVAL_MS || '60000', 10);

    if (this.refreshTimers.has(secretId)) {
      clearInterval(this.refreshTimers.get(secretId)!);
    }

    const timer = setInterval(async () => {
      try {
        await this.checkAndNotifyRotation(secretId);
      } catch (error) {
        logger.warn('Secret rotation check failed', { secretId, error: error instanceof Error ? error.message : String(error) });
      }
    }, intervalMs);

    this.refreshTimers.set(secretId, timer);
  }

  private async checkAndNotifyRotation(secretId: string): Promise<void> {
    if (!this.client) return;

    try {
      const response = await this.client.send(
        new DescribeSecretCommand({ SecretId: secretId })
      );

      const lastChanged = response.LastChangedDate?.getTime() || 0;

      const cached = this.cache.get(secretId);
      if (cached && cached.timestamp < lastChanged) {
        const newValue = await this.getSecret({ secretId });
        const hook = this.rotationHooks.get(secretId);
        if (hook && newValue !== undefined) {
          await hook.onRotate(newValue);
          logger.info('Secret rotated and hook executed', { secretId });
        }
      }
    } catch (error) {
      logger.warn('Failed to check secret rotation status', { secretId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async rotateSecret(secretId: string, newValue: string): Promise<void> {
    if (!this.enabled || !this.client) {
      throw new Error('Secrets Manager is not enabled');
    }

    try {
      await this.client.send(
        new PutSecretValueCommand({
          SecretId: secretId,
          SecretString: newValue,
        })
      );

      this.cache.delete(secretId);

      const hook = this.rotationHooks.get(secretId);
      if (hook) {
        await hook.onRotate(newValue);
      }

      logger.info('Secret rotated successfully', { secretId });
    } catch (error) {
      throw new Error(`Failed to rotate secret ${secretId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  async shutdown(): Promise<void> {
    for (const [secretId, timer] of this.refreshTimers.entries()) {
      clearInterval(timer);
    }
    this.refreshTimers.clear();
    this.cache.clear();
  }
}

const globalSecretsManager = new SecretsManager();

export function getSecretsManager(): SecretsManager {
  return globalSecretsManager;
}

export async function getJwtSecret(): Promise<string> {
  const sm = getSecretsManager();
  return sm.getSecretWithFallback({
    secretId: 'JWT_SECRET',
    required: true,
  });
}

export async function getDatabaseUrl(): Promise<string> {
  const sm = getSecretsManager();
  return sm.getSecretWithFallback({
    secretId: 'DATABASE_URL',
    required: true,
  });
}

export async function getAnchorsAdminApiKey(): Promise<string | undefined> {
  const sm = getSecretsManager();
  return sm.getSecret({
    secretId: 'ANCHORS_ADMIN_API_KEY',
    required: false,
  });
}

export async function getAdminApiKey(): Promise<string | undefined> {
  const sm = getSecretsManager();
  return sm.getSecret({
    secretId: 'ADMIN_API_KEY',
    required: false,
  });
}

// ── Secret Rotation Integration ────────────────────────────────────────────────

export async function initializeSecretRotation(): Promise<void> {
  const sm = getSecretsManager();

  sm.registerRotationHook({
    secretId: 'JWT_SECRET',
    onRotate: (newValue: string) => {
      process.env.JWT_SECRET = newValue;
      logger.info('JWT_SECRET rotated in memory');
    },
  });

  sm.registerRotationHook({
    secretId: 'ADMIN_API_KEY',
    onRotate: (newValue: string) => {
      process.env.ADMIN_API_KEY = newValue;
      logger.info('ADMIN_API_KEY rotated in memory');
    },
  });
}