import axios, { AxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Remittance, KycStatus, FxRate, SendMoneyFormData, FeeBreakdown, Anchor, Receipt, Dispute, DisputeReason } from '../types';

const BASE_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:3000';

// Inactivity window after which the session is considered stale and the
// stored access token must be discarded, forcing re-authentication.
const SESSION_INACTIVITY_MS = 15 * 60 * 1000;

const SECRET_KEYS = ['auth_token', 'wallet_address', 'last_active'];

const http = axios.create({ baseURL: BASE_URL, timeout: 15000, withCredentials: true });

async function clearAllSecrets(): Promise<void> {
  await Promise.all(SECRET_KEYS.map((key) => SecureStore.deleteItemAsync(key)));
}

async function touchActivity(): Promise<void> {
  await SecureStore.setItemAsync('last_active', String(Date.now()));
}

async function isSessionExpired(): Promise<boolean> {
  const lastActive = await SecureStore.getItemAsync('last_active');
  if (!lastActive) return false;
  return Date.now() - Number(lastActive) > SESSION_INACTIVITY_MS;
}

http.interceptors.request.use(async (config) => {
  if (await isSessionExpired()) {
    await clearAllSecrets();
    return Promise.reject(new Error('Session expired due to inactivity'));
  }
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  await touchActivity();
  return config;
});

interface RetriableRequestConfig extends AxiosRequestConfig {
  _retried?: boolean;
}

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);
    const original = error.config as RetriableRequestConfig | undefined;
    if (error.response?.status === 401 && original && !original._retried) {
      original._retried = true;
      try {
        const { data } = await axios.post(
          `${BASE_URL}/api/auth/refresh`,
          {},
          { withCredentials: true },
        );
        await SecureStore.setItemAsync('auth_token', data.data.access_token);
        await touchActivity();
        original.headers = { ...original.headers, Authorization: `Bearer ${data.data.access_token}` };
        return http(original);
      } catch (refreshError) {
        await clearAllSecrets();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);

export const authService = {
  async login(walletAddress: string, signature: string): Promise<{ token: string }> {
    const { data } = await http.post('/api/auth/login', { walletAddress, signature });
    await SecureStore.setItemAsync('auth_token', data.token);
    await SecureStore.setItemAsync('wallet_address', walletAddress);
    await touchActivity();
    return data;
  },

  /**
   * Logout: clears auth token, wallet address, and deregisters the push token
   * from the backend so the device stops receiving notifications.
   */
  async logout(): Promise<void> {
    try {
      await http.post('/api/auth/logout');
    } catch {
      // best-effort server-side revocation; local secrets are cleared regardless
    }
    await clearAllSecrets();
  },

  async getStoredWallet(): Promise<string | null> {
    if (await isSessionExpired()) {
      await clearAllSecrets();
      return null;
    }
    return SecureStore.getItemAsync('wallet_address');
  },
};

export const remittanceService = {
  async create(payload: SendMoneyFormData, transactionSignature: string): Promise<Remittance> {
    const wallet = await SecureStore.getItemAsync('wallet_address');
    const { data } = await http.post('/api/remittance', {
      sender: wallet,
      agent: payload.recipientCountry,
      amount: payload.amountUSD,
      memo: payload.memo || undefined,
      anchor_id: payload.anchorId || undefined,
      // SR-186: signing artifact derived from keystore-backed key; required
      // by the server before it will execute the on-chain remittance.
      transaction_signature: transactionSignature,
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

  async getFeeBreakdown(amount: string, currency: string): Promise<FeeBreakdown> {
    const { data } = await http.get('/api/remittance/fees/breakdown', {
      params: { amount, currency }
    });
    return data;
  },

  async getReceipt(remittanceId: string): Promise<Receipt> {
    const { data } = await http.get(`/api/remittance/${remittanceId}/receipt`);
    return data;
  },

  async createDispute(remittanceId: string, payload: { reason: DisputeReason; description: string }): Promise<Dispute> {
    const { data } = await http.post(`/api/remittance/${remittanceId}/dispute`, payload);
    return data;
  },

  async getDispute(remittanceId: string): Promise<Dispute | null> {
    try {
      const { data } = await http.get(`/api/remittance/${remittanceId}/dispute`);
      return data;
    } catch {
      return null;
    }
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

export const anchorService = {
  /**
   * List the payout anchors that can settle into the given corridor.
   * Returns them ordered by the backend (best availability first).
   */
  async getAvailableAnchors(country: string, currency: string): Promise<Anchor[]> {
    const { data } = await http.get('/api/anchors/available', {
      params: { country, currency },
    });
    return data.anchors ?? data;
  },
};

export const deviceService = {
  /**
   * Register a push token with the backend.
   * Called after login, once the auth token is persisted.
   */
  async register(token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
    await http.post('/api/devices/register', { token, platform });
  },

  /**
   * Deregister a push token from the backend.
   * Called during logout so the device stops receiving notifications.
   */
  async deregister(token: string): Promise<void> {
    await http.delete('/api/devices/deregister', { data: { token } });
  },
};
