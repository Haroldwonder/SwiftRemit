/**
 * Jest global setup — runs before every test file.
 *
 * All Expo/React-Native native modules that are unavailable in the Node test
 * environment are mocked here so tests never call native code. Individual test
 * files may still re-declare any of these with their own `jest.mock(...)`; a
 * mock registered inside a test file wins over the one registered here.
 */

// ── expo-secure-store ──────────────────────────────────────────────────────
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// ── expo-local-authentication ──────────────────────────────────────────────
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn().mockResolvedValue(true),
  isEnrolledAsync: jest.fn().mockResolvedValue(true),
  authenticateAsync: jest.fn().mockResolvedValue({ success: true }),
  supportedAuthenticationTypesAsync: jest.fn().mockResolvedValue([1, 2]),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

// ── expo-notifications ─────────────────────────────────────────────────────
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addNotificationReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notification-id'),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
}));

// ── expo-device ────────────────────────────────────────────────────────────
jest.mock('expo-device', () => ({
  isDevice: true,
  deviceName: 'Test Device',
  osName: 'iOS',
  osVersion: '17.0',
}));

// ── expo-crypto ────────────────────────────────────────────────────────────
jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn().mockResolvedValue('mocked-digest-hash'),
  CryptoDigestAlgorithm: {
    SHA1: 'SHA1',
    SHA256: 'SHA256',
    MD5: 'MD5',
  },
}));

// ── expo-constants ─────────────────────────────────────────────────────────
jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'http://localhost:3000',
        eas: { projectId: 'test-project-id' },
      },
    },
    easConfig: { projectId: 'test-project-id' },
  },
  expoConfig: {
    extra: {
      apiUrl: 'http://localhost:3000',
      eas: { projectId: 'test-project-id' },
    },
  },
}));

// ── axios ──────────────────────────────────────────────────────────────────
jest.mock('axios', () => {
  const mockAxios: any = {
    create: jest.fn(() => mockAxios),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return { default: mockAxios, ...mockAxios };
});

// ── react-native Linking ───────────────────────────────────────────────────
// react-native's index re-exports this module's `default`, so the mock has to
// provide one — otherwise `Linking` is undefined at every call site.
jest.mock('react-native/Libraries/Linking/Linking', () => {
  const linking = {
    openURL: jest.fn().mockResolvedValue(undefined),
    canOpenURL: jest.fn().mockResolvedValue(true),
    getInitialURL: jest.fn().mockResolvedValue(null),
    addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    removeAllListeners: jest.fn(),
    sendIntent: jest.fn().mockResolvedValue(undefined),
    openSettings: jest.fn().mockResolvedValue(undefined),
  };
  return { __esModule: true, default: linking, ...linking };
});

// ── @react-navigation/native ───────────────────────────────────────────────
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: jest.fn(() => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      canGoBack: jest.fn(() => true),
      dispatch: jest.fn(),
      reset: jest.fn(),
    })),
    useRoute: jest.fn(() => ({
      params: { remittanceId: 'test-remittance-id' },
      key: 'test-key',
      name: 'TestScreen',
    })),
    useFocusEffect: jest.fn((cb) => cb()),
  };
});

// ── react-native-safe-area-context ─────────────────────────────────────────
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: any) => children,
    SafeAreaView: View,
    useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
    useSafeAreaFrame: jest.fn(() => ({ x: 0, y: 0, width: 390, height: 844 })),
  };
});

// ── react-native-screens ───────────────────────────────────────────────────
jest.mock('react-native-screens', () => ({
  enableScreens: jest.fn(),
  enableFreeze: jest.fn(),
  Screen: require('react-native').View,
  ScreenContainer: require('react-native').View,
}));

// ── @react-native-community/netinfo ────────────────────────────────────────
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
  addEventListener: jest.fn().mockReturnValue(jest.fn()),
  useNetInfo: jest.fn(() => ({ isConnected: true, isInternetReachable: true })),
}));

// ── @react-native-async-storage/async-storage ──────────────────────────────
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
  getAllKeys: jest.fn().mockResolvedValue([]),
  clear: jest.fn().mockResolvedValue(undefined),
}));

// ── Console noise ──────────────────────────────────────────────────────────
// Silence expected Expo/RN warnings during tests. The original implementation
// is captured *before* the spy is installed — calling `console.warn` from
// inside the spy body would otherwise recurse into the spy itself until the
// call stack overflowed.
const originalWarn = console.warn.bind(console);
jest.spyOn(console, 'warn').mockImplementation((msg: unknown, ...rest: unknown[]) => {
  if (
    typeof msg === 'string' &&
    (msg.includes('expo-notifications') ||
      msg.includes('Push notifications require') ||
      msg.includes('No EAS projectId'))
  ) {
    return;
  }
  originalWarn(msg, ...rest);
});
