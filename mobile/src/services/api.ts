import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Remittance, KycStatus, FxRate, SendMoneyFormData } from '../types';

const BASE_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:3000';

const http = axios.create({ baseURL: BASE_URL, timeout: 15000 });

http.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const authService = {
  async login(walletAddress: string, signature: string): Promise<{ token: string }> {
    const { data } = await http.post('/api/auth/login', { walletAddress, signature });
    await SecureStore.setItemAsync('auth_token', data.token);
    await SecureStore.setItemAsync('wallet_address', walletAddress);
    return data;
  },

  async logout(): Promise<void> {
    await SecureStore.deleteItemAsync('auth_token');
    await SecureStore.deleteItemAsync('wallet_address');
  },

  async getStoredWallet(): Promise<string | null> {
    return SecureStore.getItemAsync('wallet_address');
  },
};

export const remittanceService = {
  async create(payload: SendMoneyFormData): Promise<Remittance> {
    const wallet = await SecureStore.getItemAsync('wallet_address');
    const { data } = await http.post('/api/remittance', {
      sender: wallet,
      agent: payload.recipientCountry,
      amount: payload.amountUSD,
      memo: payload.memo || undefined,
    });
    return data.remittance;
  },

  async getHistory(walletAddress: string): Promise<Remittance[]> {
    const { data } = await http.get(`/api/remittance/history/${walletAddress}`);
    return data.remittances ?? data;
  },

  async getById(remittanceId: string): Promise<Remittance> {
    const { data } = await http.get(`/api/remittance/${remittanceId}`);
    return data.remittance ?? data;
  },
};

export const kycService = {
  async getStatus(userId: string, anchorId: string): Promise<KycStatus> {
    const { data } = await http.get(`/api/kyc/status/${userId}/${anchorId}`);
    return data;
  },

  async register(fields: Record<string, string>): Promise<void> {
    await http.post('/api/kyc/register', fields);
  },
};

export const fxService = {
  async getRate(from: string, to: string): Promise<FxRate> {
    const { data } = await http.get('/api/fx-rate/current', { params: { from, to } });
    return data;
  },
};
