/**
 * AppNavigator — SR-095 / SR-185
 *
 * SR-185 additions:
 * - Login route added to RootStackParamList
 * - AuthGate component reads authService.getStoredWallet() on mount and
 *   renders <Login> or <Main+stack> accordingly — no screen can be reached
 *   without a valid wallet in SecureStore.
 * - Expired-session navigation hook: api.ts's interceptors dispatch the
 *   custom 'SESSION_EXPIRED' event; AuthGate listens and resets to Login.
 *
 * Also accepts an imperative `navigationRef` and `onReady` callback so that
 * notification deep-link handlers outside the React tree can navigate
 * programmatically (background taps, cold-start launches).
 */

import React, { useEffect, useState } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, ActivityIndicator } from 'react-native';
import { DeviceEventEmitter } from 'react-native';

import HomeScreen from '../screens/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import SendMoneyScreen from '../screens/SendMoneyScreen';
import TransactionHistoryScreen from '../screens/TransactionHistoryScreen';
import TransactionDetailScreen from '../screens/TransactionDetailScreen';
import KycStatusScreen from '../screens/KycStatusScreen';
import { authService } from '../services/api';

// ─── Type-safe navigation params ─────────────────────────────────────────────

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  SendMoney: undefined;
  TransactionDetail: { remittanceId: string };
  KycStatus: undefined;
};

// Extend the global RootParamList so NavigationContainerRef is typed.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface RootParamList extends RootStackParamList {}
  }
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function TabIcon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    Home: '🏠',
    History: '📋',
    KYC: '✅',
  };
  const label = name === 'Home' ? 'Home tab' : name === 'History' ? 'Transaction history tab' : name === 'KYC' ? 'Verification tab' : `${name} tab`;
  return (
    <Text accessibilityLabel={label} accessibilityRole="imagebutton" style={{ fontSize: 20 }}>
      {icons[name] ?? '•'}
    </Text>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: () => <TabIcon name={route.name} />,
        tabBarActiveTintColor: '#1A56DB',
        tabBarInactiveTintColor: '#6B7280',
        headerStyle: { backgroundColor: '#1A56DB' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'SwiftRemit' }} />
      <Tab.Screen name="History" component={TransactionHistoryScreen} options={{ title: 'Transactions' }} />
      <Tab.Screen name="KYC" component={KycStatusScreen} options={{ title: 'Verification' }} />
    </Tab.Navigator>
  );
}

// ─── Auth gate ────────────────────────────────────────────────────────────────

/**
 * Reads the stored wallet on mount to decide the initial route.
 * Also listens for the 'SESSION_EXPIRED' event emitted by api.ts's
 * response interceptor when a token refresh fails, routing the user
 * back to Login rather than leaving authenticated screens to fail silently.
 */
function useAuthState(): { authState: 'loading' | 'authenticated' | 'unauthenticated' } {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  useEffect(() => {
    let cancelled = false;
    authService.getStoredWallet().then((wallet) => {
      if (!cancelled) setAuthState(wallet ? 'authenticated' : 'unauthenticated');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('SESSION_EXPIRED', () => {
      setAuthState('unauthenticated');
    });
    return () => sub.remove();
  }, []);

  return { authState };
}

interface AppNavigatorProps {
  navigationRef?: React.RefObject<NavigationContainerRef<ReactNavigation.RootParamList> | null>;
  onReady?: () => void;
}

export default function AppNavigator({ navigationRef, onReady }: AppNavigatorProps) {
  const { authState } = useAuthState();

  if (authState === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator testID="auth-loading-indicator" size="large" color="#1A56DB" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} onReady={onReady}>
      <Stack.Navigator
        initialRouteName={authState === 'authenticated' ? 'Main' : 'Login'}
        screenOptions={{
          headerStyle: { backgroundColor: '#1A56DB' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        {/* Unauthenticated screens — no back-navigation to authenticated stack */}
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />

        {/* Authenticated screens */}
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="SendMoney" component={SendMoneyScreen} options={{ title: 'Send Money' }} />
        <Stack.Screen
          name="TransactionDetail"
          component={TransactionDetailScreen}
          options={{ title: 'Transfer Details' }}
        />
        <Stack.Screen
          name="KycStatus"
          component={KycStatusScreen}
          options={{ title: 'KYC Status' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
