/**
 * Tests for src/services/notifications.ts
 *
 * expo-notifications, expo-device, expo-constants and expo-secure-store are all
 * mocked globally in setup.ts.
 *
 * NOTE: SR-095 replaced `registerForPushNotificationsAsync()` with
 * `getOrFetchPushToken()` (same job, plus a SecureStore cache and a persisted
 * "permission denied" flag) and changed `addResponseListener()` from taking a
 * raw handler to taking the navigation ref it should deep-link through. The
 * cases below are the pre-SR-095 cases re-pointed at the current API.
 */
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import type { NavigationContainerRef } from '@react-navigation/native';

// expo-device is mocked globally in setup.ts, but `isDevice` has to be
// *switchable* here. Babel's `import * as Device` interop copies plain values
// once at require time, so a mutable flag only stays visible to the module
// under test if it is exposed as a getter.
const mockDeviceState = { isDevice: true };
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockDeviceState.isDevice;
  },
  deviceName: 'Test Device',
  osName: 'iOS',
  osVersion: '17.0',
}));

import {
  getOrFetchPushToken,
  addNotificationListener,
  addResponseListener,
} from '../../services/notifications';

const mockGetPermissions = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const mockGetToken = Notifications.getExpoPushTokenAsync as jest.Mock;
const mockAddReceived = Notifications.addNotificationReceivedListener as jest.Mock;
const mockAddResponse = Notifications.addNotificationResponseReceivedListener as jest.Mock;
const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;

describe('notifications.ts — getOrFetchPushToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeviceState.isDevice = true;
    // No cached token and no recorded permission denial.
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
  });

  it('returns the push token when permissions are already granted on a physical device', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc123]' });

    const token = await getOrFetchPushToken();
    expect(token).toBe('ExponentPushToken[abc123]');
    // Should not re-request permissions when already granted
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('caches the token in SecureStore and reuses it on the next call', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[cached]' });

    await getOrFetchPushToken();
    expect(mockSetItemAsync).toHaveBeenCalledWith('push_token', 'ExponentPushToken[cached]');

    mockGetItemAsync.mockResolvedValue('ExponentPushToken[cached]');
    mockGetToken.mockClear();
    const second = await getOrFetchPushToken();
    expect(second).toBe('ExponentPushToken[cached]');
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('requests permissions when they are not yet granted, then returns the token', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[xyz]' });

    const token = await getOrFetchPushToken();
    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(token).toBe('ExponentPushToken[xyz]');
  });

  it('returns null when the user denies permission', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const token = await getOrFetchPushToken();
    expect(token).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
    // The denial is recorded so the user is not prompted a second time.
    expect(mockSetItemAsync).toHaveBeenCalledWith('push_permission_denied', 'true');
  });

  it('returns null on a non-physical device (simulator/emulator)', async () => {
    mockDeviceState.isDevice = false;
    const token = await getOrFetchPushToken();
    expect(token).toBeNull();
    expect(mockGetPermissions).not.toHaveBeenCalled();
  });

  it('returns null when getExpoPushTokenAsync throws', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockRejectedValue(new Error('Token fetch failed'));

    const token = await getOrFetchPushToken();
    expect(token).toBeNull();
  });

  it('returns null when no projectId is configured', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'granted' });

    // Temporarily remove projectId from the Constants mock
    const Constants = require('expo-constants');
    const originalExtra = Constants.default?.expoConfig?.extra;
    if (Constants.default?.expoConfig) {
      Constants.default.expoConfig.extra = {};
    }
    if (Constants.expoConfig) {
      Constants.expoConfig.extra = {};
    }

    const token = await getOrFetchPushToken();
    expect(token).toBeNull();

    // Restore
    if (Constants.default?.expoConfig) {
      Constants.default.expoConfig.extra = originalExtra;
    }
    if (Constants.expoConfig) {
      Constants.expoConfig.extra = originalExtra;
    }
  });
});

describe('notifications.ts — addNotificationListener', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registers a notification received listener and returns the subscription', () => {
    const fakeSubscription = { remove: jest.fn() };
    mockAddReceived.mockReturnValue(fakeSubscription);
    const handler = jest.fn();

    const sub = addNotificationListener(handler);
    expect(mockAddReceived).toHaveBeenCalledWith(handler);
    expect(sub).toBe(fakeSubscription);
  });
});

describe('notifications.ts — addResponseListener', () => {
  const navigate = jest.fn();
  const navigationRef = {
    isReady: () => true,
    navigate,
  } as unknown as NavigationContainerRef<ReactNavigation.RootParamList>;

  beforeEach(() => jest.clearAllMocks());

  it('registers a notification response listener and returns the subscription', () => {
    const fakeSubscription = { remove: jest.fn() };
    mockAddResponse.mockReturnValue(fakeSubscription);

    const sub = addResponseListener(navigationRef);
    expect(mockAddResponse).toHaveBeenCalledWith(expect.any(Function));
    expect(sub).toBe(fakeSubscription);
  });

  it('deep-links a tapped remittance notification through the navigation ref', () => {
    mockAddResponse.mockReturnValue({ remove: jest.fn() });
    addResponseListener(navigationRef);

    const registeredHandler = mockAddResponse.mock.calls[0][0];
    registeredHandler({
      notification: {
        request: {
          content: { data: { type: 'remittance', remittanceId: 'rm-1' } },
        },
      },
    });

    expect(navigate).toHaveBeenCalledWith('TransactionDetail', { remittanceId: 'rm-1' });
  });
});

describe('PII / amount lock-screen safety contract', () => {
  it('notification data payload contains only type and remittanceId — no amounts', () => {
    const payload = { type: 'remittance', remittanceId: 'rem_abc' };
    expect(payload).not.toHaveProperty('amount');
    expect(payload).not.toHaveProperty('currency');
    expect(payload).not.toHaveProperty('senderName');
    expect(payload).not.toHaveProperty('recipientName');
  });

  it('kyc notification data contains only type — no user details', () => {
    const payload = { type: 'kyc' };
    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('kycDetails');
  });
});
