/**
 * Tests for LoginScreen (SR-185)
 */
import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';
import LoginScreen from '../../screens/LoginScreen';
import { authService } from '../../services/api';

jest.mock('../../services/api', () => ({
  authService: {
    login: jest.fn(),
    getStoredWallet: jest.fn().mockResolvedValue(null),
  },
}));

const mockLogin = authService.login as jest.Mock;
const { useNavigation } = require('@react-navigation/native');
const mockNavigate = jest.fn();
const mockReset = jest.fn();

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNavigation.mockReturnValue({ navigate: mockNavigate, reset: mockReset });
  });

  it('renders wallet address and signature inputs', () => {
    const { getByTestId } = render(<LoginScreen />);
    expect(getByTestId('wallet-address-input')).toBeTruthy();
    expect(getByTestId('signature-input')).toBeTruthy();
  });

  it('renders the connect wallet button', () => {
    const { getByTestId } = render(<LoginScreen />);
    expect(getByTestId('login-button')).toBeTruthy();
  });

  it('disables the button when inputs are empty', () => {
    const { getByTestId } = render(<LoginScreen />);
    const btn = getByTestId('login-button');
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it('enables the button when both fields are filled', () => {
    const { getByTestId } = render(<LoginScreen />);
    fireEvent.changeText(getByTestId('wallet-address-input'), 'GABC123');
    fireEvent.changeText(getByTestId('signature-input'), 'sig-xyz');
    const btn = getByTestId('login-button');
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });

  it('calls authService.login with the entered wallet and signature', async () => {
    mockLogin.mockResolvedValue({ token: 'tok-abc' });
    const { getByTestId } = render(<LoginScreen />);

    fireEvent.changeText(getByTestId('wallet-address-input'), 'GABC123');
    fireEvent.changeText(getByTestId('signature-input'), 'sig-xyz');

    await act(async () => {
      fireEvent.press(getByTestId('login-button'));
    });

    expect(mockLogin).toHaveBeenCalledWith('GABC123', 'sig-xyz');
  });

  it('navigates to Main via reset on successful login', async () => {
    mockLogin.mockResolvedValue({ token: 'tok-abc' });
    const { getByTestId } = render(<LoginScreen />);

    fireEvent.changeText(getByTestId('wallet-address-input'), 'GABC123');
    fireEvent.changeText(getByTestId('signature-input'), 'sig-xyz');

    await act(async () => {
      fireEvent.press(getByTestId('login-button'));
    });

    expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
  });

  it('shows an error message when login fails', async () => {
    mockLogin.mockRejectedValue({
      response: { data: { error: 'Invalid signature' } },
    });
    const { getByTestId, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByTestId('wallet-address-input'), 'GABC123');
    fireEvent.changeText(getByTestId('signature-input'), 'bad-sig');

    await act(async () => {
      fireEvent.press(getByTestId('login-button'));
    });

    await waitFor(() => {
      expect(getByTestId('login-error')).toBeTruthy();
      expect(getByText('Invalid signature')).toBeTruthy();
    });
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('shows a generic error message when the server returns no message', async () => {
    mockLogin.mockRejectedValue(new Error('Network error'));
    const { getByTestId, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByTestId('wallet-address-input'), 'GABC123');
    fireEvent.changeText(getByTestId('signature-input'), 'sig-xyz');

    await act(async () => {
      fireEvent.press(getByTestId('login-button'));
    });

    await waitFor(() => {
      expect(getByText('Login failed. Check your wallet address and signature.')).toBeTruthy();
    });
  });
});
