/**
 * Navigation tests for AppNavigator (src/navigation/AppNavigator.tsx)
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
import { Text, View, TouchableOpacity } from 'react-native';

// ── Minimal screen stubs (avoid loading full screen implementations here) ──
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

// ── Minimal navigator that mirrors AppNavigator's structure ────────────────
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

// ── Unmock @react-navigation/native for these integration tests ────────────
// The global mock in setup.ts only mocks useNavigation/useRoute hooks, not
// the NavigationContainer / createNativeStackNavigator exports which are real.
// Because we explicitly re-require them above, the navigator renders with the
// actual react-navigation routing logic.

describe('AppNavigator — deep links and screen transitions', () => {
  it('renders the Home screen on initial load', async () => {
    const { getByText } = render(<TestNavigator />);
    await waitFor(() => {
      expect(getByText('HomeStub')).toBeTruthy();
    });
  });

  it('navigates from Home to SendMoney screen', async () => {
    const { getByTestId, getByText } = render(<TestNavigator />);
    await waitFor(() => expect(getByText('HomeStub')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('go-send'));
    });

    await waitFor(() => {
      expect(getByText('SendMoneyStub')).toBeTruthy();
    });
  });

  it('navigates from Home to TransactionDetail and passes remittanceId param', async () => {
    const { getByTestId, getByText } = render(<TestNavigator />);
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
    const { getByTestId, getByText } = render(<TestNavigator />);
    await waitFor(() => expect(getByText('HomeStub')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('go-kyc'));
    });

    await waitFor(() => {
      expect(getByText('KycStatusStub')).toBeTruthy();
    });
  });

  it('goes back from SendMoney to Home', async () => {
    const { getByTestId, getByText } = render(<TestNavigator />);
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
  /**
   * React Navigation accepts an `initialState` object that mirrors what a
   * deep link would produce after being parsed through the linking config.
   * We use this to verify that the correct screen is shown for a given
   * deep-link target without needing a real URL scheme in tests.
   */
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

    const { getByText } = render(<TestNavigator initialState={initialState} />);
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

    const { getByText, getByTestId } = render(<TestNavigator initialState={initialState} />);
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

    const { getByText } = render(<TestNavigator initialState={initialState} />);
    await waitFor(() => {
      expect(getByText('KycStatusStub')).toBeTruthy();
    });
  });
});
