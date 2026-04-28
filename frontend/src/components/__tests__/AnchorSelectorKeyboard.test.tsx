import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { AnchorSelector, AnchorProvider } from '../AnchorSelector';

const mockAnchors: AnchorProvider[] = [
  {
    id: 'anchor-1',
    name: 'Anchor One',
    domain: 'anchor1.com',
    description: 'First anchor',
    status: 'active',
    fees: { deposit_fee_percent: 1.0, withdrawal_fee_percent: 1.5 },
    limits: { min_amount: 10, max_amount: 10000 },
    compliance: {
      kyc_required: true,
      kyc_level: 'basic',
      supported_countries: ['US'],
      restricted_countries: [],
      documents_required: ['id'],
    },
    supported_currencies: ['USD'],
    processing_time: '1-2 days',
    verified: true,
  },
  {
    id: 'anchor-2',
    name: 'Anchor Two',
    domain: 'anchor2.com',
    description: 'Second anchor',
    status: 'active',
    fees: { deposit_fee_percent: 0.5, withdrawal_fee_percent: 1.0 },
    limits: { min_amount: 20, max_amount: 20000 },
    compliance: {
      kyc_required: true,
      kyc_level: 'intermediate',
      supported_countries: ['US', 'CA'],
      restricted_countries: [],
      documents_required: ['id', 'proof_of_address'],
    },
    supported_currencies: ['USD', 'CAD'],
    processing_time: '2-3 days',
    verified: false,
  },
  {
    id: 'anchor-3',
    name: 'Anchor Three',
    domain: 'anchor3.com',
    description: 'Third anchor',
    status: 'active',
    fees: { deposit_fee_percent: 0.8, withdrawal_fee_percent: 1.2 },
    limits: { min_amount: 15, max_amount: 15000 },
    compliance: {
      kyc_required: true,
      kyc_level: 'advanced',
      supported_countries: ['US', 'CA', 'UK'],
      restricted_countries: [],
      documents_required: ['id', 'proof_of_address', 'proof_of_income'],
    },
    supported_currencies: ['USD', 'CAD', 'GBP'],
    processing_time: '1-3 days',
    verified: true,
  },
];

describe('AnchorSelector Keyboard Navigation', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: mockAnchors }),
    }) as any;
    
    Element.prototype.scrollIntoView = vi.fn();
  });

  const waitForLoad = async () => {
    await waitFor(() => {
      expect(screen.queryByText('Loading anchor providers...')).not.toBeInTheDocument();
    });
  };

  describe('ARIA Attributes', () => {
    it('has correct ARIA attributes on trigger', async () => {
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      
      expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('updates aria-expanded when opened', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      await user.click(trigger);

      await waitFor(() => {
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
      });
    });
  });

  describe('Keyboard Navigation', () => {
    it('opens with Enter key', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });
    });

    it('opens with Space key', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard(' ');

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });
    });

    it('opens with ArrowDown key', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{ArrowDown}');

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });
    });

    it('navigates down with ArrowDown', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveClass('focused');
      });

      await user.keyboard('{ArrowDown}');

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[1]).toHaveClass('focused');
      });
    });

    it('navigates up with ArrowUp', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => screen.getByRole('listbox'));

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      
      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[2]).toHaveClass('focused');
      });

      await user.keyboard('{ArrowUp}');

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[1]).toHaveClass('focused');
      });
    });

    it('selects with Enter key', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<AnchorSelector onSelect={onSelect} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => screen.getByRole('listbox'));

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith(mockAnchors[1]);
      });
    });

    it('closes with Escape key', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => screen.getByRole('listbox'));

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });

    it('returns focus to trigger after Escape', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => screen.getByRole('listbox'));

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(trigger).toHaveFocus();
      });
    });

    it('jumps to first with Home key', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => screen.getByRole('listbox'));

      await user.keyboard('{End}');
      
      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[2]).toHaveClass('focused');
      });

      await user.keyboard('{Home}');

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveClass('focused');
      });
    });

    it('jumps to last with End key', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => screen.getByRole('listbox'));

      await user.keyboard('{End}');

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options[2]).toHaveClass('focused');
      });
    });
  });

  describe('Focus Management', () => {
    it('returns focus after selection', async () => {
      const user = userEvent.setup();
      render(<AnchorSelector onSelect={vi.fn()} />);
      await waitForLoad();

      const trigger = screen.getByRole('button', { name: /select anchor provider/i });
      trigger.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => screen.getByRole('listbox'));

      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(trigger).toHaveFocus();
      });
    });
  });
});
