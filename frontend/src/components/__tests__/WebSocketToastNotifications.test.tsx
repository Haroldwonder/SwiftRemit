import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useToast, ToastContainer, type ToastMessage } from '../Toast';

// Mock Socket.io
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

describe('Issue #899: Real-time Toast Notifications for WebSocket Events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should subscribe to Socket.io remittance:completed events', () => {
    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      React.useEffect(() => {
        mockSocket.on('remittance:completed', (data: { id: number }) => {
          showToast(`Remittance #${data.id} completed`, 'success');
        });

        return () => {
          mockSocket.off('remittance:completed');
        };
      }, [showToast]);

      return (
        <div>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    render(<TestComponent />);

    // Simulate Socket.io event
    const callbacks = mockSocket.on.mock.calls;
    const completedCallback = callbacks.find(call => call[0] === 'remittance:completed')?.[1];

    if (completedCallback) {
      completedCallback({ id: 123 });
    }

    expect(mockSocket.on).toHaveBeenCalledWith(
      'remittance:completed',
      expect.any(Function)
    );
  });

  it('should display success toast for remittance:completed event', async () => {
    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      React.useEffect(() => {
        mockSocket.on('remittance:completed', (data: { id: number }) => {
          showToast(`Remittance #${data.id} completed successfully`, 'success');
        });

        return () => {
          mockSocket.off('remittance:completed');
        };
      }, [showToast]);

      return (
        <div>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    render(<TestComponent />);

    // Trigger the event
    const callback = mockSocket.on.mock.calls.find(
      call => call[0] === 'remittance:completed'
    )?.[1];

    if (callback) {
      callback({ id: 456 });
    }

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('should display error toast for remittance:failed event', async () => {
    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      React.useEffect(() => {
        mockSocket.on('remittance:failed', (data: { id: number; reason: string }) => {
          showToast(`Remittance #${data.id} failed: ${data.reason}`, 'error');
        });

        return () => {
          mockSocket.off('remittance:failed');
        };
      }, [showToast]);

      return (
        <div>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    render(<TestComponent />);

    const failedCallback = mockSocket.on.mock.calls.find(
      call => call[0] === 'remittance:failed'
    )?.[1];

    if (failedCallback) {
      failedCallback({ id: 789, reason: 'Invalid recipient' });
    }

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveClass('error');
    });
  });

  it('should display warning toast for remittance:disputed event', async () => {
    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      React.useEffect(() => {
        mockSocket.on('remittance:disputed', (data: { id: number }) => {
          showToast(`Remittance #${data.id} has been disputed`, 'warning');
        });

        return () => {
          mockSocket.off('remittance:disputed');
        };
      }, [showToast]);

      return (
        <div>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    render(<TestComponent />);

    const disputedCallback = mockSocket.on.mock.calls.find(
      call => call[0] === 'remittance:disputed'
    )?.[1];

    if (disputedCallback) {
      disputedCallback({ id: 999 });
    }

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveClass('warning');
    });
  });

  it('should auto-dismiss toast after 10 seconds (for success)', async () => {
    vi.useFakeTimers();

    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      return (
        <div>
          <button onClick={() => showToast('Test message', 'success', 10000)}>
            Show Toast
          </button>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    render(<TestComponent />);

    const button = screen.getByRole('button', { name: 'Show Toast' });
    await userEvent.click(button);

    // Toast should be present initially
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Fast-forward 10 seconds
    vi.advanceTimersByTime(10000);

    // Toast should be dismissed
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    vi.useRealTimers();
  });

  it('should allow manual dismissal of toast', async () => {
    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      return (
        <div>
          <button onClick={() => showToast('Click to dismiss', 'info')}>
            Show Toast
          </button>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    render(<TestComponent />);

    const button = screen.getByRole('button', { name: 'Show Toast' });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const closeButton = screen.getByLabelText('Dismiss notification');
    await userEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('should pause auto-dismiss when hovering over toast', async () => {
    vi.useFakeTimers();

    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      return (
        <div>
          <button onClick={() => showToast('Hover test', 'success', 3000)}>
            Show Toast
          </button>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    render(<TestComponent />);

    const button = screen.getByRole('button', { name: 'Show Toast' });
    await userEvent.click(button);

    const toast = await screen.findByRole('alert');

    // Hover over toast
    await userEvent.hover(toast);

    // Advance time but not enough for dismissal
    vi.advanceTimersByTime(2000);

    // Toast should still be visible
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Leave hover
    await userEvent.unhover(toast);

    // Advance past the remaining time
    vi.advanceTimersByTime(2000);

    // Now it should be dismissed
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }, { timeout: 1000 });

    vi.useRealTimers();
  });

  it('should handle multiple concurrent toasts', async () => {
    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      return (
        <div>
          <button
            onClick={() => {
              showToast('Message 1', 'success');
              showToast('Message 2', 'error');
              showToast('Message 3', 'info');
            }}
          >
            Show Multiple
          </button>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    render(<TestComponent />);

    await userEvent.click(screen.getByRole('button', { name: 'Show Multiple' }));

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts).toHaveLength(3);
    });
  });

  it('should unsubscribe from socket events on unmount', async () => {
    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      React.useEffect(() => {
        mockSocket.on('remittance:completed', () => {
          showToast('Remittance completed', 'success');
        });

        return () => {
          mockSocket.off('remittance:completed');
        };
      }, [showToast]);

      return (
        <div>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    const { unmount } = render(<TestComponent />);

    unmount();

    expect(mockSocket.off).toHaveBeenCalledWith('remittance:completed');
  });

  it('should display toast without page refresh on event', async () => {
    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();

      React.useEffect(() => {
        mockSocket.on('remittance:completed', (data: { id: number }) => {
          showToast(`Remittance #${data.id} completed`, 'success');
        });

        return () => {
          mockSocket.off('remittance:completed');
        };
      }, [showToast]);

      return (
        <div>
          <p>Main content here</p>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    const { rerender } = render(<TestComponent />);

    // Trigger socket event
    const callback = mockSocket.on.mock.calls.find(
      call => call[0] === 'remittance:completed'
    )?.[1];

    if (callback) {
      callback({ id: 555 });
    }

    // Main content should still be visible
    expect(screen.getByText('Main content here')).toBeInTheDocument();

    // Toast should appear without re-render
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('should handle socket connection errors gracefully', async () => {
    const TestComponent = () => {
      const { toasts, showToast, dismissToast } = useToast();
      const [connected, setConnected] = React.useState(true);

      React.useEffect(() => {
        mockSocket.on('disconnect', () => {
          setConnected(false);
          showToast('Connection lost. Attempting to reconnect...', 'warning');
        });

        mockSocket.on('connect', () => {
          setConnected(true);
          showToast('Reconnected', 'info');
        });

        return () => {
          mockSocket.off('disconnect');
          mockSocket.off('connect');
        };
      }, [showToast]);

      return (
        <div>
          <div data-testid="status">{connected ? 'Connected' : 'Disconnected'}</div>
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      );
    };

    render(<TestComponent />);

    const disconnectCallback = mockSocket.on.mock.calls.find(
      call => call[0] === 'disconnect'
    )?.[1];

    if (disconnectCallback) {
      disconnectCallback();
    }

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('Disconnected');
    });
  });
});
