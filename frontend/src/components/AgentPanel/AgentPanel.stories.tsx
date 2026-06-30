import type { Meta, StoryObj } from '@storybook/react';
import { AgentPanel, Agent } from './index';

const sampleAgents: Agent[] = [
  {
    address: 'GABC1234DEF5678HIJK9012LMNO3456PQRS7890TUVW1234XYZ5678ABCD',
    name: 'Nairobi Exchange Hub',
    isActive: true,
    totalProcessed: 12450,
    successRate: 0.987,
    corridors: ['USD → KES', 'USD → UGX'],
  },
  {
    address: 'GXYZ9876WVU5432SRQP0987ONML6543KJIH2109GFED8765CBAZ4321WXYZ',
    name: 'Lagos Remit Pro',
    isActive: true,
    totalProcessed: 8920,
    successRate: 0.972,
    corridors: ['USD → NGN'],
  },
  {
    address: 'GQRS1111TTT2222UUU3333VVV4444WWW5555XXX6666YYY7777ZZZ8888AAAA',
    name: 'Accra Transfer Co',
    isActive: false,
    totalProcessed: 3100,
    successRate: 0.891,
    corridors: ['USD → GHS'],
  },
];

const meta: Meta<typeof AgentPanel> = {
  title: 'Components/AgentPanel',
  component: AgentPanel,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    isAdmin: { control: 'boolean' },
    onRegister: { action: 'register' },
    onDeactivate: { action: 'deactivate' },
    onReactivate: { action: 'reactivate' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const AdminView: Story = {
  args: {
    agents: sampleAgents,
    isAdmin: true,
  },
};

export const ReadOnly: Story = {
  args: {
    agents: sampleAgents,
    isAdmin: false,
  },
};

export const Empty: Story = {
  args: {
    agents: [],
    isAdmin: true,
  },
};
