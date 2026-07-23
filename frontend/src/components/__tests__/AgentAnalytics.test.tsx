/**
 * Unit tests for AgentAnalytics.tsx (Issue #947)
 *
 * Uses vitest + @testing-library/react.
 * fetch is mocked globally so no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { AgentAnalytics } from '../AgentAnalytics';

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENT_ID  = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
const ADMIN_KEY = 'test-admin-key';

// ─── Mock data factories ──────────────────────────────────────────────────────

function buildAnalyticsResponse(overrides?: Partial<{
  total_payouts: number;
  total_earnings_usdc: number;
  avg_confirmation_time_s: number | null;
  reputation_score: number | null;
  time_series: Array<{
    bucket: string;
    payouts: number;
    earnings_usdc: number;
    avg_confirmation_time_s: number | null;
  }>;
}>) {
  return {
    success: true,
    data: {
      summary: {
        agent_id:                AGENT_ID,
        range:                   '30d',
        total_payouts:           overrides?.total_payouts           ?? 42,
        total_earnings_usdc:     overrides?.total_earnings_usdc     ?? 3850.5,
        avg_confirmation_time_s: overrides?.avg_confirmation_time_s ?? 127,
        reputation_score:        overrides?.reputation_score        ?? null,
      },
      time_series: overrides?.time_series ?? [
        {
          bucket:                  '2026-07-01T00:00:00.000Z',
          payouts:                 10,
          earnings_usdc:           900,
          avg_confirmation_time_s: 120,
        },
        {
          bucket:                  '2026-07-08T00:00:00.000Z',
          payouts:                 15,
          earnings_usdc:           1350,
          avg_confirmation_time_s: 130,
        },
      ],
      granularity: 'day',
    },
    timestamp: new Date().toISOString(),
  };
}

// ─── fetch mock helpers ───────────────────────────────────────────────────────

function mockFetch(responseBody: unknown, status = 200) {
  const mockFn = vi.fn().mockResolvedValue({
    status,
    ok: status < 400,
    json: async () => responseBody,
  });
  vi.stubGlobal('fetch', mockFn);
  return mockFn;
}

function mockFetchError(message = 'Network error') {
  const mockFn = vi.fn().mockRejectedValue(new Error(message));
  vi.stubGlobal('fetch', mockFn);
  return mockFn;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AgentAnalytics component (Issue #947)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ─── Rendering ─────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders the section heading', () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      expect(screen.getByRole('heading', { name: /Agent Payout Analytics/i })).toBeInTheDocument();
    });

    it('shows a truncated agent id in the subtitle', () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      expect(screen.getByText(/GAAZI4TC/)).toBeInTheDocument();
    });

    it('renders date-range buttons: 7d, 30d, 90d', () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '90d' })).toBeInTheDocument();
    });

    it('renders granularity buttons: day, week, month', () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      expect(screen.getByRole('button', { name: 'day' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'week' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'month' })).toBeInTheDocument();
    });
  });

  // ─── Loading state ──────────────────────────────────────────────────────────

  describe('loading state', () => {
    it('shows a loading message while fetching', async () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      expect(await screen.findByText(/Loading analytics/i)).toBeInTheDocument();
    });

    it('disables the Refresh button while loading', async () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await screen.findByText(/Loading analytics/i);
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeDisabled();
    });
  });

  // ─── Success state — KPI cards ──────────────────────────────────────────────

  describe('success state — KPI cards', () => {
    beforeEach(() => {
      mockFetch(buildAnalyticsResponse());
    });

    it('displays total payouts', async () => {
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
      expect(screen.getByText(/Total payouts/i)).toBeInTheDocument();
    });

    it('displays total earnings with USDC suffix', async () => {
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(screen.getByText(/3,850.50 USDC/i)).toBeInTheDocument());
    });

    it('formats avg confirmation time in minutes', async () => {
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      // 127s → 2m; appears in both the KPI card and the table rows
      await waitFor(() => {
        const items = screen.getAllByText('2m');
        expect(items.length).toBeGreaterThan(0);
      });
    });

    it('shows N/A for reputation score when null', async () => {
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => {
        const naItems = screen.getAllByText('N/A');
        expect(naItems.length).toBeGreaterThan(0);
      });
    });

    it('displays reputation score when provided', async () => {
      mockFetch(buildAnalyticsResponse({ reputation_score: 87 }));
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(screen.getByText(/87 \/ 100/)).toBeInTheDocument());
    });
  });

  // ─── Charts ─────────────────────────────────────────────────────────────────

  describe('charts', () => {
    it('renders "Payouts over time" chart heading', async () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() =>
        expect(screen.getByText(/Payouts over time/i)).toBeInTheDocument(),
      );
    });

    it('renders "Earnings (USDC) over time" chart heading', async () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() =>
        expect(screen.getByText(/Earnings \(USDC\) over time/i)).toBeInTheDocument(),
      );
    });

    it('shows "No payout events" when time_series is empty', async () => {
      mockFetch(buildAnalyticsResponse({ time_series: [] }));
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() =>
        expect(screen.getByText(/No payout events in this period/i)).toBeInTheDocument(),
      );
    });
  });

  // ─── Detail table ───────────────────────────────────────────────────────────

  describe('detail table', () => {
    it('renders column headers', async () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: /Period/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Payouts/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Earnings/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Avg confirmation/i })).toBeInTheDocument();
      });
    });

    it('renders a row for each time_series bucket', async () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => {
        // 1 header row + 2 data rows
        expect(screen.getAllByRole('row')).toHaveLength(3);
      });
    });

    it('does not render the table when time_series is empty', async () => {
      mockFetch(buildAnalyticsResponse({ time_series: [] }));
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() =>
        expect(screen.queryByRole('table')).not.toBeInTheDocument(),
      );
    });
  });

  // ─── Error state ────────────────────────────────────────────────────────────

  describe('error state', () => {
    it('shows an error alert when fetch rejects', async () => {
      mockFetchError('Request failed');
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() =>
        expect(screen.getByRole('alert')).toBeInTheDocument(),
      );
      expect(screen.getByText(/Request failed/i)).toBeInTheDocument();
    });

    it('shows the server error message from the API body', async () => {
      mockFetch({ success: false, error: { message: 'Agent not found' } }, 404);
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() =>
        expect(screen.getByText(/Agent not found/i)).toBeInTheDocument(),
      );
    });
  });

  // ─── User interactions ───────────────────────────────────────────────────────

  describe('user interactions', () => {
    it('re-fetches when a range button is clicked', async () => {
      const mock = mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

      mock.mockResolvedValue({
        ok: true,
        json: async () => buildAnalyticsResponse({ total_payouts: 99 }),
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '7d' }));
      });

      await waitFor(() => expect(screen.getByText('99')).toBeInTheDocument());
      expect(mock).toHaveBeenCalledTimes(2);
    });

    it('includes granularity=week in URL when that button is clicked', async () => {
      const mock = mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'week' }));
      });

      await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
      const lastUrl = mock.mock.calls[1][0] as string;
      expect(lastUrl).toContain('granularity=week');
    });

    it('re-fetches when Refresh button is clicked', async () => {
      const mock = mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
      });

      await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    });

    it('includes range=30d in the initial fetch URL', async () => {
      const mock = mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(mock).toHaveBeenCalled());
      const url = mock.mock.calls[0][0] as string;
      expect(url).toContain('range=30d');
    });

    it('sends adminApiKey as x-api-key header', async () => {
      const mock = mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(mock).toHaveBeenCalled());
      const opts = mock.mock.calls[0][1] as { headers: Record<string, string> };
      expect(opts.headers['x-api-key']).toBe(ADMIN_KEY);
    });
  });

  // ─── Accessibility ──────────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('has an accessible group for the filter controls', () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      expect(
        screen.getByRole('group', { name: /Analytics filters/i }),
      ).toBeInTheDocument();
    });

    it('marks the active range button as aria-pressed=true', () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('marks the active granularity button as aria-pressed=true', () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      expect(screen.getByRole('button', { name: 'day' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('labels the analytics table for screen readers', async () => {
      mockFetch(buildAnalyticsResponse());
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() =>
        expect(
          screen.getByRole('table', { name: /Payout time series/i }),
        ).toBeInTheDocument(),
      );
    });
  });

  // ─── Duration formatter edge cases ──────────────────────────────────────────

  describe('avg_confirmation_time_s formatting', () => {
    it('shows seconds for < 60s', async () => {
      mockFetch(buildAnalyticsResponse({ avg_confirmation_time_s: 45 }));
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(screen.getByText('45s')).toBeInTheDocument());
    });

    it('shows minutes for 60–3599s', async () => {
      mockFetch(buildAnalyticsResponse({ avg_confirmation_time_s: 180 }));
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(screen.getByText('3m')).toBeInTheDocument());
    });

    it('shows hours for ≥ 3600s', async () => {
      mockFetch(buildAnalyticsResponse({ avg_confirmation_time_s: 7200 }));
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => expect(screen.getByText('2.0h')).toBeInTheDocument());
    });

    it('shows N/A when avg_confirmation_time_s is null', async () => {
      mockFetch(buildAnalyticsResponse({ avg_confirmation_time_s: null }));
      render(<AgentAnalytics agentId={AGENT_ID} adminApiKey={ADMIN_KEY} />);
      await waitFor(() => {
        expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
