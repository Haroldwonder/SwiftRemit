/**
 * App entry-point — SR-095
 *
 * Wires together:
 *  - Navigation (imperative ref passed to notification handlers)
 *  - Push notification channel setup (Android)
 *  - Permission request
 *  - Token registration with the backend
 *  - Cold-start deep-link handling
 *  - Foreground / background notification response handling
 */

import React, { useEffect, useRef } from 'react';
import type { NavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import AppNavigator from './src/navigation/AppNavigator';
import { deviceService } from './src/services/api';
import {
  setupNotificationChannels,
  registerDeviceToken,
  addNotificationListener,
  handleNotificationNavigation,
  handleColdStartNotification,
} from './src/services/notifications';
import type { PushNotificationData } from './src/types';

export default function App() {
  // Imperative nav ref — shared with notification handlers so they can
  // navigate without being inside the React tree.
  const navigationRef = useRef<NavigationContainerRef<ReactNavigation.RootParamList>>(null);

  const notificationListenerRef = useRef<Notifications.EventSubscription | null>(null);
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // 1. Set up Android notification channels.
    setupNotificationChannels();

    // 2. Register push token with the backend.
    //    registerDeviceToken() requests permission internally if needed and
    //    caches the token in SecureStore. It is a no-op on simulators.
    registerDeviceToken(deviceService.register);

    // 3. Subscribe to foreground notifications (for badge / state updates).
    notificationListenerRef.current = addNotificationListener((_notification) => {
      // Foreground receipt — the system shows a banner automatically.
      // Add any in-app state refresh logic here (e.g. refetch transaction list).
    });

    // 4. Subscribe to user-tapped notification responses.
    //    We capture navigationRef in a closure so the subscription always
    //    has access to the latest (mounted) ref value.
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as
          | PushNotificationData
          | undefined;
        if (!data || !navigationRef.current) return;
        handleNotificationNavigation(data, navigationRef.current);
      },
    );

    return () => {
      notificationListenerRef.current?.remove();
      responseListenerRef.current?.remove();
    };
  }, []);

  /**
   * Called by NavigationContainer once the navigator is ready.
   * Handles cold-start: if the app was opened by tapping a notification
   * that arrived while the app was completely closed, we deep-link now.
   */
  const onNavigationReady = () => {
    if (!navigationRef.current) return;
    handleColdStartNotification(navigationRef.current);
  };

  return (
    <AppNavigator
      navigationRef={navigationRef}
      onReady={onNavigationReady}
    />
  );
}
