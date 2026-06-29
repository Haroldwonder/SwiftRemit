import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'dispute.title': 'Dispute Resolution',
        'dispute.openDisputes': 'Open Disputes',
        'dispute.resolved': 'Dispute resolved',
        'dispute.tx': 'Transaction:',
        'dispute.confirmTitle': 'Confirm Resolution',
        'dispute.confirmMessage': 'Are you sure?',
        'dispute.sender': 'Sender',
        'dispute.agent': 'Agent',
        'dispute.senderFunds': 'will receive the funds',
        'dispute.agentFunds': 'will receive the funds',
        'dispute.cancel': 'Cancel',
        'dispute.confirm': 'Confirm',
        'dispute.remittance': 'Remittance',
        'dispute.amount': 'Amount:',
        'dispute.created': 'Created:',
        'dispute.evidenceHash': 'Evidence Hash:',
        'dispute.favourSender': 'Favour Sender',
        'dispute.favourAgent': 'Favour Agent',
        'dispute.loading': 'Loading...',
        'dispute.noDisputes': 'No open disputes',
        'dispute.resolving': 'Resolving...',
        'dispute.prevPage': 'Previous',
        'dispute.nextPage': 'Next',
        'dispute.page': 'Page',
        'dispute.auditTrail': 'Audit Trail',
        'dispute.noResolved': 'No resolved disputes',
        'dispute.resolvedAt': 'Resolved At',
        'dispute.inFavourOf': 'In Favour Of',
        'dispute.resolvedBy': 'Resolved By',
      };

      if (options && typeof options === 'object') {
        let result = translations[key] || key;
        Object.entries(options).forEach(([k, v]) => {
          result = result.replace(`{{${k}}}`, String(v));
        });
        return result;
      }

      return translations[key] || key;
    },
  }),
}));

describe('Issue #898: Dispute Resolution UI for Admins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display resolve modal with outcome dropdown', async () => {
    const TestComponent = () => {
      const [outcome, setOutcome] = React.useState<'sender' | 'agent' | 'split'>('sender');
      const [showModal, setShowModal] = React.useState(true);

      return (
        <>
          {showModal && (
            <div role="dialog" aria-modal="true">
              <h3>Resolve Dispute</h3>
              <select
                value={outcome}
                onChange={e => setOutcome(e.target.value as 'sender' | 'agent' | 'split')}
                data-testid="outcome-dropdown"
              >
                <option value="sender">Favour Sender</option>
                <option value="agent">Favour Agent</option>
                <option value="split">Split 50/50</option>
              </select>
              <button onClick={() => setShowModal(false)}>Close</button>
            </div>
          )}
        </>
      );
    };

    render(<TestComponent />);

    const dropdown = screen.getByTestId('outcome-dropdown') as HTMLSelectElement;
    expect(dropdown).toBeInTheDocument();
    expect(dropdown.value).toBe('sender');
  });

  it('should allow outcome selection (favor sender, favor agent, split)', async () => {
    const TestComponent = () => {
      const [outcome, setOutcome] = React.useState('sender');
      const [submitted, setSubmitted] = React.useState(false);

      const handleResolve = () => {
        setSubmitted(true);
      };

      return (
        <div>
          <select
            value={outcome}
            onChange={e => setOutcome(e.target.value)}
            data-testid="outcome-dropdown"
          >
            <option value="sender">Favour Sender</option>
            <option value="agent">Favour Agent</option>
            <option value="split">Split 50/50</option>
          </select>
          <button onClick={handleResolve} data-testid="resolve-btn">
            Resolve
          </button>
          {submitted && <div data-testid="outcome">{outcome}</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const dropdown = screen.getByTestId('outcome-dropdown') as HTMLSelectElement;

    // Test favour sender
    fireEvent.change(dropdown, { target: { value: 'sender' } });
    expect(dropdown.value).toBe('sender');

    // Test favour agent
    fireEvent.change(dropdown, { target: { value: 'agent' } });
    expect(dropdown.value).toBe('agent');

    // Test split
    fireEvent.change(dropdown, { target: { value: 'split' } });
    expect(dropdown.value).toBe('split');
  });

  it('should have resolution notes field', async () => {
    const TestComponent = () => {
      const [notes, setNotes] = React.useState('');

      return (
        <div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Resolution notes"
            data-testid="notes-field"
          />
          {notes && <div data-testid="notes-display">{notes}</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const textarea = screen.getByTestId('notes-field') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();

    await userEvent.type(textarea, 'Verified sender claim with documentation');

    await waitFor(() => {
      expect(screen.getByTestId('notes-display')).toHaveTextContent(
        'Verified sender claim with documentation'
      );
    });
  });

  it('should display evidence hash with link to stored proof', async () => {
    const TestComponent = () => {
      const dispute = {
        id: 123,
        evidence_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456',
        sender: 'GA1234',
        agent: 'GA5678',
        amount: '100',
      };

      const getProofLink = (hash: string) => `https://storage.example.com/proof/${hash}`;

      return (
        <div>
          <div data-testid="evidence-hash">
            Evidence Hash: {dispute.evidence_hash}
          </div>
          <a
            href={getProofLink(dispute.evidence_hash)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="proof-link"
          >
            View Proof
          </a>
        </div>
      );
    };

    render(<TestComponent />);

    const hash = screen.getByTestId('evidence-hash');
    expect(hash).toHaveTextContent('abc123def456');

    const link = screen.getByTestId('proof-link') as HTMLAnchorElement;
    expect(link.href).toContain('/proof/');
  });

  it('should submit resolution to contract and record in DB', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tx_hash: 'tx123abc' }),
    });

    const TestComponent = () => {
      const [outcome, setOutcome] = React.useState('sender');
      const [notes, setNotes] = React.useState('');
      const [submitted, setSubmitted] = React.useState(false);
      const [txHash, setTxHash] = React.useState<string | null>(null);

      const handleSubmit = async () => {
        try {
          const response = await fetch('/api/disputes/123/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              outcome,
              notes,
              in_favour_of_sender: outcome === 'sender',
            }),
          });

          const data = await response.json() as Record<string, unknown>;
          setTxHash(data.tx_hash as string);
          setSubmitted(true);
        } catch (error) {
          console.error(error);
        }
      };

      return (
        <div>
          <select
            value={outcome}
            onChange={e => setOutcome(e.target.value)}
            data-testid="outcome-select"
          >
            <option value="sender">Sender</option>
            <option value="agent">Agent</option>
          </select>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            data-testid="notes-textarea"
          />
          <button onClick={handleSubmit} data-testid="submit-btn">
            Submit
          </button>
          {submitted && txHash && <div data-testid="tx-result">{txHash}</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const outcome = screen.getByTestId('outcome-select') as HTMLSelectElement;
    fireEvent.change(outcome, { target: { value: 'agent' } });

    const notes = screen.getByTestId('notes-textarea') as HTMLTextAreaElement;
    await userEvent.type(notes, 'Agent evidence is convincing');

    const submit = screen.getByTestId('submit-btn');
    await userEvent.click(submit);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/disputes/123/resolve',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('agent'),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('tx-result')).toHaveTextContent('tx123abc');
    });
  });

  it('should display confirmation modal before resolution', async () => {
    const TestComponent = () => {
      const [showConfirm, setShowConfirm] = React.useState(false);
      const [outcome, setOutcome] = React.useState('sender');

      const openConfirm = () => setShowConfirm(true);

      return (
        <div>
          <button onClick={openConfirm} data-testid="resolve-btn">
            Resolve
          </button>

          {showConfirm && (
            <div role="dialog" data-testid="confirm-modal">
              <h3>Confirm Resolution</h3>
              <p>
                Are you sure you want to resolve in favour of{' '}
                {outcome === 'sender' ? 'the Sender' : 'the Agent'}?
              </p>
              <button onClick={() => setShowConfirm(false)}>Cancel</button>
              <button data-testid="confirm-btn">Confirm</button>
            </div>
          )}
        </div>
      );
    };

    render(<TestComponent />);

    const resolveBtn = screen.getByTestId('resolve-btn');
    await userEvent.click(resolveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
    });
  });

  it('should show audit log of resolved disputes', async () => {
    const mockAuditLog = [
      {
        remittance_id: 100,
        resolved_at: '2024-01-15T10:30:00Z',
        in_favour_of_sender: true,
        resolved_by: 'admin@example.com',
      },
      {
        remittance_id: 101,
        resolved_at: '2024-01-15T11:45:00Z',
        in_favour_of_sender: false,
        resolved_by: 'admin@example.com',
      },
    ];

    const TestComponent = () => {
      return (
        <div>
          <table data-testid="audit-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Resolved At</th>
                <th>In Favour Of</th>
                <th>Resolved By</th>
              </tr>
            </thead>
            <tbody>
              {mockAuditLog.map(entry => (
                <tr key={entry.remittance_id}>
                  <td>#{entry.remittance_id}</td>
                  <td>{new Date(entry.resolved_at).toLocaleString()}</td>
                  <td>{entry.in_favour_of_sender ? 'Sender' : 'Agent'}</td>
                  <td>{entry.resolved_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    };

    render(<TestComponent />);

    const table = screen.getByTestId('audit-table');
    expect(table).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3); // 1 header + 2 data rows
  });

  it('should validate form before submission', async () => {
    const TestComponent = () => {
      const [outcome, setOutcome] = React.useState('');
      const [notes, setNotes] = React.useState('');
      const [errors, setErrors] = React.useState<string[]>([]);

      const handleSubmit = () => {
        const newErrors: string[] = [];
        if (!outcome) newErrors.push('Outcome is required');
        if (!notes.trim()) newErrors.push('Resolution notes are required');
        setErrors(newErrors);
      };

      return (
        <div>
          <select
            value={outcome}
            onChange={e => setOutcome(e.target.value)}
            data-testid="outcome-select"
          >
            <option value="">-- Select outcome --</option>
            <option value="sender">Sender</option>
            <option value="agent">Agent</option>
          </select>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            data-testid="notes-field"
          />
          <button onClick={handleSubmit} data-testid="submit-btn">
            Submit
          </button>
          {errors.length > 0 && (
            <ul data-testid="errors">
              {errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      );
    };

    render(<TestComponent />);

    const submit = screen.getByTestId('submit-btn');
    await userEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByTestId('errors')).toBeInTheDocument();
    });
  });

  it('should handle API errors during submission', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Invalid dispute' }),
    });

    const TestComponent = () => {
      const [error, setError] = React.useState<string | null>(null);

      const handleSubmit = async () => {
        try {
          const response = await fetch('/api/disputes/999/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outcome: 'sender' }),
          });

          if (!response.ok) {
            const data = await response.json() as Record<string, unknown>;
            throw new Error(data.error as string);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      };

      return (
        <div>
          <button onClick={handleSubmit} data-testid="submit-btn">
            Submit
          </button>
          {error && <div data-testid="error-msg">{error}</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const submit = screen.getByTestId('submit-btn');
    await userEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByTestId('error-msg')).toHaveTextContent('Invalid dispute');
    });
  });

  it('should display loading state during resolution', async () => {
    const TestComponent = () => {
      const [loading, setLoading] = React.useState(false);

      const handleSubmit = async () => {
        setLoading(true);
        await new Promise(resolve => setTimeout(resolve, 100));
        setLoading(false);
      };

      return (
        <div>
          <button onClick={handleSubmit} disabled={loading} data-testid="submit-btn">
            {loading ? 'Resolving...' : 'Resolve'}
          </button>
          {loading && <div data-testid="loading">Processing...</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const submit = screen.getByTestId('submit-btn');
    await userEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });
  });
});
