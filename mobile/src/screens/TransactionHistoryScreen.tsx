import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import { remittanceService } from '../services/api';
import { Remittance, RemittanceStatus } from '../types';

const STATUS_COLORS: Record<RemittanceStatus, string> = {
  pending_user_transfer_start: '#F59E0B',
  pending_external: '#F59E0B',
  pending_anchor: '#F59E0B',
  completed: '#10B981',
  refunded: '#6B7280',
  expired: '#EF4444',
  error: '#EF4444',
};

const STATUS_LABELS: Record<RemittanceStatus, string> = {
  pending_user_transfer_start: 'Pending',
  pending_external: 'Processing',
  pending_anchor: 'Processing',
  completed: 'Completed',
  refunded: 'Refunded',
  expired: 'Expired',
  error: 'Failed',
};

export default function TransactionHistoryScreen() {
  const navigation = useNavigation();
  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const wallet = await SecureStore.getItemAsync('wallet_address');
      if (!wallet) return;
      const data = await remittanceService.getHistory(wallet);
      setRemittances(data);
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1A56DB" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={remittances}
      keyExtractor={(item) => item.remittance_id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No transfers yet.</Text>
          <Text style={styles.emptySubtext}>Your transaction history will appear here.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() =>
            navigation.navigate('TransactionDetail' as never, { remittanceId: item.remittance_id } as never)
          }
        >
          <View style={styles.cardLeft}>
            <Text style={styles.amount}>${parseFloat(item.amount).toFixed(2)} USD</Text>
            <Text style={styles.agent}>{item.agent}</Text>
            <Text style={styles.date}>{new Date(item.created_at).toLocaleDateString()}</Text>
          </View>
          <View>
            <View style={[styles.badge, { backgroundColor: `${STATUS_COLORS[item.status]}22` }]}>
              <Text style={[styles.badgeText, { color: STATUS_COLORS[item.status] }]}>
                {STATUS_LABELS[item.status]}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  cardLeft: { flex: 1 },
  amount: { fontSize: 18, fontWeight: '700', color: '#111827' },
  agent: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  date: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  separator: { height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 20 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#374151' },
  emptySubtext: { fontSize: 14, color: '#9CA3AF', marginTop: 8 },
});
