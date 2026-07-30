import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '../services/offlineCache';

export default function OfflineBanner() {
  const { isOffline, isReconnecting } = useNetworkStatus();

  if (!isOffline && !isReconnecting) return null;

  return (
    <View style={[styles.banner, isReconnecting ? styles.reconnecting : styles.offline]}>
      <Text style={styles.text}>
        {isReconnecting ? 'Reconnecting…' : "You're offline — showing cached data"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: 8, paddingHorizontal: 16 },
  offline: { backgroundColor: '#EF4444' },
  reconnecting: { backgroundColor: '#F59E0B' },
  text: { color: '#fff', fontWeight: '600', fontSize: 13, textAlign: 'center' },
});
