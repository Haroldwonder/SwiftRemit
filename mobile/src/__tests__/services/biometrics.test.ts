/**
 * Tests for src/services/biometrics.ts
 *
 * expo-local-authentication is mocked globally in setup.ts.
 * Each test overrides individual mock return values as needed.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { isBiometricAvailable, authenticateWithBiometrics } from '../../services/biometrics';

const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
const mockAuthenticate = LocalAuthentication.authenticateAsync as jest.Mock;

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
    // isEnrolledAsync should not be called if hardware is absent
    expect(mockIsEnrolled).not.toHaveBeenCalled();
  });

  it('returns false when hardware is present but no biometrics are enrolled', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(false);
    expect(await isBiometricAvailable()).toBe(false);
  });
});

describe('biometrics.ts — authenticateWithBiometrics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when biometrics are available and authentication succeeds', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });

    const result = await authenticateWithBiometrics('Confirm transfer');
    expect(result).toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledWith({
      promptMessage: 'Confirm transfer',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
  });

  it('returns false when biometrics are available but authentication fails', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: false, error: 'user_cancel' });

    expect(await authenticateWithBiometrics()).toBe(false);
  });

  it('returns true (fall-through) when biometrics are not available on the device', async () => {
    mockHasHardware.mockResolvedValue(false);
    // authenticateAsync should never be called
    const result = await authenticateWithBiometrics();
    expect(result).toBe(true);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('uses the default prompt message when none is provided', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });

    await authenticateWithBiometrics();
    expect(mockAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'Confirm transaction with biometrics' })
    );
  });

  it('returns true (fall-through) when hardware is present but no enrollment', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(false);

    const result = await authenticateWithBiometrics();
    expect(result).toBe(true);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
