/**
 * backend/src/secrets-manager.ts
 *
 * Thin re-export shim — all logic lives in the shared package.
 * Import from here as before; nothing in the backend changes.
 */
export {
  SecretsManager,
  getSecretsManager,
  _setSecretsManagerInstance,
  getJwtSecret,
  getDatabaseUrl,
  getAdminSecretKey,
  getContractId,
  getFxApiKey,
  getAnchorsAdminApiKey,
  getEncryptionKey,
  initializeSecretRotation,
} from '../../shared/src/secrets-manager';

export type { SecretConfig, SecretRotationHook } from '../../shared/src/secrets-manager';
