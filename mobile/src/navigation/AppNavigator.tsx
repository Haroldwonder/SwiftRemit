/**
 * AppNavigator — SR-095
 *
 * Accepts an imperative `navigationRef` and `onReady` callback so that
 * notification deep-link handlers outside the React tree can navigate
 * programmatically (background taps, cold-start launches).
 */

import React from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import HomeScreen from '../screens/HomeScreen';
import SendMoneyScreen from '../screens/SendMoneyScreen';
import TransactionHistoryScreen from '../screens/TransactionHistoryScreen';
import TransactionDetailScreen from '../screens/TransactionDetailScreen';
import KycStatusScreen from '../screens/KycStatusScreen';

// ─── Type-safe navigation params ─────────────────────────────────────────────

export type RootStackParamList = {
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
  return <Text style={{ fontSize: 20 }}>{icons[name] ?? '•'}</Text>;
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

interface AppNavigatorProps {
  navigationRef?: React.RefObject<NavigationContainerRef<ReactNavigation.RootParamList>>;
  onReady?: () => void;
}

export default function AppNavigator({ navigationRef, onReady }: AppNavigatorProps) {
  return (
    <NavigationContainer ref={navigationRef} onReady={onReady}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1A56DB' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
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
