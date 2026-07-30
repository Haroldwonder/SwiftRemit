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
  FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { remittanceService, fxService, anchorService } from '../services/api';
import { authenticateWithBiometrics } from '../services/biometrics';
import { SendMoneyFormData, FxRate, FeeBreakdown, Anchor } from '../types';
import { t } from '../services/i18n';

const SUPPORTED_CURRENCIES = ['PHP', 'MXN', 'INR', 'NGN', 'GHS', 'KES', 'UGX'];

export default function SendMoneyScreen() {
  const navigation = useNavigation();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [loading, setLoading] = useState(false);
  const [fxRate, setFxRate] = useState<FxRate | null>(null);
  const [fees, setFees] = useState<FeeBreakdown | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [selectedAnchor, setSelectedAnchor] = useState<Anchor | null>(null);

  const [form, setForm] = useState<SendMoneyFormData>({
    recipientName: '',
    recipientCountry: '',
    recipientCurrency: 'PHP',
    amountUSD: '',
    memo: '',
    anchorId: undefined,
  });

  useEffect(() => {
    if (form.recipientCurrency && form.amountUSD && parseFloat(form.amountUSD) > 0) {
      fxService
        .getRate('USD', form.recipientCurrency)
        .then(setFxRate)
        .catch(() => {});

      remittanceService
        .getFeeBreakdown(form.amountUSD, form.recipientCurrency)
        .then(setFees)
        .catch(() => {});
    }
  }, [form.recipientCurrency, form.amountUSD]);

  useEffect(() => {
    if (form.recipientCountry) {
      anchorService
        .getAvailableAnchors(form.recipientCountry, form.recipientCurrency)
        .then(setAnchors)
        .catch(() => setAnchors([]));
    }
  }, [form.recipientCountry, form.recipientCurrency]);

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
          <Text style={styles.heading}>{t('sendFlow.heading1')}</Text>

          <Text style={styles.label}>{t('sendFlow.recipientName')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('sendFlow.recipientNamePlaceholder')}
            value={form.recipientName}
            onChangeText={(v) => setForm((f) => ({ ...f, recipientName: v }))}
          />

          <Text style={styles.label}>{t('sendFlow.recipientCountry')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('sendFlow.recipientCountryPlaceholder')}
            value={form.recipientCountry}
            onChangeText={(v) => setForm((f) => ({ ...f, recipientCountry: v }))}
          />

          <Text style={styles.label}>{t('sendFlow.payoutCurrency')}</Text>
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
            <Text style={styles.btnText}>{t('common.continue')}</Text>
          </TouchableOpacity>
        </>
      )}

      {step === 2 && (
        <>
          <Text style={styles.heading}>{t('sendFlow.heading2')}</Text>

          <Text style={styles.label}>{t('sendFlow.amount')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('sendFlow.amountPlaceholder')}
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
                {t('fees.recipientReceives')} ≈ {recipientAmount} {form.recipientCurrency}
              </Text>
            </View>
          )}

          <Text style={styles.label}>{t('sendFlow.memo')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('sendFlow.memoPlaceholder')}
            value={form.memo}
            onChangeText={(v) => setForm((f) => ({ ...f, memo: v }))}
            maxLength={100}
          />

          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setStep(1)}>
              <Text style={styles.btnOutlineText}>{t('common.back')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnFlex, (!form.amountUSD || parseFloat(form.amountUSD) <= 0) && styles.btnDisabled]}
              disabled={!form.amountUSD || parseFloat(form.amountUSD) <= 0}
              onPress={() => setStep(3)}
            >
              <Text style={styles.btnText}>{t('common.continue')}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {step === 3 && (
        <>
          <Text style={styles.heading}>{t('sendFlow.heading3')}</Text>

          {fees && (
            <View style={styles.summaryCard}>
              <Row label={t('fees.youSend')} value={`$${form.amountUSD} USD`} />
              <View style={styles.divider} />
              <Row label={t('fees.sendFee')} value={`$${fees.sendFee.amount}`} small />
              <Row label={t('fees.fxFee')} value={`$${fees.fxFee.amount}`} small />
              <Row label={t('fees.payoutFee')} value={`$${fees.payoutFee.amount}`} small />
              <View style={styles.divider} />
              <Row label={t('fees.totalFees')} value={`$${fees.total.amount}`} bold />
              <Row label={t('fees.recipientReceives')} value={`${fees.recipientReceives} ${fees.recipientCurrency}`} highlight />
            </View>
          )}

          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setStep(2)}>
              <Text style={styles.btnOutlineText}>{t('common.back')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnFlex]}
              onPress={() => setStep(4)}
            >
              <Text style={styles.btnText}>{t('common.continue')}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {step === 4 && (
        <>
          <Text style={styles.heading}>{t('sendFlow.heading4')}</Text>

          {anchors.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No anchors available for this corridor</Text>
            </View>
          ) : (
            <FlatList
              scrollEnabled={false}
              data={anchors}
              keyExtractor={(a) => a.anchor_id}
              renderItem={({ item: anchor }) => (
                <TouchableOpacity
                  style={[styles.anchorCard, selectedAnchor?.anchor_id === anchor.anchor_id && styles.anchorCardSelected]}
                  onPress={() => {
                    setSelectedAnchor(anchor);
                    setForm((f) => ({ ...f, anchorId: anchor.anchor_id }));
                  }}
                >
                  <View style={styles.anchorHeader}>
                    <Text style={styles.anchorName}>{anchor.name}</Text>
                    <Text style={[styles.availabilityBadge, styles[`availability_${anchor.availability}`]]}>
                      {anchor.availability}
                    </Text>
                  </View>
                  <Row label={t('anchors.country')} value={anchor.country} small />
                  <Row label={t('anchors.settlementTime')} value={`${anchor.settlement_time_hours} ${t('anchors.hours')}`} small />
                  <Row label={t('anchors.fees')} value={`${anchor.fee_percentage}%`} small />
                </TouchableOpacity>
              )}
            />
          )}

          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setStep(3)}>
              <Text style={styles.btnOutlineText}>{t('common.back')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnFlex, !selectedAnchor && styles.btnDisabled]}
              disabled={!selectedAnchor}
              onPress={() => setStep(5)}
            >
              <Text style={styles.btnText}>{t('common.continue')}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {step === 5 && (
        <>
          <Text style={styles.heading}>{t('sendFlow.heading5')}</Text>

          <View style={styles.summaryCard}>
            <Row label={t('common.to')} value={`${form.recipientName} (${form.recipientCountry})`} />
            <Row label={t('fees.youSend')} value={`$${form.amountUSD} USD`} />
            <Row label={t('fees.recipientReceives')} value={`≈ ${recipientAmount} ${form.recipientCurrency}`} />
            {form.memo ? <Row label={t('sendFlow.memo')} value={form.memo} /> : null}
            {selectedAnchor ? <Row label={t('anchors.anchorName')} value={selectedAnchor.name} /> : null}
          </View>

          <Text style={styles.biometricHint}>
            {t('sendFlow.biometricHint')}
          </Text>

          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setStep(4)}>
              <Text style={styles.btnOutlineText}>{t('common.back')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnFlex, loading && styles.btnDisabled]}
              disabled={loading}
              onPress={handleConfirm}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>{t('common.confirm')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Row({ label, value, small, bold, highlight }: { label: string; value: string; small?: boolean; bold?: boolean; highlight?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, small && styles.summaryLabelSmall, bold && styles.summaryLabelBold]}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, small && styles.summaryValueSmall, bold && styles.summaryValueBold, highlight && styles.summaryValueHighlight]}>
        {value}
      </Text>
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
  summaryLabelSmall: { fontSize: 12 },
  summaryLabelBold: { fontWeight: '700', color: '#111827' },
  summaryValue: { color: '#111827', fontSize: 14, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  summaryValueSmall: { fontSize: 12 },
  summaryValueBold: { fontWeight: '700' },
  summaryValueHighlight: { color: '#10B981', fontSize: 16 },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 8 },
  biometricHint: { color: '#6B7280', fontSize: 13, textAlign: 'center', marginTop: 16 },
  anchorCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  anchorCardSelected: {
    borderColor: '#1A56DB',
    backgroundColor: '#EFF6FF',
  },
  anchorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  anchorName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  availabilityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: '600',
  },
  availability_available: { backgroundColor: '#D1FAE5', color: '#065F46' },
  availability_limited: { backgroundColor: '#FEF3C7', color: '#78350F' },
  availability_unavailable: { backgroundColor: '#FEE2E2', color: '#7F1D1D' },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 32,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  emptyText: { color: '#6B7280', fontSize: 14 },
});
