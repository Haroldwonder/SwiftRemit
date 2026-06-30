import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AgentPanel, Agent } from '../components/AgentPanel';

const activeAgent: Agent = {
  address: 'GABC1234DEF5678HIJK9012LMNO3456PQRS7890TUVW1234XYZ5678ABCD',
  name: 'Nairobi Exchange Hub',
  isActive: true,
  totalProcessed: 12450,
  successRate: 0.987,
  corridors: ['USD → KES', 'USD → UGX'],
};

const inactiveAgent: Agent = {
  address: 'GQRS1111TTT2222UUU3333VVV4444WWW5555XXX6666YYY7777ZZZ8888AAAA',
  name: 'Accra Transfer Co',
  isActive: false,
  totalProcessed: 3100,
  successRate: 0.891,
  corridors: ['USD → GHS'],
};

describe('AgentPanel snapshots', () => {
  it('renders empty panel for admin', () => {
    const { container } = render(
      <AgentPanel agents={[]} isAdmin onRegister={vi.fn()} />,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders empty panel for non-admin (read-only)', () => {
    const { container } = render(<AgentPanel agents={[]} isAdmin={false} />);
    expect(container).toMatchSnapshot();
  });

  it('renders a list of agents in admin view with register form', () => {
    const { container } = render(
      <AgentPanel
        agents={[activeAgent, inactiveAgent]}
        isAdmin
        onRegister={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders a list of agents in read-only view (no admin controls)', () => {
    const { container } = render(
      <AgentPanel
        agents={[activeAgent, inactiveAgent]}
        isAdmin={false}
      />,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders stats correctly for mixed active/inactive agents', () => {
    const agents: Agent[] = [
      activeAgent,
      { ...activeAgent, address: 'G' + 'X'.repeat(55), name: 'Agent 2' },
      inactiveAgent,
    ];
    const { container } = render(
      <AgentPanel agents={agents} isAdmin={false} />,
    );
    expect(container).toMatchSnapshot();
  });
});
