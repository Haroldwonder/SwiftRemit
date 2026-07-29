import type { Meta, StoryObj } from '@storybook/react';
import { WalletConnection } from './WalletConnection';

const meta: Meta<typeof WalletConnection> = {
  title: 'Components/WalletConnection',
  component: WalletConnection,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    defaultNetwork: {
      control: 'select',
      options: ['Testnet', 'Mainnet'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Default disconnected state */
export const Default: Story = {
  args: {
    defaultNetwork: 'Testnet',
    // Simulate Freighter not installed so connect is always available in stories
    onConnect: async () => {
      throw new Error('Freighter not installed');
    },
  },
};

/** Connected state – inject a mock onConnect that resolves immediately */
export const Connected: Story = {
  args: {
    defaultNetwork: 'Testnet',
    onConnect: async () => ({
      publicKey: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTWYTTE2OF2HT4JJWUDPXVUNK',
      network: 'Testnet' as const,
    }),
  },
};

/** Mainnet network pill */
export const Mainnet: Story = {
  args: {
    defaultNetwork: 'Mainnet',
    onConnect: async () => ({
      publicKey: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTWYTTE2OF2HT4JJWUDPXVUNK',
      network: 'Mainnet' as const,
    }),
  },
};

/** Connecting loading state – promise never resolves during story */
export const Connecting: Story = {
  args: {
    defaultNetwork: 'Testnet',
    onConnect: () => new Promise(() => { /* intentionally pending */ }),
  },
};
