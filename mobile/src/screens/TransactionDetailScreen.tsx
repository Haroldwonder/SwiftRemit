import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Linking,
  Share,
  RefreshControl,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { remittanceService } from '../services/api';
import { Remittance, RemittanceStatus, DisputeReason, Receipt } from '../types';
import { t } from '../services/i18n';

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
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState<DisputeReason>('funds_not_received');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);

  useEffect(() => {
    loadTransaction();
  }, [remittanceId]);

  async function loadTransaction() {
    try {
      const data = await remittanceService.getById(remittanceId);
      setRemittance(data);
      if (data.status === 'completed' || data.status === 'refunded') {
        const receiptData = await remittanceService.getReceipt(remittanceId);
        setReceipt(receiptData);
      }
    } catch (err) {
      console.error('Failed to load transaction:', err);
    } finally {
      setLoading(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadTransaction();
    } catch (err) {
      console.error('Failed to refresh transaction:', err);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSubmitDispute() {
    if (!disputeDescription.trim()) {
      Alert.alert('Error', 'Please describe the issue');
      return;
    }

    setSubmittingDispute(true);
    try {
      await remittanceService.createDispute(remittanceId, {
        reason: disputeReason,
        description: disputeDescription,
      });
      Alert.alert('Success', 'Dispute has been submitted');
      setShowDisputeModal(false);
      setDisputeDescription('');
      loadTransaction();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.error || 'Failed to submit dispute');
    } finally {
      setSubmittingDispute(false);
    }
  }

  async function handleShareReceipt() {
    if (!receipt) return;

    const summary = [
      t('receipt.receipt'),
      `${t('receipt.senderName')}: ${receipt.sender}`,
      `${t('receipt.recipientName')}: ${receipt.recipient}`,
      `${t('fees.youSend')}: ${receipt.amount_sent} ${receipt.currency_from}`,
      `${t('fees.recipientReceives')}: ${receipt.amount_received} ${receipt.currency_to}`,
      `${t('receipt.fxRate')}: ${receipt.fx_rate.toFixed(4)}`,
      `${t('receipt.feesCharged')}: $${receipt.fees_charged}`,
      `${t('receipt.referenceNumber')}: ${receipt.remittance_id}`,
    ].join('\n');

    try {
      await Share.share({
        message: summary,
        title: t('receipt.receipt'),
      });
    } catch {
      Alert.alert('Error', 'Unable to share receipt.');
    }
  }

  const openProofOfPayout = async (url?: string) => {
    if (!url) {
      Alert.alert('Error', 'No proof of payout is available.');
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      Alert.alert('Error', 'This proof of payout link is not supported.');
      return;
    }

    try {
      const supported = await Linking.openURL(url);
      if (!supported) {
        Alert.alert('Error', 'Unable to open the proof of payout.');
      }
    } catch {
      Alert.alert('Error', 'Unable to open the proof of payout.');
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator testID="loading-indicator" size="large" color="#1A56DB" /></View>;
  if (!remittance) return <View style={styles.center}><Text>Transfer not found.</Text></View>;

  const stepIndex = STATUS_STEPS.indexOf(remittance.status as RemittanceStatus);

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text style={styles.heading}>{t('receipt.receipt')}</Text>

        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Transfer progress: ${stepIndex + 1} of ${STATUS_STEPS.length}. Current status: ${remittance.status.replace(/_/g, ' ')}`}
          style={styles.progressRow}
        >
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
          <Row label={t('receipt.referenceNumber')} value={remittance.remittance_id} />
          <Row label={t('fees.youSend')} value={`$${parseFloat(remittance.amount).toFixed(2)} USD`} />
          <Row label={t('receipt.status')} value={remittance.status.replace(/_/g, ' ')} />
          {remittance.memo ? <Row label={t('sendFlow.memo')} value={remittance.memo} /> : null}
          <Row label={t('receipt.transferDate')} value={new Date(remittance.created_at).toLocaleDateString()} />
          {remittance.anchor_id ? <Row label={t('anchors.anchorName')} value={remittance.anchor_id} /> : null}
        </View>

        {receipt && (
          <View style={styles.card}>
            <Text style={styles.sectionHeading}>{t('receipt.receipt')}</Text>
            <Row label={t('receipt.senderName')} value={receipt.sender} />
            <Row label={t('receipt.recipientName')} value={receipt.recipient} />
            <Row label={t('fees.youSend')} value={`${receipt.amount_sent} ${receipt.currency_from}`} />
            <Row label={t('fees.recipientReceives')} value={`${receipt.amount_received} ${receipt.currency_to}`} />
            <Row label={t('receipt.fxRate')} value={receipt.fx_rate.toFixed(4)} />
            <Row label={t('receipt.feesCharged')} value={`$${receipt.fees_charged}`} />
          </View>
        )}

        {remittance.dispute && (
          <View style={styles.card}>
            <Text style={styles.sectionHeading}>{t('disputes.disputeStatus')}</Text>
            <Row label={t('disputes.disputeReason')} value={remittance.dispute.reason.replace(/_/g, ' ')} />
            <Row label={t('disputes.disputeStatus')} value={remittance.dispute.status.replace(/_/g, ' ')} />
            <Row label={t('disputes.description')} value={remittance.dispute.description} multiline />
            {remittance.dispute.resolution ? <Row label="Resolution" value={remittance.dispute.resolution} multiline /> : null}
          </View>
        )}

        {!remittance.dispute && remittance.status !== 'pending_user_transfer_start' && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Raise a dispute for this transfer"
            style={styles.btn}
            onPress={() => setShowDisputeModal(true)}
          >
            <Text style={styles.btnText}>{t('disputes.raiseDispute')}</Text>
          </TouchableOpacity>
        )}

        {receipt && (
          <>
            <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => setShowReceiptModal(true)}>
              <Text style={styles.btnSecondaryText}>View receipt</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={handleShareReceipt}>
              <Text style={styles.btnText}>{t('receipt.shareReceipt')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal
        visible={showDisputeModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDisputeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeading}>{t('disputes.raiseDispute')}</Text>

            <Text style={styles.label}>{t('disputes.disputeReason')}</Text>
            <View style={styles.reasonRow}>
              {(['funds_not_received', 'incorrect_amount', 'duplicate', 'other'] as const).map((reason) => {
                const isSelected = disputeReason === reason;
                return (
                  <TouchableOpacity
                    key={reason}
                    accessibilityRole="button"
                    accessibilityLabel={`${reason.replace(/_/g, ' ')} dispute reason`}
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.reasonPill, isSelected && styles.reasonPillActive]}
                    onPress={() => setDisputeReason(reason)}
                  >
                    <Text style={isSelected ? styles.reasonPillTextActive : styles.reasonPillText}>
                      {reason === 'funds_not_received' ? t('disputes.fundNotReceived') :
                       reason === 'incorrect_amount' ? t('disputes.incorrectAmount') :
                       reason === 'duplicate' ? t('disputes.duplicate') :
                       t('disputes.other')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>{t('disputes.description')}</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder={t('disputes.descriptionPlaceholder')}
              value={disputeDescription}
              onChangeText={setDisputeDescription}
              multiline
              numberOfLines={4}
            />

            <View style={styles.row}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel dispute submission"
                style={[styles.btn, styles.btnOutline]}
                onPress={() => setShowDisputeModal(false)}
              >
                <Text style={styles.btnOutlineText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Submit dispute"
                style={[styles.btn, styles.btnFlex, submittingDispute && styles.btnDisabled]}
                disabled={submittingDispute}
                onPress={handleSubmitDispute}
              >
                {submittingDispute ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>{t('disputes.submitDispute')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showReceiptModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowReceiptModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeading}>{t('receipt.receipt')}</Text>
            {receipt && <ReceiptView receipt={receipt} onOpenProofOfPayout={openProofOfPayout} />}
            <View style={styles.row}>
              <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setShowReceiptModal(false)}>
                <Text style={styles.btnOutlineText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnSecondary, styles.btnFlex]} onPress={handleShareReceipt}>
                <Text style={styles.btnSecondaryText}>{t('receipt.shareReceipt')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Row({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <View style={[styles.rowContainer, multiline && styles.rowContainerMultiline]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, multiline && styles.rowValueMultiline]}>{value}</Text>
    </View>
  );
}

function ReceiptView({
  receipt,
  onOpenProofOfPayout,
}: {
  receipt: Receipt;
  onOpenProofOfPayout: (url?: string) => Promise<void>;
}) {
  return (
    <ScrollView style={styles.receiptView} contentContainerStyle={styles.receiptContent}>
      <View style={styles.receiptSection}>
        <Text style={styles.receiptLabel}>{t('receipt.senderName')}</Text>
        <Text style={styles.receiptValue}>{receipt.sender}</Text>
      </View>
      <View style={styles.receiptSection}>
        <Text style={styles.receiptLabel}>{t('receipt.recipientName')}</Text>
        <Text style={styles.receiptValue}>{receipt.recipient}</Text>
      </View>
      <View style={styles.receiptDivider} />
      <View style={styles.receiptSection}>
        <Text style={styles.receiptLabel}>{t('fees.youSend')}</Text>
        <Text style={styles.receiptValueBold}>{receipt.amount_sent} {receipt.currency_from}</Text>
      </View>
      <View style={styles.receiptSection}>
        <Text style={styles.receiptLabel}>{t('receipt.fxRate')}</Text>
        <Text style={styles.receiptValue}>1 {receipt.currency_from} = {receipt.fx_rate.toFixed(4)} {receipt.currency_to}</Text>
      </View>
      <View style={styles.receiptSection}>
        <Text style={styles.receiptLabel}>{t('receipt.feesCharged')}</Text>
        <Text style={styles.receiptValue}>${receipt.fees_charged}</Text>
      </View>
      <View style={styles.receiptDivider} />
      <View style={styles.receiptSection}>
        <Text style={styles.receiptLabel}>{t('fees.recipientReceives')}</Text>
        <Text style={[styles.receiptValueBold, styles.receiptValueGreen]}>{receipt.amount_received} {receipt.currency_to}</Text>
      </View>
      {receipt.proof_of_payout_url && (
        <TouchableOpacity style={styles.linkButton} onPress={() => onOpenProofOfPayout(receipt.proof_of_payout_url)}>
          <Text style={styles.linkButtonText}>{t('receipt.proofOfPayout')}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 24, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 24 },
  sectionHeading: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
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
    marginBottom: 16,
  },
  row: { flexDirection: 'row', marginTop: 4 },
  rowContainer: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  rowContainerMultiline: { flexDirection: 'column' },
  rowLabel: { color: '#6B7280', fontSize: 14 },
  rowValue: { color: '#111827', fontSize: 14, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  rowValueMultiline: { marginTop: 4, maxWidth: '100%', textAlign: 'left' },
  btn: {
    backgroundColor: '#1A56DB',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  btnSecondary: { backgroundColor: '#6B7280' },
  btnDisabled: { opacity: 0.4 },
  btnFlex: { flex: 1, marginLeft: 12 },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1A56DB',
    flex: 1,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnSecondaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnOutlineText: { color: '#1A56DB', fontWeight: '700', fontSize: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
  },
  modalHeading: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#111827',
  },
  inputMultiline: { textAlignVertical: 'top', paddingTop: 12 },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  reasonPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
  },
  reasonPillActive: { backgroundColor: '#1A56DB', borderColor: '#1A56DB' },
  reasonPillText: { color: '#374151', fontSize: 12 },
  reasonPillTextActive: { color: '#fff', fontSize: 12, fontWeight: '600' },
  receiptView: { flex: 1, maxHeight: 400, marginBottom: 16 },
  receiptContent: { paddingVertical: 8 },
  receiptSection: { paddingVertical: 8 },
  receiptLabel: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  receiptValue: { fontSize: 14, color: '#111827' },
  receiptValueBold: { fontSize: 16, color: '#111827', fontWeight: '700' },
  receiptValueGreen: { color: '#10B981' },
  receiptDivider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 12 },
  linkButton: { marginTop: 12, paddingVertical: 12 },
  linkButtonText: { color: '#1A56DB', fontWeight: '600', fontSize: 14 },
});
