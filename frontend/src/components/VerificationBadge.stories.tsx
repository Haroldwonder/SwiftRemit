import type { Meta, StoryObj } from '@storybook/react';
import { VerificationBadge } from './VerificationBadge';

const meta: Meta<typeof VerificationBadge> = {
  title: 'Components/VerificationBadge',
  component: VerificationBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    assetCode: { control: 'text' },
    issuer: { control: 'text' },
    apiUrl: { control: 'text' },
    showDetails: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** USDC – a well-known verified asset */
export const Verified: Story = {
  args: {
    assetCode: 'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    apiUrl: 'http://localhost:3000',
    showDetails: true,
  },
};

/** Unverified / unknown asset */
export const Unverified: Story = {
  args: {
    assetCode: 'UNKN',
    issuer: 'GCEXAMPLE000000000000000000000000000000000000000000000000',
    showDetails: true,
  },
};

/** Suspicious asset */
export const Suspicious: Story = {
  args: {
    assetCode: 'SCAM',
    issuer: 'GBSCAM000000000000000000000000000000000000000000000000000',
    showDetails: true,
  },
};

/** Details hidden */
export const NoDetails: Story = {
  args: {
    assetCode: 'EURC',
    issuer: 'GDEURC000000000000000000000000000000000000000000000000000',
    showDetails: false,
  },
};
