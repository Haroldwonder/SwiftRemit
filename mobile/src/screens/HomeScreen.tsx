import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function HomeScreen() {
  const navigation = useNavigation();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>Welcome back 👋</Text>
      <Text style={styles.sub}>What would you like to do?</Text>

      <TouchableOpacity
        style={[styles.card, styles.primary]}
        onPress={() => navigation.navigate('SendMoney' as never)}
      >
        <Text style={styles.cardIcon}>💸</Text>
        <Text style={styles.cardTitle}>Send Money</Text>
        <Text style={styles.cardDesc}>Transfer funds to family & friends abroad</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('TransactionHistory' as never)}
      >
        <Text style={styles.cardIcon}>📋</Text>
        <Text style={styles.cardTitle}>Transaction History</Text>
        <Text style={styles.cardDesc}>View and track all your past transfers</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('KycStatus' as never)}
      >
        <Text style={styles.cardIcon}>✅</Text>
        <Text style={styles.cardTitle}>Identity Verification</Text>
        <Text style={styles.cardDesc}>Check your KYC status</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 24 },
  greeting: { fontSize: 28, fontWeight: '800', color: '#111827', marginTop: 8 },
  sub: { fontSize: 16, color: '#6B7280', marginBottom: 28, marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  primary: {
    backgroundColor: '#1A56DB',
    borderColor: '#1A56DB',
  },
  cardIcon: { fontSize: 28, marginBottom: 8 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  cardDesc: { fontSize: 14, color: '#6B7280' },
});
