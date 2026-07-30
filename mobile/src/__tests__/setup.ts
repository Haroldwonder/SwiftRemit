/**
 * Global Jest test setup for SwiftRemit mobile.
 */

// Silence expected Expo/RN warnings during tests.
jest.spyOn(console, 'warn').mockImplementation((msg: string) => {
  if (
    typeof msg === 'string' &&
    (msg.includes('expo-notifications') ||
      msg.includes('Push notifications require') ||
      msg.includes('No EAS projectId'))
  ) {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(msg);
});
