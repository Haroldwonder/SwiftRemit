import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  ScrollView,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { kycService } from '../services/api';
import { KycStatus } from '../types';

const DEFAULT_ANCHOR = 'testanchor.stellar.org';

const KYC_DESCRIPTIONS: Record<KycStatus['kyc_status'], { label: string; color: string; desc: string }> = {
  not_started: {
    label: 'Not Started',
    color: '#6B7280',
    desc: 'Complete identity verification to unlock transfers.',
  },
  pending: {
    label: 'Under Review',
    color: '#F59E0B',
    desc: 'Your documents are being reviewed. This usually takes 1–2 business days.',
  },
  approved: {
    label: 'Verified',
    color: '#10B981',
    desc: 'Your identity is verified. You can send money.',
  },
  denied: {
    label: 'Denied',
    color: '#EF4444',
    desc: 'Your verification was declined. Please re-submit with valid documents.',
  },
  expired: {
    label: 'Expired',
    color: '#EF4444',
    desc: 'Your verification has expired. Please re-verify.',
  },
};

export default function KycStatusScreen() {
  const [status, setStatus] = useState<KycStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const wallet = await SecureStore.getItemAsync('wallet_address');
        if (!wallet) { setError('Not logged in'); return; }
        const data = await kycService.getStatus(wallet, DEFAULT_ANCHOR);
        setStatus(data);
      } catch {
        setError('Failed to load KYC status.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1A56DB" /></View>;
  }

  if (error || !status) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || 'Unknown error'}</Text>
      </View>
    );
  }

  const info = KYC_DESCRIPTIONS[status.kyc_status];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.badge, { backgroundColor: `${info.color}22` }]}>
        <Text style={[styles.badgeText, { color: info.color }]}>{info.label}</Text>
      </View>

      <Text style={styles.desc}>{info.desc}</Text>

      {status.fields_needed?.length ? (
        <View style={styles.fieldsCard}>
          <Text style={styles.fieldsHeading}>Required fields:</Text>
          {status.fields_needed.map((f) => (
            <Text key={f} style={styles.fieldItem}>• {f}</Text>
          ))}
        </View>
      ) : null}

      {status.rejection_reason ? (
        <View style={styles.alertCard}>
          <Text style={styles.alertText}>Reason: {status.rejection_reason}</Text>
        </View>
      ) : null}

      {['not_started', 'denied', 'expired'].includes(status.kyc_status) && (
        <TouchableOpacity
          style={styles.btn}
          onPress={() => Linking.openURL('https://swiftremit.app/kyc')}
        >
          <Text style={styles.btnText}>Start / Re-submit Verification</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.updated}>
        Last updated: {new Date(status.updated_at).toLocaleString()}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 20,
  },
  badgeText: { fontWeight: '700', fontSize: 16 },
  desc: { fontSize: 16, color: '#374151', lineHeight: 24, marginBottom: 20 },
  fieldsCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  fieldsHeading: { fontWeight: '600', color: '#92400E', marginBottom: 8 },
  fieldItem: { color: '#78350F', marginBottom: 4 },
  alertCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  alertText: { color: '#991B1B' },
  btn: {
    backgroundColor: '#1A56DB',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  updated: { color: '#9CA3AF', fontSize: 12, marginTop: 24, textAlign: 'center' },
  errorText: { color: '#EF4444', fontSize: 16 },
});
