/**
 * Tests for src/services/api.ts
 *
 * The module creates an axios instance at import time and attaches an auth
 * interceptor, so we mock axios.create to return our controlled mock object.
 */
import * as SecureStore from 'expo-secure-store';

// ── Axios mock ─────────────────────────────────────────────────────────────
const mockGet = jest.fn();
const mockPost = jest.fn();
const requestInterceptorUse = jest.fn();

const mockHttp = {
  get: mockGet,
  post: mockPost,
  interceptors: {
    request: { use: requestInterceptorUse },
    response: { use: jest.fn() },
  },
};

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => mockHttp),
  },
}));

// ── SecureStore is mocked globally in setup.ts ─────────────────────────────
const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;

// Import after mocks are set up
import { authService, remittanceService, kycService, fxService } from '../../services/api';

describe('api.ts — authService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs to /api/auth/login and stores the token + wallet', async () => {
    mockPost.mockResolvedValue({ data: { token: 'jwt-abc' } });
    const result = await authService.login('GABCD', 'sig-123');
    expect(mockPost).toHaveBeenCalledWith('/api/auth/login', {
      walletAddress: 'GABCD',
      signature: 'sig-123',
    });
    expect(mockSetItemAsync).toHaveBeenCalledWith('auth_token', 'jwt-abc');
    expect(mockSetItemAsync).toHaveBeenCalledWith('wallet_address', 'GABCD');
    expect(result).toEqual({ token: 'jwt-abc' });
  });

  it('deletes auth_token and wallet_address on logout', async () => {
    await authService.logout();
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('auth_token');
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('wallet_address');
  });

  it('returns the stored wallet address', async () => {
    mockGetItemAsync.mockResolvedValueOnce('GABCD');
    const wallet = await authService.getStoredWallet();
    expect(wallet).toBe('GABCD');
  });

  it('returns null when no wallet address is stored', async () => {
    mockGetItemAsync.mockResolvedValueOnce(null);
    const wallet = await authService.getStoredWallet();
    expect(wallet).toBeNull();
  });
});

describe('api.ts — remittanceService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs to /api/remittance and returns the remittance', async () => {
    mockGetItemAsync.mockResolvedValueOnce('SENDER_WALLET');
    const fakeRemittance = { remittance_id: 'rm-1', status: 'pending_user_transfer_start' };
    mockPost.mockResolvedValue({ data: { remittance: fakeRemittance } });

    const result = await remittanceService.create({
      recipientName: 'Maria',
      recipientCountry: 'Philippines',
      recipientCurrency: 'PHP',
      amountUSD: '100',
      memo: 'Rent',
    });

    expect(mockPost).toHaveBeenCalledWith('/api/remittance', {
      sender: 'SENDER_WALLET',
      agent: 'Philippines',
      amount: '100',
      memo: 'Rent',
    });
    expect(result).toEqual(fakeRemittance);
  });

  it('omits memo when it is an empty string', async () => {
    mockGetItemAsync.mockResolvedValueOnce('SENDER_WALLET');
    mockPost.mockResolvedValue({ data: { remittance: { remittance_id: 'rm-2' } } });

    await remittanceService.create({
      recipientName: 'Maria',
      recipientCountry: 'Philippines',
      recipientCurrency: 'PHP',
      amountUSD: '50',
      memo: '',
    });

    const callArg = mockPost.mock.calls[0][1];
    expect(callArg.memo).toBeUndefined();
  });

  it('GETs history for a wallet address', async () => {
    const list = [{ remittance_id: 'rm-1' }, { remittance_id: 'rm-2' }];
    mockGet.mockResolvedValue({ data: { remittances: list } });

    const result = await remittanceService.getHistory('WALLET_ABC');
    expect(mockGet).toHaveBeenCalledWith('/api/remittance/history/WALLET_ABC');
    expect(result).toHaveLength(2);
  });

  it('handles a flat array response from getHistory', async () => {
    const list = [{ remittance_id: 'rm-3' }];
    mockGet.mockResolvedValue({ data: list });
    const result = await remittanceService.getHistory('WALLET_ABC');
    expect(result).toEqual(list);
  });

  it('GETs a single remittance by ID', async () => {
    const rem = { remittance_id: 'rm-42' };
    mockGet.mockResolvedValue({ data: { remittance: rem } });

    const result = await remittanceService.getById('rm-42');
    expect(mockGet).toHaveBeenCalledWith('/api/remittance/rm-42');
    expect(result).toEqual(rem);
  });

  it('handles a flat response from getById', async () => {
    const rem = { remittance_id: 'rm-99' };
    mockGet.mockResolvedValue({ data: rem });
    const result = await remittanceService.getById('rm-99');
    expect(result).toEqual(rem);
  });
});

describe('api.ts — kycService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GETs KYC status for a user + anchor', async () => {
    const kycData = { user_id: 'u1', kyc_status: 'approved' };
    mockGet.mockResolvedValue({ data: kycData });

    const result = await kycService.getStatus('u1', 'testanchor.stellar.org');
    expect(mockGet).toHaveBeenCalledWith('/api/kyc/status/u1/testanchor.stellar.org');
    expect(result).toEqual(kycData);
  });

  it('POSTs registration fields to /api/kyc/register', async () => {
    mockPost.mockResolvedValue({ data: {} });
    await kycService.register({ first_name: 'Maria', last_name: 'Santos' });
    expect(mockPost).toHaveBeenCalledWith('/api/kyc/register', {
      first_name: 'Maria',
      last_name: 'Santos',
    });
  });
});

describe('api.ts — fxService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GETs the current FX rate with from/to params', async () => {
    const rate = { from: 'USD', to: 'PHP', rate: 56.5, timestamp: '', provider: 'mock', cached: false };
    mockGet.mockResolvedValue({ data: rate });

    const result = await fxService.getRate('USD', 'PHP');
    expect(mockGet).toHaveBeenCalledWith('/api/fx-rate/current', {
      params: { from: 'USD', to: 'PHP' },
    });
    expect(result).toEqual(rate);
  });
});
