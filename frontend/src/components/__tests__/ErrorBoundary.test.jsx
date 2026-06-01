import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import ErrorBoundary from '../ErrorBoundary';

expect.extend(toHaveNoViolations);

const ThrowError = () => {
  throw new Error('Test error');
};

const NormalComponent = () => <div>Normal content</div>;

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Mock fetch for error reporting
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('catches errors and displays fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload/i })).toBeInTheDocument();
  });

  it('shows error details in development mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Error Details/)).toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
  });

  it('does not show error details in production mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.queryByText(/Error Details/)).not.toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
  });

  it('retries and renders children on retry button click', () => {
    let shouldThrow = true;
    function ConditionalChild() {
      if (shouldThrow) throw new Error('Test error');
      return <NormalComponent />;
    }

    render(
      <ErrorBoundary>
        <ConditionalChild />
      </ErrorBoundary>
    );

    // Stop throwing before triggering retry so the re-render succeeds
    shouldThrow = false;
    const retryButton = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryButton);

    expect(screen.getByText('Normal content')).toBeInTheDocument();
  });

  it('has error alert role and live region', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const errorContainer = screen.getByRole('alert');
    expect(errorContainer).toHaveAttribute('aria-live', 'assertive');
    expect(errorContainer).toHaveAttribute('aria-atomic', 'true');
  });

  it('displays error ID when error is caught', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getAllByText(/Error ID:/).length).toBeGreaterThan(0);

    process.env.NODE_ENV = originalEnv;
  });

  it('attempts to report error to backend', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    // Give async error reporting time to execute
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/errors/report',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('reloads page when reload button is clicked', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const reloadButton = screen.getByRole('button', { name: /Reload/i });
    fireEvent.click(reloadButton);

    expect(reloadMock).toHaveBeenCalled();
  });

  it('renders normal children without errors', () => {
    render(
      <ErrorBoundary>
        <NormalComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Normal content')).toBeInTheDocument();
    expect(screen.queryByText('Something Went Wrong')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('has no a11y violations in error fallback state', async () => {
      const { container } = render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no a11y violations when rendering normal children', async () => {
      const { container } = render(
        <ErrorBoundary>
          <NormalComponent />
        </ErrorBoundary>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});