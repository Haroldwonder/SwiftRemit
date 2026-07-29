/**
 * api/src/secrets-manager.ts
 *
 * Thin re-export shim — all logic lives in the shared package.
 * Import from here as before; nothing in the API service changes.
 */
export {
  SecretsManager,
  getSecretsManager,
  _setSecretsManagerInstance,
  getJwtSecret,
  getDatabaseUrl,
  getAdminApiKey,
  getAnchorsAdminApiKey,
  initializeSecretRotation,
} from '../../shared/src/secrets-manager';

export type { SecretConfig, SecretRotationHook } from '../../shared/src/secrets-manager';
