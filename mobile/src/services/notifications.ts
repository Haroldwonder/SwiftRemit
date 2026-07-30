/**
 * Notification service — SR-095
 *
 * Responsibilities:
 *  1. Request / track / re-request push permission.
 *  2. Register the Expo push token with the backend on login.
 *  3. Deregister the token on logout.
 *  4. Configure the foreground notification handler (no PII/amounts shown).
 *  5. Provide a response handler factory that deep-links the user to the
 *     correct screen for each notification type.
 *  6. Handle cold-start navigation (token surfaced via
 *     Notifications.getLastNotificationResponseAsync).
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { NavigationContainerRef } from '@react-navigation/native';
import type { PushNotificationData } from '../types';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const PUSH_TOKEN_KEY = 'push_token';
const PUSH_PERMISSION_DENIED_KEY = 'push_permission_denied';

// ─── Foreground handler ───────────────────────────────────────────────────────
/**
 * Lock-screen / foreground notification handler.
 *
 * shouldShowAlert is intentionally true so the user sees a banner while using
 * the app, but the notification TITLE is the only visible content — no
 * financial amounts or PII are included (the backend sends only a generic
 * localised subject line).
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Android notification channels ───────────────────────────────────────────

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('remittance', {
    name: 'Transfer Updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1A56DB',
    showBadge: true,
    enableVibrate: true,
  });

  await Notifications.setNotificationChannelAsync('kyc', {
    name: 'Identity Verification',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1A56DB',
    showBadge: true,
    enableVibrate: true,
  });
}

// ─── Permission handling ──────────────────────────────────────────────────────

export type PermissionResult = 'granted' | 'denied' | 'undetermined';

/**
 * Request notification permission.
 * - If already granted, returns 'granted' immediately.
 * - If previously denied (tracked in SecureStore) returns 'denied' without
 *   a second prompt — callers should direct the user to Settings instead.
 * - Otherwise, requests from the OS.
 */
export async function requestNotificationPermission(): Promise<PermissionResult> {
  const { status: existing } = await Notifications.getPermissionsAsync();

  if (existing === 'granted') return 'granted';

  // Check if user already denied and we've recorded that.
  const prevDenied = await SecureStore.getItemAsync(PUSH_PERMISSION_DENIED_KEY);
  if (prevDenied === 'true') return 'denied';

  const { status } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      allowProvisional: false, // require explicit grant
    },
  });

  if (status === 'denied') {
    await SecureStore.setItemAsync(PUSH_PERMISSION_DENIED_KEY, 'true');
    return 'denied';
  }

  return status === 'granted' ? 'granted' : 'undetermined';
}

/**
 * Clear the "permission denied" flag so the next call to
 * requestNotificationPermission() will prompt again.
 * Call this when the user navigates to notification settings and comes back.
 */
export async function clearPermissionDeniedFlag(): Promise<void> {
  await SecureStore.deleteItemAsync(PUSH_PERMISSION_DENIED_KEY);
}

// ─── Token registration ───────────────────────────────────────────────────────

/**
 * Obtain the Expo push token (physical device only) and cache it in
 * SecureStore. Returns null on simulators or permission denial.
 */
export async function getOrFetchPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    if (__DEV__) console.info('[notifications] Simulator — skipping push token');
    return null;
  }

  const cached = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  if (cached) return cached;

  const status = await requestNotificationPermission();
  if (status !== 'granted') return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn('[notifications] No EAS projectId found in app.json');
    return null;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    return token;
  } catch (err) {
    console.error('[notifications] Failed to obtain push token:', err);
    return null;
  }
}

/**
 * Register the device push token with the backend.
 * Should be called after a successful login, once the auth token is stored.
 * No-op if the token can't be obtained (e.g. simulator, denied permission).
 */
export async function registerDeviceToken(
  registerWithBackend: (token: string, platform: 'ios' | 'android' | 'web') => Promise<void>,
): Promise<void> {
  const token = await getOrFetchPushToken();
  if (!token) return;

  const platform: 'ios' | 'android' | 'web' =
    Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

  try {
    await registerWithBackend(token, platform);
  } catch (err) {
    // Non-fatal — the user can still use the app; they just won't get pushes.
    console.error('[notifications] Failed to register token with backend:', err);
  }
}

/**
 * Deregister the device push token from the backend and clear the local cache.
 * Should be called during logout.
 */
export async function deregisterDeviceToken(
  deregisterFromBackend: (token: string) => Promise<void>,
): Promise<void> {
  const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  if (!token) return;

  try {
    await deregisterFromBackend(token);
  } catch (err) {
    console.error('[notifications] Failed to deregister token from backend:', err);
  } finally {
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  }
}

// ─── Deep-link routing ────────────────────────────────────────────────────────

/**
 * Route a notification tap to the correct screen.
 *
 * Backend sends a `data` object shaped as PushNotificationData:
 *   { type: 'remittance', remittanceId: string }
 *   { type: 'kyc' }
 *
 * We read this and navigate using the imperative navigation ref so this
 * logic is decoupled from the React tree (works in background/cold-start).
 */
export function handleNotificationNavigation(
  data: PushNotificationData,
  navigationRef: NavigationContainerRef<ReactNavigation.RootParamList>,
): void {
  if (!navigationRef.isReady()) return;

  if (data.type === 'remittance' && data.remittanceId) {
    navigationRef.navigate('TransactionDetail' as never, {
      remittanceId: data.remittanceId,
    } as never);
    return;
  }

  if (data.type === 'kyc') {
    // KycStatus lives as both a tab and a standalone stack screen.
    // Navigate to the standalone stack screen so we get a back button.
    navigationRef.navigate('KycStatus' as never);
    return;
  }
}

// ─── Listener factories ───────────────────────────────────────────────────────

/**
 * Subscribe to notifications received while the app is in the foreground.
 * No navigation occurs — the notification banner is shown by the system.
 * Use this hook if you want to trigger local state updates (e.g. badge count).
 */
export function addNotificationListener(
  handler: (notification: Notifications.Notification) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationReceivedListener(handler);
}

/**
 * Subscribe to notification response events (user tapped the notification).
 * Fires in both foreground and background states.
 */
export function addResponseListener(
  navigationRef: NavigationContainerRef<ReactNavigation.RootParamList>,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as PushNotificationData | undefined;
    if (!data) return;
    handleNotificationNavigation(data, navigationRef);
  });
}

/**
 * Handle cold-start: if the app was launched by tapping a notification,
 * getLastNotificationResponseAsync() returns that notification.
 * Call this once after the NavigationContainer is mounted and ready.
 */
export async function handleColdStartNotification(
  navigationRef: NavigationContainerRef<ReactNavigation.RootParamList>,
): Promise<void> {
  const lastResponse = await Notifications.getLastNotificationResponseAsync();
  if (!lastResponse) return;

  const data = lastResponse.notification.request.content.data as PushNotificationData | undefined;
  if (!data) return;

  // Small delay so the NavigationContainer finishes mounting.
  setTimeout(() => {
    handleNotificationNavigation(data, navigationRef);
  }, 300);
}
