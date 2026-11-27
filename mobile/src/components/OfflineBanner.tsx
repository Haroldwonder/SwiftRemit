import { useThemedStyles, useAppTheme } from '../theme';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '../services/offlineCache';

export default function OfflineBanner() {
  const styles = useThemedStyles(baseStyles);
  const { isOffline, isReconnecting } = useNetworkStatus();
  const { colors } = useAppTheme();

  if (!isOffline && !isReconnecting) return null;

  return (
    <View style={[styles.banner, { backgroundColor: isReconnecting ? colors.reconnecting : colors.offline }]}>
      <Text style={styles.text}>
        {isReconnecting ? 'Reconnecting…' : "You're offline — showing cached data"}
      </Text>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  banner: { paddingVertical: 8, paddingHorizontal: 16 },
  offline: { backgroundColor: '#EF4444' },
  reconnecting: { backgroundColor: '#F59E0B' },
  text: { color: '#fff', fontWeight: '600', fontSize: 13, textAlign: 'center' },
});
