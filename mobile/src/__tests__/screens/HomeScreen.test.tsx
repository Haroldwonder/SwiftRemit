import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import HomeScreen from '../../screens/HomeScreen';

// useNavigation is mocked globally in setup.ts
const { useNavigation } = require('@react-navigation/native');

describe('HomeScreen', () => {
  const mockNavigate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useNavigation.mockReturnValue({ navigate: mockNavigate });
  });

  it('renders the welcome greeting', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText('Welcome back 👋')).toBeTruthy();
  });

  it('renders all three action cards', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText('Send Money')).toBeTruthy();
    expect(getByText('Transaction History')).toBeTruthy();
    expect(getByText('Identity Verification')).toBeTruthy();
  });

  it('renders the subtitle text', async () => {
    const { getByText } = await render(<HomeScreen />);
    expect(getByText('What would you like to do?')).toBeTruthy();
  });

  it('navigates to SendMoney when Send Money card is pressed', async () => {
    const { getByText } = await render(<HomeScreen />);
    fireEvent.press(getByText('Send Money'));
    expect(mockNavigate).toHaveBeenCalledWith('SendMoney');
  });

  it('navigates to TransactionHistory when History card is pressed', async () => {
    const { getByText } = await render(<HomeScreen />);
    fireEvent.press(getByText('Transaction History'));
    expect(mockNavigate).toHaveBeenCalledWith('TransactionHistory');
  });

  it('navigates to KycStatus when Identity Verification card is pressed', async () => {
    const { getByText } = await render(<HomeScreen />);
    fireEvent.press(getByText('Identity Verification'));
    expect(mockNavigate).toHaveBeenCalledWith('KycStatus');
  });
});
