/**
 * Tests for src/services/biometrics.ts (hardened version with keystore binding)
 *
 * expo-local-authentication, expo-device, expo-constants, expo-crypto, and
 * expo-secure-store are mocked globally in setup.ts.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import {
  isBiometricAvailable,
  authenticateWithBiometrics,
  authenticateAndGetSigningKey,
  BiometricState,
  checkDeviceIntegrity,
  detectBiometricReEnrollment,
} from '../../services/biometrics';

const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
const mockAuthenticate = LocalAuthentication.authenticateAsync as jest.Mock;
const mockSupportedTypes = LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock;
const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;
const mockDigestStringAsync = Crypto.digestStringAsync as jest.Mock;

describe('biometrics.ts — isBiometricAvailable', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when hardware is present and biometrics are enrolled', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    expect(await isBiometricAvailable()).toBe(true);
  });

  it('returns false when hardware is not present', async () => {
    mockHasHardware.mockResolvedValue(false);
    expect(await isBiometricAvailable()).toBe(false);
    expect(mockIsEnrolled).not.toHaveBeenCalled();
  });

  it('returns false when hardware is present but no biometrics are enrolled', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(false);
    expect(await isBiometricAvailable()).toBe(false);
  });
});

describe('biometrics.ts — checkDeviceIntegrity (rooting/jailbreak detection)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a device integrity result with rooting flag', async () => {
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    (Device as any).osName = 'Android';

    const result = await checkDeviceIntegrity();
    expect(result).toHaveProperty('isRooted');
    expect(result).toHaveProperty('isJailbroken');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('ttlMs');
    expect(mockSetItemAsync).toHaveBeenCalledWith(
      '@swiftremit:device_integrity_check',
      expect.any(String)
    );
  });

  it('returns cached device integrity result if still valid', async () => {
    const cached = {
      isRooted: false,
      isJailbroken: false,
      timestamp: Date.now(),
      ttlMs: 24 * 60 * 60 * 1000,
    };
    mockGetItemAsync.mockResolvedValue(JSON.stringify(cached));

    const result = await checkDeviceIntegrity();
    expect(result).toEqual(cached);
    // Should not re-check; only one getItem call
    expect(mockGetItemAsync).toHaveBeenCalledTimes(1);
  });

  it('re-checks if cached result is stale', async () => {
    const stale = {
      isRooted: false,
      isJailbroken: false,
      timestamp: Date.now() - 25 * 60 * 60 * 1000, // older than 24h
      ttlMs: 24 * 60 * 60 * 1000,
    };
    mockGetItemAsync.mockResolvedValue(JSON.stringify(stale));
    mockSetItemAsync.mockResolvedValue(undefined);

    const result = await checkDeviceIntegrity();
    // Should have called setItem because cache was stale
    expect(mockSetItemAsync).toHaveBeenCalled();
    expect(result.timestamp).toBeGreaterThan(stale.timestamp);
  });
});

describe('biometrics.ts — detectBiometricReEnrollment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns false and stores enrollment hash on first run', async () => {
    mockIsEnrolled.mockResolvedValue(true);
    mockSupportedTypes.mockResolvedValue([1, 2]); // Fingerprint, Face
    mockGetItemAsync.mockResolvedValue(null); // No stored hash yet
    mockDigestStringAsync.mockResolvedValue('hash-abc-123');
    mockSetItemAsync.mockResolvedValue(undefined);

    const changed = await detectBiometricReEnrollment();
    expect(changed).toBe(false);
    expect(mockSetItemAsync).toHaveBeenCalledWith('@swiftremit:enrollment_hash', 'hash-abc-123');
  });

  it('returns false when enrollment hash matches (no re-enrollment)', async () => {
    mockIsEnrolled.mockResolvedValue(true);
    mockSupportedTypes.mockResolvedValue([1]);
    mockDigestStringAsync.mockResolvedValue('hash-same');
    mockGetItemAsync.mockResolvedValue('hash-same'); // Hash matches

    const changed = await detectBiometricReEnrollment();
    expect(changed).toBe(false);
    // Should not call setItem if hashes match
    expect(mockSetItemAsync).not.toHaveBeenCalled();
  });

  it('returns true and invalidates keys when enrollment hash changes', async () => {
    mockIsEnrolled.mockResolvedValue(true);
    mockSupportedTypes.mockResolvedValue([1, 2]); // Different types now
    mockDigestStringAsync.mockResolvedValue('hash-new');
    mockGetItemAsync.mockResolvedValue('hash-old'); // Hash differs
    mockSetItemAsync.mockResolvedValue(undefined);
    mockDeleteItemAsync.mockResolvedValue(undefined);

    const changed = await detectBiometricReEnrollment();
    expect(changed).toBe(true);
    // Should have cleared stored keys
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('@swiftremit:signing_key:');
    // Should have stored the new hash
    expect(mockSetItemAsync).toHaveBeenCalledWith('@swiftremit:enrollment_hash', 'hash-new');
  });
});

describe('biometrics.ts — authenticateAndGetSigningKey (hardened API with all 5 states)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mocks for a successful path
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    mockDigestStringAsync.mockResolvedValue('hash');
    mockSupportedTypes.mockResolvedValue([1]);
  });

  // ── State 1: NO_HARDWARE ───────────────────────────────────────────────
  it('returns NO_HARDWARE state when device has no biometric hardware', async () => {
    mockHasHardware.mockResolvedValue(false);

    const result = await authenticateAndGetSigningKey();
    expect(result.state).toBe(BiometricState.NO_HARDWARE);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('does not have biometric hardware');
  });

  // ── State 2: NOT_ENROLLED ─────────────────────────────────────────────
  it('returns NOT_ENROLLED state when biometrics are not enrolled', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(false);

    const result = await authenticateAndGetSigningKey();
    expect(result.state).toBe(BiometricState.NOT_ENROLLED);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('No biometrics enrolled');
  });

  // ── State 3: LOCKED_OUT ────────────────────────────────────────────────
  it('returns LOCKED_OUT state when authentication is locked out', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockRejectedValue(new Error('lockout'));

    const result = await authenticateAndGetSigningKey();
    expect(result.state).toBe(BiometricState.LOCKED_OUT);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Too many failed attempts');
  });

  // ── State 4: USER_CANCELLED ────────────────────────────────────────────
  it('returns USER_CANCELLED state when user cancels authentication', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: false, error: 'user_cancel' });

    const result = await authenticateAndGetSigningKey();
    expect(result.state).toBe(BiometricState.USER_CANCELLED);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('cancelled');
  });

  // ── State 5: SUCCESS ───────────────────────────────────────────────────
  it('returns SUCCESS state with keystore key ID on successful auth', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });

    const result = await authenticateAndGetSigningKey();
    expect(result.state).toBe(BiometricState.SUCCESS);
    expect(result.success).toBe(true);
    expect(result.keystoreKeyId).toBeDefined();
    expect(result.keystoreKeyId).toContain('@swiftremit:signing_key:');
  });

  it('detects re-enrollment before returning SUCCESS', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });
    // Simulate re-enrollment: hash changes
    mockGetItemAsync
      .mockResolvedValueOnce(null) // device integrity cache miss
      .mockResolvedValueOnce('old-hash') // enrollment hash stored
      .mockResolvedValueOnce(null); // device integrity cache miss on second call (only 1st call should happen)
    mockDigestStringAsync.mockResolvedValueOnce('new-hash');
    mockDeleteItemAsync.mockResolvedValue(undefined); // Key invalidation

    const result = await authenticateAndGetSigningKey();
    expect(result.success).toBe(true);
    // Should have invalidated keys
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('@swiftremit:signing_key:');
  });

  it('requires fresh authentication on every call (no session caching)', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });

    // Call 1
    const result1 = await authenticateAndGetSigningKey();
    expect(result1.success).toBe(true);

    // Call 2 — should call authenticateAsync again
    const result2 = await authenticateAndGetSigningKey();
    expect(result2.success).toBe(true);

    // Each call should have prompted the user
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });
});

describe('biometrics.ts — authenticateWithBiometrics (legacy API)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    mockDigestStringAsync.mockResolvedValue('hash');
    mockSupportedTypes.mockResolvedValue([1]);
  });

  it('returns true when the hardened API returns SUCCESS', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });

    const result = await authenticateWithBiometrics();
    expect(result).toBe(true);
  });

  it('returns false when the hardened API returns any failure state', async () => {
    mockHasHardware.mockResolvedValue(false);

    const result = await authenticateWithBiometrics();
    expect(result).toBe(false);
  });
});
