import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import SendMoneyScreen from '../../screens/SendMoneyScreen';
import { remittanceService, fxService } from '../../services/api';
import * as biometrics from '../../services/biometrics';

jest.mock('../../services/api', () => ({
  remittanceService: { create: jest.fn() },
  fxService: { getRate: jest.fn() },
}));

jest.mock('../../services/biometrics', () => ({
  authenticateWithBiometrics: jest.fn(),
}));

const mockCreate = remittanceService.create as jest.Mock;
const mockGetRate = fxService.getRate as jest.Mock;
const mockAuthBio = biometrics.authenticateWithBiometrics as jest.Mock;
const mockAlertAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const { useNavigation } = require('@react-navigation/native');
const mockNavigate = jest.fn();

describe('SendMoneyScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNavigation.mockReturnValue({ navigate: mockNavigate });
    mockGetRate.mockResolvedValue({ rate: 56.5, from: 'USD', to: 'PHP', timestamp: '', provider: '', cached: false });
    mockAuthBio.mockResolvedValue(true);
  });

  // ── Step 1 ─────────────────────────────────────────────────────────────
  describe('Step 1 — recipient details', () => {
    it('renders the step-1 heading', () => {
      const { getByText } = render(<SendMoneyScreen />);
      expect(getByText('Who are you sending to?')).toBeTruthy();
    });

    it('renders currency pill options', () => {
      const { getByText } = render(<SendMoneyScreen />);
      expect(getByText('PHP')).toBeTruthy();
      expect(getByText('MXN')).toBeTruthy();
      expect(getByText('NGN')).toBeTruthy();
    });

    it('Continue button is disabled when fields are empty', () => {
      const { getByText } = render(<SendMoneyScreen />);
      const btn = getByText('Continue');
      fireEvent.press(btn); // should not advance
      // Still on step 1
      expect(getByText('Who are you sending to?')).toBeTruthy();
    });

    it('advances to step 2 when both recipient fields are filled', () => {
      const { getByText, getByPlaceholderText } = render(<SendMoneyScreen />);
      fireEvent.changeText(getByPlaceholderText('Full name'), 'Maria Santos');
      fireEvent.changeText(getByPlaceholderText('e.g. Philippines'), 'Philippines');
      fireEvent.press(getByText('Continue'));
      expect(getByText('How much are you sending?')).toBeTruthy();
    });

    it('selects a different currency pill', () => {
      const { getByText } = render(<SendMoneyScreen />);
      fireEvent.press(getByText('MXN'));
      // pill selected — no crash
      expect(getByText('MXN')).toBeTruthy();
    });
  });

  // ── Step 2 ─────────────────────────────────────────────────────────────
  describe('Step 2 — amount entry', () => {
    function fillStep1AndAdvance(utils: ReturnType<typeof render>) {
      const { getByText, getByPlaceholderText } = utils;
      fireEvent.changeText(getByPlaceholderText('Full name'), 'Maria Santos');
      fireEvent.changeText(getByPlaceholderText('e.g. Philippines'), 'Philippines');
      fireEvent.press(getByText('Continue'));
    }

    it('renders the step-2 heading', () => {
      const utils = render(<SendMoneyScreen />);
      fillStep1AndAdvance(utils);
      expect(utils.getByText('How much are you sending?')).toBeTruthy();
    });

    it('shows the FX rate card when an amount is entered', async () => {
      const utils = render(<SendMoneyScreen />);
      fillStep1AndAdvance(utils);
      fireEvent.changeText(utils.getByPlaceholderText('0.00'), '100');
      await waitFor(() => {
        expect(utils.getByText(/1 USD = 56\.5000 PHP/)).toBeTruthy();
      });
    });

    it('Review button is disabled with zero amount', () => {
      const utils = render(<SendMoneyScreen />);
      fillStep1AndAdvance(utils);
      fireEvent.press(utils.getByText('Review'));
      // Still on step 2
      expect(utils.getByText('How much are you sending?')).toBeTruthy();
    });

    it('Back button returns to step 1', () => {
      const utils = render(<SendMoneyScreen />);
      fillStep1AndAdvance(utils);
      fireEvent.press(utils.getByText('Back'));
      expect(utils.getByText('Who are you sending to?')).toBeTruthy();
    });

    it('advances to step 3 with a valid amount', () => {
      const utils = render(<SendMoneyScreen />);
      fillStep1AndAdvance(utils);
      fireEvent.changeText(utils.getByPlaceholderText('0.00'), '200');
      fireEvent.press(utils.getByText('Review'));
      expect(utils.getByText('Review your transfer')).toBeTruthy();
    });
  });

  // ── Step 3 ─────────────────────────────────────────────────────────────
  describe('Step 3 — review & confirm', () => {
    function fillAndReach3(utils: ReturnType<typeof render>) {
      const { getByText, getByPlaceholderText } = utils;
      fireEvent.changeText(getByPlaceholderText('Full name'), 'Maria Santos');
      fireEvent.changeText(getByPlaceholderText('e.g. Philippines'), 'Philippines');
      fireEvent.press(getByText('Continue'));
      fireEvent.changeText(getByPlaceholderText('0.00'), '150');
      fireEvent.press(getByText('Review'));
    }

    it('shows the summary card with correct values', async () => {
      const utils = render(<SendMoneyScreen />);
      fillAndReach3(utils);
      expect(utils.getByText('Review your transfer')).toBeTruthy();
      expect(utils.getByText('Maria Santos (Philippines)')).toBeTruthy();
      expect(utils.getByText('$150 USD')).toBeTruthy();
    });

    it('shows the biometric hint', () => {
      const utils = render(<SendMoneyScreen />);
      fillAndReach3(utils);
      expect(utils.getByText("You'll be asked to confirm with Face ID / fingerprint.")).toBeTruthy();
    });

    it('Back button returns to step 2', () => {
      const utils = render(<SendMoneyScreen />);
      fillAndReach3(utils);
      fireEvent.press(utils.getByText('Back'));
      expect(utils.getByText('How much are you sending?')).toBeTruthy();
    });

    it('calls biometric auth then creates a remittance on confirm', async () => {
      mockCreate.mockResolvedValue({ remittance_id: 'new-rm-1' });
      const utils = render(<SendMoneyScreen />);
      fillAndReach3(utils);
      await act(async () => {
        fireEvent.press(utils.getByText('Confirm & Send'));
      });
      await waitFor(() => {
        expect(mockAuthBio).toHaveBeenCalledWith('Confirm your transfer with biometrics');
        expect(mockCreate).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { remittanceId: 'new-rm-1' });
      });
    });

    it('shows an alert and does not navigate if biometrics fail', async () => {
      mockAuthBio.mockResolvedValue(false);
      const utils = render(<SendMoneyScreen />);
      fillAndReach3(utils);
      await act(async () => {
        fireEvent.press(utils.getByText('Confirm & Send'));
      });
      await waitFor(() => {
        expect(mockAlertAlert).toHaveBeenCalledWith(
          'Authentication required',
          expect.any(String)
        );
        expect(mockCreate).not.toHaveBeenCalled();
      });
    });

    it('shows an error alert when remittance creation fails', async () => {
      mockAuthBio.mockResolvedValue(true);
      mockCreate.mockRejectedValue({ response: { data: { error: 'Insufficient funds' } } });
      const utils = render(<SendMoneyScreen />);
      fillAndReach3(utils);
      await act(async () => {
        fireEvent.press(utils.getByText('Confirm & Send'));
      });
      await waitFor(() => {
        expect(mockAlertAlert).toHaveBeenCalledWith('Transfer failed', 'Insufficient funds');
      });
    });
  });
});
