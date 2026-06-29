import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { remittanceService, fxService } from '../services/api';
import { authenticateWithBiometrics } from '../services/biometrics';
import { SendMoneyFormData, FxRate } from '../types';

const SUPPORTED_CURRENCIES = ['PHP', 'MXN', 'INR', 'NGN', 'GHS', 'KES', 'UGX'];

export default function SendMoneyScreen() {
  const navigation = useNavigation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [fxRate, setFxRate] = useState<FxRate | null>(null);

  const [form, setForm] = useState<SendMoneyFormData>({
    recipientName: '',
    recipientCountry: '',
    recipientCurrency: 'PHP',
    amountUSD: '',
    memo: '',
  });

  useEffect(() => {
    if (form.recipientCurrency && form.amountUSD && parseFloat(form.amountUSD) > 0) {
      fxService
        .getRate('USD', form.recipientCurrency)
        .then(setFxRate)
        .catch(() => {});
    }
  }, [form.recipientCurrency, form.amountUSD]);

  const recipientAmount =
    fxRate && form.amountUSD
      ? (parseFloat(form.amountUSD) * fxRate.rate).toFixed(2)
      : '—';

  async function handleConfirm() {
    setLoading(true);
    try {
      const confirmed = await authenticateWithBiometrics('Confirm your transfer with biometrics');
      if (!confirmed) {
        Alert.alert('Authentication required', 'Please authenticate to confirm the transfer.');
        return;
      }

      const remittance = await remittanceService.create(form);
      navigation.navigate('TransactionDetail' as never, { remittanceId: remittance.remittance_id } as never);
    } catch (err: any) {
      Alert.alert('Transfer failed', err?.response?.data?.error || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {step === 1 && (
        <>
          <Text style={styles.heading}>Who are you sending to?</Text>

          <Text style={styles.label}>Recipient Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Full name"
            value={form.recipientName}
            onChangeText={(v) => setForm((f) => ({ ...f, recipientName: v }))}
          />

          <Text style={styles.label}>Recipient Country</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Philippines"
            value={form.recipientCountry}
            onChangeText={(v) => setForm((f) => ({ ...f, recipientCountry: v }))}
          />

          <Text style={styles.label}>Payout Currency</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
            {SUPPORTED_CURRENCIES.map((cur) => (
              <TouchableOpacity
                key={cur}
                style={[styles.pill, form.recipientCurrency === cur && styles.pillActive]}
                onPress={() => setForm((f) => ({ ...f, recipientCurrency: cur }))}
              >
                <Text style={form.recipientCurrency === cur ? styles.pillTextActive : styles.pillText}>
                  {cur}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[styles.btn, (!form.recipientName || !form.recipientCountry) && styles.btnDisabled]}
            disabled={!form.recipientName || !form.recipientCountry}
            onPress={() => setStep(2)}
          >
            <Text style={styles.btnText}>Continue</Text>
          </TouchableOpacity>
        </>
      )}

      {step === 2 && (
        <>
          <Text style={styles.heading}>How much are you sending?</Text>

          <Text style={styles.label}>Amount (USD)</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={form.amountUSD}
            onChangeText={(v) => setForm((f) => ({ ...f, amountUSD: v }))}
          />

          {fxRate && (
            <View style={styles.rateCard}>
              <Text style={styles.rateText}>
                1 USD = {fxRate.rate.toFixed(4)} {form.recipientCurrency}
              </Text>
              <Text style={styles.recipientAmount}>
                Recipient gets ≈ {recipientAmount} {form.recipientCurrency}
              </Text>
            </View>
          )}

          <Text style={styles.label}>Memo (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. School fees"
            value={form.memo}
            onChangeText={(v) => setForm((f) => ({ ...f, memo: v }))}
            maxLength={100}
          />

          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setStep(1)}>
              <Text style={styles.btnOutlineText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnFlex, (!form.amountUSD || parseFloat(form.amountUSD) <= 0) && styles.btnDisabled]}
              disabled={!form.amountUSD || parseFloat(form.amountUSD) <= 0}
              onPress={() => setStep(3)}
            >
              <Text style={styles.btnText}>Review</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {step === 3 && (
        <>
          <Text style={styles.heading}>Review your transfer</Text>

          <View style={styles.summaryCard}>
            <Row label="To" value={`${form.recipientName} (${form.recipientCountry})`} />
            <Row label="You send" value={`$${form.amountUSD} USD`} />
            <Row label="They receive" value={`≈ ${recipientAmount} ${form.recipientCurrency}`} />
            {form.memo ? <Row label="Memo" value={form.memo} /> : null}
          </View>

          <Text style={styles.biometricHint}>
            You'll be asked to confirm with Face ID / fingerprint.
          </Text>

          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setStep(2)}>
              <Text style={styles.btnOutlineText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnFlex, loading && styles.btnDisabled]}
              disabled={loading}
              onPress={handleConfirm}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Confirm & Send</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 24, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#111827',
  },
  pillRow: { flexDirection: 'row', marginTop: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    marginRight: 8,
    backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: '#1A56DB', borderColor: '#1A56DB' },
  pillText: { color: '#374151', fontSize: 14 },
  pillTextActive: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btn: {
    backgroundColor: '#1A56DB',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  btnDisabled: { opacity: 0.4 },
  btnFlex: { flex: 1, marginLeft: 12 },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1A56DB',
    flex: 1,
    marginTop: 28,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnOutlineText: { color: '#1A56DB', fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', marginTop: 4 },
  rateCard: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
  },
  rateText: { color: '#1A56DB', fontWeight: '600', fontSize: 14 },
  recipientAmount: { color: '#1E3A5F', fontSize: 20, fontWeight: '700', marginTop: 4 },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  summaryLabel: { color: '#6B7280', fontSize: 14 },
  summaryValue: { color: '#111827', fontSize: 14, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  biometricHint: { color: '#6B7280', fontSize: 13, textAlign: 'center', marginTop: 16 },
});
