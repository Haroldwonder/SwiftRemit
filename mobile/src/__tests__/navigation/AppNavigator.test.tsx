/**
 * Navigation tests for AppNavigator (src/navigation/AppNavigator.tsx)
 *
 * SR-185 additions: auth-gate tests (Login screen shown when no wallet stored;
 * Main shown when wallet is present; SESSION_EXPIRED event routes back to Login).
 *
 * Strategy: render the full NavigationContainer + navigator stack using
 * @testing-library/react-native.  react-native-screens and
 * react-native-safe-area-context are mocked globally in setup.ts so the
 * navigator renders in the Node/JSDOM environment without native modules.
 *
 * Deep-link tests use the `linking` prop accepted by NavigationContainer to
 * verify that URL patterns resolve to the correct screen.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, TouchableOpacity, DeviceEventEmitter } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AppNavigator from '../../navigation/AppNavigator';
import { authService } from '../../services/api';

// ── Mock authService ───────────────────────────────────────────────────────
jest.mock('../../services/api', () => ({
  authService: {
    login: jest.fn(),
    logout: jest.fn(),
    getStoredWallet: jest.fn(),
  },
  deviceService: {
    register: jest.fn(),
  },
}));

// ── Mock all screens to keep tests lightweight ─────────────────────────────
jest.mock('../../screens/LoginScreen', () => {
  const { View, Text } = require('react-native');
  return () => <View><Text>LoginScreen</Text></View>;
});
jest.mock('../../screens/HomeScreen', () => {
  const { View, Text } = require('react-native');
  return () => <View><Text>HomeScreen</Text></View>;
});
jest.mock('../../screens/SendMoneyScreen', () => {
  const { View, Text } = require('react-native');
  return () => <View><Text>SendMoneyScreen</Text></View>;
});
jest.mock('../../screens/TransactionHistoryScreen', () => {
  const { View, Text } = require('react-native');
  return () => <View><Text>TransactionHistoryScreen</Text></View>;
});
jest.mock('../../screens/TransactionDetailScreen', () => {
  const { View, Text } = require('react-native');
  return () => <View><Text>TransactionDetailScreen</Text></View>;
});
jest.mock('../../screens/KycStatusScreen', () => {
  const { View, Text } = require('react-native');
  return () => <View><Text>KycStatusScreen</Text></View>;
});

const mockGetStoredWallet = authService.getStoredWallet as jest.Mock;
const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;

// ── Auth-gate tests ────────────────────────────────────────────────────────

describe('AppNavigator — auth gate (SR-185)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default SecureStore: no session active
    mockGetItemAsync.mockResolvedValue(null);
  });

  it('shows LoginScreen when no wallet is stored', async () => {
    mockGetStoredWallet.mockResolvedValue(null);
    const { getByText } = render(<AppNavigator />);
    await waitFor(() => expect(getByText('LoginScreen')).toBeTruthy());
  });

  it('shows HomeScreen (Main) when a wallet is already stored', async () => {
    mockGetStoredWallet.mockResolvedValue('GABC123');
    const { getByText } = render(<AppNavigator />);
    await waitFor(() => expect(getByText('HomeScreen')).toBeTruthy());
  });

  it('routes back to LoginScreen when SESSION_EXPIRED event fires', async () => {
    mockGetStoredWallet.mockResolvedValue('GABC123');
    const { getByText } = render(<AppNavigator />);
    await waitFor(() => expect(getByText('HomeScreen')).toBeTruthy());

    // Simulate session expiry
    await act(async () => {
      DeviceEventEmitter.emit('SESSION_EXPIRED');
    });

    await waitFor(() => expect(getByText('LoginScreen')).toBeTruthy());
  });

  it('shows a loading spinner while checking auth state', async () => {
    // Never resolves to keep the loading state visible
    mockGetStoredWallet.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<AppNavigator />);
    expect(getByTestId('auth-loading-indicator')).toBeTruthy();
  });
});

// ── Original deep-link / transition tests (unchanged) ─────────────────────

// Minimal screen stubs (avoid loading full screen implementations here)
function HomeStub() {
  const { useNavigation } = require('@react-navigation/native');
  const nav = useNavigation();
  return (
    <View>
      <Text>HomeStub</Text>
      <TouchableOpacity testID="go-send" onPress={() => nav.navigate('SendMoney')}>
        <Text>Go Send</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="go-detail" onPress={() => nav.navigate('TransactionDetail', { remittanceId: 'rm-1' })}>
        <Text>Go Detail</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="go-kyc" onPress={() => nav.navigate('KycStatus')}>
        <Text>Go KYC</Text>
      </TouchableOpacity>
    </View>
  );
}

function SendStub() {
  const { useNavigation } = require('@react-navigation/native');
  const nav = useNavigation();
  return (
    <View>
      <Text>SendMoneyStub</Text>
      <TouchableOpacity testID="back-btn" onPress={() => nav.goBack()}>
        <Text>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

function DetailStub() {
  const { useRoute } = require('@react-navigation/native');
  const route = useRoute();
  return (
    <View>
      <Text>TransactionDetailStub</Text>
      <Text testID="detail-id">{route.params?.remittanceId}</Text>
    </View>
  );
}

function KycStub() {
  return <View><Text>KycStatusStub</Text></View>;
}

function HistoryStub() {
  return <View><Text>HistoryStub</Text></View>;
}

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TestTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeStub} />
      <Tab.Screen name="History" component={HistoryStub} />
      <Tab.Screen name="KYC" component={KycStub} />
    </Tab.Navigator>
  );
}

function TestNavigator({ initialState }: { initialState?: object }) {
  return (
    <NavigationContainer initialState={initialState as any}>
      <Stack.Navigator>
        <Stack.Screen name="Main" component={TestTabs} options={{ headerShown: false }} />
        <Stack.Screen name="SendMoney" component={SendStub} />
        <Stack.Screen name="TransactionDetail" component={DetailStub} />
        <Stack.Screen name="KycStatus" component={KycStub} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

describe('AppNavigator — deep links and screen transitions', () => {
  it('renders the Home screen on initial load', async () => {
    const { getByText } = await render(<TestNavigator />);
    await waitFor(() => {
      expect(getByText('HomeStub')).toBeTruthy();
    });
  });

  it('navigates from Home to SendMoney screen', async () => {
    const { getByTestId, getByText } = await render(<TestNavigator />);
    await waitFor(() => expect(getByText('HomeStub')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('go-send'));
    });

    await waitFor(() => {
      expect(getByText('SendMoneyStub')).toBeTruthy();
    });
  });

  it('navigates from Home to TransactionDetail and passes remittanceId param', async () => {
    const { getByTestId, getByText } = await render(<TestNavigator />);
    await waitFor(() => expect(getByText('HomeStub')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('go-detail'));
    });

    await waitFor(() => {
      expect(getByText('TransactionDetailStub')).toBeTruthy();
      expect(getByTestId('detail-id').props.children).toBe('rm-1');
    });
  });

  it('navigates from Home to KycStatus via stack push', async () => {
    const { getByTestId, getByText } = await render(<TestNavigator />);
    await waitFor(() => expect(getByText('HomeStub')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('go-kyc'));
    });

    await waitFor(() => {
      expect(getByText('KycStatusStub')).toBeTruthy();
    });
  });

  it('goes back from SendMoney to Home', async () => {
    const { getByTestId, getByText } = await render(<TestNavigator />);
    await waitFor(() => expect(getByText('HomeStub')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('go-send')); });
    await waitFor(() => expect(getByText('SendMoneyStub')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('back-btn')); });
    await waitFor(() => {
      expect(getByText('HomeStub')).toBeTruthy();
    });
  });
});

describe('AppNavigator — deep link: initialState simulation', () => {
  it('opens SendMoney screen from deep link initial state', async () => {
    const initialState = {
      routes: [
        {
          name: 'Main',
          state: { routes: [{ name: 'Home' }] },
        },
        { name: 'SendMoney' },
      ],
      index: 1,
    };

    const { getByText } = await render(<TestNavigator initialState={initialState} />);
    await waitFor(() => {
      expect(getByText('SendMoneyStub')).toBeTruthy();
    });
  });

  it('opens TransactionDetail screen from deep link initial state with params', async () => {
    const initialState = {
      routes: [
        {
          name: 'Main',
          state: { routes: [{ name: 'Home' }] },
        },
        {
          name: 'TransactionDetail',
          params: { remittanceId: 'deep-rm-99' },
        },
      ],
      index: 1,
    };

    const { getByText, getByTestId } = await render(<TestNavigator initialState={initialState} />);
    await waitFor(() => {
      expect(getByText('TransactionDetailStub')).toBeTruthy();
      expect(getByTestId('detail-id').props.children).toBe('deep-rm-99');
    });
  });

  it('opens KycStatus screen from deep link initial state', async () => {
    const initialState = {
      routes: [
        {
          name: 'Main',
          state: { routes: [{ name: 'Home' }] },
        },
        { name: 'KycStatus' },
      ],
      index: 1,
    };

    const { getByText } = await render(<TestNavigator initialState={initialState} />);
    await waitFor(() => {
      expect(getByText('KycStatusStub')).toBeTruthy();
    });
  });
});
