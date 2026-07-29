/**
 * Tests for src/services/notifications.ts
 *
 * expo-notifications, expo-device, and expo-constants are all mocked
 * globally in setup.ts.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import {
  registerForPushNotificationsAsync,
  addNotificationListener,
  addResponseListener,
} from '../../services/notifications';

const mockGetPermissions = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const mockGetToken = Notifications.getExpoPushTokenAsync as jest.Mock;
const mockAddReceived = Notifications.addNotificationReceivedListener as jest.Mock;
const mockAddResponse = Notifications.addNotificationResponseReceivedListener as jest.Mock;

describe('notifications.ts — registerForPushNotificationsAsync', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the push token when permissions are already granted on a physical device', async () => {
    (Device as any).isDevice = true;
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc123]' });

    const token = await registerForPushNotificationsAsync();
    expect(token).toBe('ExponentPushToken[abc123]');
    // Should not re-request permissions when already granted
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('requests permissions when they are not yet granted, then returns the token', async () => {
    (Device as any).isDevice = true;
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[xyz]' });

    const token = await registerForPushNotificationsAsync();
    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(token).toBe('ExponentPushToken[xyz]');
  });

  it('returns null when the user denies permission', async () => {
    (Device as any).isDevice = true;
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const token = await registerForPushNotificationsAsync();
    expect(token).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('returns null on a non-physical device (simulator/emulator)', async () => {
    (Device as any).isDevice = false;
    const token = await registerForPushNotificationsAsync();
    expect(token).toBeNull();
    expect(mockGetPermissions).not.toHaveBeenCalled();
  });

  it('returns null when getExpoPushTokenAsync throws', async () => {
    (Device as any).isDevice = true;
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockRejectedValue(new Error('Token fetch failed'));

    const token = await registerForPushNotificationsAsync();
    expect(token).toBeNull();
  });

  it('returns null when no projectId is configured', async () => {
    (Device as any).isDevice = true;
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

    const token = await registerForPushNotificationsAsync();
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
  beforeEach(() => jest.clearAllMocks());

  it('registers a notification response listener and returns the subscription', () => {
    const fakeSubscription = { remove: jest.fn() };
    mockAddResponse.mockReturnValue(fakeSubscription);
    const handler = jest.fn();

    const sub = addResponseListener(handler);
    expect(mockAddResponse).toHaveBeenCalledWith(handler);
    expect(sub).toBe(fakeSubscription);
  });
});
