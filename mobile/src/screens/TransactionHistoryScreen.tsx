/**
 * TransactionHistoryScreen — SR-187
 *
 * Changes from the previous unbounded implementation:
 * - Cursor-based pagination: first page loads on mount; subsequent pages
 *   append on FlatList.onEndReached rather than replacing state.
 * - readThroughCache is applied per-page so offline reads still work.
 * - Lightweight search bar (recipient name / agent / memo) and status
 *   filter strip consistent with the existing STATUS_LABELS / STATUS_COLORS maps.
 * - FlatList is tuned with initialNumToRender / windowSize / maxToRenderPerBatch
 *   to keep memory usage bounded for large histories.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as SecureStore from 'expo-secure-store';
import { remittanceService } from '../services/api';
import { readThroughCache } from '../services/offlineCache';
import OfflineBanner from '../components/OfflineBanner';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Remittance, RemittanceStatus } from '../types';

const PAGE_SIZE = 20;

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

type StatusFilter = RemittanceStatus | 'all';

const FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'pending_external', label: 'Processing' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'error', label: 'Failed' },
  { key: 'expired', label: 'Expired' },
];

export default function TransactionHistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Search / filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Prevent duplicate in-flight requests
  const loadingMoreRef = useRef(false);

  const loadPage = useCallback(
    async (opts: { cursor?: string; replace: boolean; wallet: string }) => {
      const { cursor, replace, wallet } = opts;
      const cacheKey = `history:${wallet}:p${cursor ?? '0'}`;

      const result = await readThroughCache(cacheKey, () =>
        remittanceService.getHistory(wallet, PAGE_SIZE, cursor),
      );

      const { remittances: page, nextCursor: next } = result.data;

      setRemittances((prev) => {
        if (replace) return page;
        // Deduplicate: keep only items whose IDs are not already present
        const existingIds = new Set(prev.map((r) => r.remittance_id));
        const fresh = page.filter((r) => !existingIds.has(r.remittance_id));
        return [...prev, ...fresh];
      });
      setNextCursor(next);
      setHasMore(!!next && page.length === PAGE_SIZE);
      if (replace) setCachedAt(result.fromCache ? result.cachedAt : null);
    },
    [],
  );

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const wallet = await SecureStore.getItemAsync('wallet_address');
        if (!wallet) return;
        await loadPage({ replace: true, wallet });
      } catch {
        // no live data and no cache available — keep whatever is on screen
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPage]);

  // Pull-to-refresh: reload from the first page
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const wallet = await SecureStore.getItemAsync('wallet_address');
      if (!wallet) return;
      await loadPage({ replace: true, wallet });
    } catch {
      // best effort
    } finally {
      setRefreshing(false);
    }
  }, [loadPage]);

  // Infinite scroll: load the next page
  const onEndReached = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !nextCursor) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const wallet = await SecureStore.getItemAsync('wallet_address');
      if (!wallet) return;
      await loadPage({ cursor: nextCursor, replace: false, wallet });
    } catch {
      // best effort
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [hasMore, loadPage, nextCursor]);

  // Client-side filtering applied on top of the paginated list
  const filtered = remittances.filter((r) => {
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      r.agent?.toLowerCase().includes(q) ||
      r.recipient_name?.toLowerCase().includes(q) ||
      r.memo?.toLowerCase().includes(q) ||
      r.remittance_id.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator testID="loading-indicator" size="large" color="#1A56DB" />
      </View>
    );
  }

  return (
    <FlatList
      testID="transaction-list"
      style={styles.container}
      data={filtered}
      keyExtractor={(item) => item.remittance_id}
      initialNumToRender={10}
      windowSize={5}
      maxToRenderPerBatch={10}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.3}
      ListHeaderComponent={
        <>
          <OfflineBanner />
          {cachedAt ? (
            <Text style={styles.staleText}>
              Showing cached data from {new Date(cachedAt).toLocaleString()}
            </Text>
          ) : null}

          {/* Search bar */}
          <View style={styles.searchRow}>
            <TextInput
              testID="search-input"
              style={styles.searchInput}
              placeholder="Search by recipient, agent or memo…"
              value={search}
              onChangeText={setSearch}
              clearButtonMode="while-editing"
              accessibilityLabel="Search transactions"
            />
          </View>

          {/* Status filter strip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={styles.filterRowContent}
          >
            {FILTER_OPTIONS.map(({ key, label }) => {
              const isActive = statusFilter === key;
              return (
                <TouchableOpacity
                  key={key}
                  testID={`filter-${key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`Filter by ${label}`}
                  style={[styles.filterPill, isActive && styles.filterPillActive]}
                  onPress={() => setStatusFilter(key)}
                >
                  <Text style={[styles.filterPillText, isActive && styles.filterPillTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No transfers found.</Text>
          <Text style={styles.emptySubtext}>
            {search || statusFilter !== 'all'
              ? 'Try adjusting your search or filter.'
              : 'Your transaction history will appear here.'}
          </Text>
        </View>
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator testID="load-more-indicator" size="small" color="#1A56DB" />
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() =>
            navigation.navigate('TransactionDetail', { remittanceId: item.remittance_id })
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
  staleText: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', paddingVertical: 8 },
  searchRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  searchInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#111827',
  },
  filterRow: { paddingBottom: 4 },
  filterRowContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
    marginRight: 8,
  },
  filterPillActive: {
    backgroundColor: '#1A56DB',
    borderColor: '#1A56DB',
  },
  filterPillText: { fontSize: 13, color: '#374151' },
  filterPillTextActive: { color: '#fff', fontWeight: '600' },
  footer: { paddingVertical: 16, alignItems: 'center' },
});
