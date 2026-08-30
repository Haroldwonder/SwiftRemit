/**
 * LoginScreen — SR-185
 *
 * Collects a Stellar wallet address and a signature/passphrase from the user,
 * then calls authService.login(walletAddress, signature).  On success the app
 * routes to Main (the tab navigator).  Session expiry in api.ts's interceptors
 * now navigates back here instead of leaving screens to fail silently.
 *
 * Signing note:
 * In a production integration you would replace the passphrase TextInput with
 * a Stellar wallet connector / SEP-10 challenge flow (e.g. Freighter, Lobstr,
 * or a QR-based signing handoff).  The current field is intentionally labelled
 * "Passphrase / Signature" so the UX shape is clear without locking in an SDK
 * choice before wallet-SDK work is scoped.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { authService } from '../services/api';
import type { RootStackParamList } from '../navigation/AppNavigator';

export default function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [walletAddress, setWalletAddress] = useState('');
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = walletAddress.trim().length > 0 && signature.trim().length > 0;

  async function handleLogin() {
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    try {
      await authService.login(walletAddress.trim(), signature.trim());
      // Navigate to Main and clear the auth stack so the user can't go back
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    } catch (err: any) {
      const message =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        'Login failed. Check your wallet address and signature.';
      setError(message);
      Alert.alert('Authentication failed', message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / wordmark */}
        <View style={styles.logoRow}>
          <Text style={styles.logoText}>SwiftRemit</Text>
          <Text style={styles.logoSub}>Fast, secure cross-border transfers</Text>
        </View>

        <Text style={styles.heading}>Connect your wallet</Text>
        <Text style={styles.subheading}>
          Enter your Stellar wallet address and sign to authenticate.
        </Text>

        {/* Wallet address */}
        <Text style={styles.label}>Stellar wallet address</Text>
        <TextInput
          testID="wallet-address-input"
          style={styles.input}
          placeholder="G…"
          autoCapitalize="none"
          autoCorrect={false}
          value={walletAddress}
          onChangeText={(v) => { setWalletAddress(v); setError(''); }}
          accessibilityLabel="Stellar wallet address"
        />

        {/* Passphrase / signature */}
        <Text style={styles.label}>Passphrase / Signature</Text>
        <TextInput
          testID="signature-input"
          style={styles.input}
          placeholder="Your passphrase or SEP-10 signature"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={signature}
          onChangeText={(v) => { setSignature(v); setError(''); }}
          accessibilityLabel="Passphrase or signature"
        />

        {error ? (
          <Text testID="login-error" style={styles.errorText}>{error}</Text>
        ) : null}

        <TouchableOpacity
          testID="login-button"
          accessibilityRole="button"
          accessibilityLabel="Connect wallet"
          accessibilityState={{ disabled: !canSubmit || loading }}
          style={[styles.btn, (!canSubmit || loading) && styles.btnDisabled]}
          disabled={!canSubmit || loading}
          onPress={handleLogin}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Connect wallet</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          SwiftRemit never stores your private key. Authentication uses a
          signed challenge verified by the server.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F9FAFB' },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 28,
    paddingBottom: 48,
  },
  logoRow: { alignItems: 'center', marginBottom: 40 },
  logoText: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1A56DB',
    letterSpacing: -0.5,
  },
  logoSub: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subheading: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 28,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#111827',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    marginTop: 12,
  },
  btn: {
    backgroundColor: '#1A56DB',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disclaimer: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
});
