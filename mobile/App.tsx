import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerForPushNotificationsAsync, addResponseListener } from './src/services/notifications';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        // Store the token so we can send it to the backend when authenticated
        // SecureStore.setItemAsync('push_token', token)
        console.log('Push token:', token);
      }
    });

    responseListenerRef.current = addResponseListener((response) => {
      const { data } = response.notification.request.content;
      // Handle deep link from notification tap (e.g. open transaction detail)
      if (data?.remittanceId) {
        // Navigation handled via notification routing
        console.log('Notification tapped for remittance:', data.remittanceId);
      }
    });

    return () => {
      responseListenerRef.current?.remove();
    };
  }, []);

  return <AppNavigator />;
}
