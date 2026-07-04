import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { remittanceService } from '../services/api';
import { Remittance, RemittanceStatus } from '../types';

type DetailRouteParams = { remittanceId: string };

const STATUS_STEPS: RemittanceStatus[] = [
  'pending_user_transfer_start',
  'pending_external',
  'pending_anchor',
  'completed',
];

export default function TransactionDetailScreen() {
  const route = useRoute<RouteProp<Record<string, DetailRouteParams>, string>>();
  const { remittanceId } = route.params;
  const [remittance, setRemittance] = useState<Remittance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    remittanceService
      .getById(remittanceId)
      .then(setRemittance)
      .finally(() => setLoading(false));
  }, [remittanceId]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#1A56DB" /></View>;
  if (!remittance) return <View style={styles.center}><Text>Transfer not found.</Text></View>;

  const stepIndex = STATUS_STEPS.indexOf(remittance.status as RemittanceStatus);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Transfer Details</Text>

      <View style={styles.progressRow}>
        {STATUS_STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <View style={[styles.dot, i <= stepIndex ? styles.dotDone : styles.dotPending]} />
            {i < STATUS_STEPS.length - 1 && (
              <View style={[styles.line, i < stepIndex ? styles.lineDone : styles.linePending]} />
            )}
          </React.Fragment>
        ))}
      </View>

      <View style={styles.card}>
        <Row label="Transfer ID" value={remittance.remittance_id} />
        <Row label="Amount" value={`$${parseFloat(remittance.amount).toFixed(2)} USD`} />
        <Row label="Status" value={remittance.status.replace(/_/g, ' ')} />
        {remittance.memo ? <Row label="Memo" value={remittance.memo} /> : null}
        <Row label="Created" value={new Date(remittance.created_at).toLocaleString()} />
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 24 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  dotDone: { backgroundColor: '#10B981' },
  dotPending: { backgroundColor: '#D1D5DB' },
  line: { flex: 1, height: 3 },
  lineDone: { backgroundColor: '#10B981' },
  linePending: { backgroundColor: '#D1D5DB' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  rowLabel: { color: '#6B7280', fontSize: 14 },
  rowValue: { color: '#111827', fontSize: 14, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
});
