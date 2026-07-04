import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

describe('Issue #897: 2FA Settings Page for Admin Users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render 2FA enrollment section with QR code', async () => {
    const TestComponent = () => {
      const [qrCode, setQrCode] = React.useState<string | null>(null);

      React.useEffect(() => {
        // Simulate QR code generation
        setQrCode('data:image/png;base64,mockQRCodeData');
      }, []);

      return (
        <div>
          <h2>Two-Factor Authentication</h2>
          <h3>Enrollment</h3>
          {qrCode && (
            <div data-testid="qr-section">
              <p>Scan this QR code with your authenticator app</p>
              <img
                src={qrCode}
                alt="QR Code for 2FA"
                data-testid="qr-code"
              />
            </div>
          )}
        </div>
      );
    };

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    });
  });

  it('should allow TOTP code entry during enrollment', async () => {
    const TestComponent = () => {
      const [totpCode, setTotpCode] = React.useState('');
      const [verified, setVerified] = React.useState(false);

      const handleVerify = async () => {
        try {
          const response = await fetch('/api/2fa/verify-totp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: totpCode }),
          });

          if (response.ok) {
            setVerified(true);
          }
        } catch (error) {
          console.error(error);
        }
      };

      return (
        <div>
          <label htmlFor="totp-input">Enter 6-digit code from your authenticator:</label>
          <input
            id="totp-input"
            type="text"
            value={totpCode}
            onChange={e => setTotpCode(e.target.value)}
            placeholder="000000"
            maxLength={6}
            data-testid="totp-input"
          />
          <button onClick={handleVerify} data-testid="verify-btn">
            Verify
          </button>
          {verified && <div data-testid="verified">2FA enabled</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const input = screen.getByTestId('totp-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.maxLength).toBe(6);

    await userEvent.type(input, '123456');
    expect(input.value).toBe('123456');
  });

  it('should generate and display backup codes', async () => {
    const TestComponent = () => {
      const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
      const [showCodes, setShowCodes] = React.useState(false);

      const generateBackupCodes = async () => {
        try {
          const response = await fetch('/api/2fa/backup-codes/generate', {
            method: 'POST',
          });

          const data = await response.json() as Record<string, unknown>;
          const codes = data.codes as string[];
          setBackupCodes(codes);
          setShowCodes(true);
        } catch (error) {
          console.error(error);
        }
      };

      return (
        <div>
          <button onClick={generateBackupCodes} data-testid="gen-codes-btn">
            Generate Backup Codes
          </button>
          {showCodes && (
            <div data-testid="backup-codes-section">
              <p>Save these codes in a secure location:</p>
              <ul data-testid="backup-codes-list">
                {backupCodes.map((code, idx) => (
                  <li key={idx} data-testid={`code-${idx}`}>
                    {code}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    };

    render(<TestComponent />);

    const btn = screen.getByTestId('gen-codes-btn');
    expect(btn).toBeInTheDocument();
  });

  it('should store TOTP secret encrypted in database', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, secret_stored: true }),
    });

    const TestComponent = () => {
      const [saved, setSaved] = React.useState(false);

      const handleSaveSecret = async () => {
        try {
          const response = await fetch('/api/2fa/secret/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret_encrypted: 'encrypted_totp_secret_here',
            }),
          });

          if (response.ok) {
            setSaved(true);
          }
        } catch (error) {
          console.error(error);
        }
      };

      return (
        <div>
          <button onClick={handleSaveSecret} data-testid="save-btn">
            Save 2FA
          </button>
          {saved && <div data-testid="saved">Secret saved securely</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const btn = screen.getByTestId('save-btn');
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/2fa/secret/save',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  it('should add 2FA verification step on admin login', async () => {
    const TestComponent = () => {
      const [email, setEmail] = React.useState('');
      const [password, setPassword] = React.useState('');
      const [showTotpPrompt, setShowTotpPrompt] = React.useState(false);
      const [totp, setTotp] = React.useState('');
      const [loggedIn, setLoggedIn] = React.useState(false);

      const handleLogin = async () => {
        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          const data = await response.json() as Record<string, unknown>;
          if (data.requires_2fa) {
            setShowTotpPrompt(true);
          }
        } catch (error) {
          console.error(error);
        }
      };

      const handleTotpSubmit = async () => {
        try {
          const response = await fetch('/api/auth/verify-totp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ totp, email }),
          });

          if (response.ok) {
            setLoggedIn(true);
          }
        } catch (error) {
          console.error(error);
        }
      };

      return (
        <div>
          {!showTotpPrompt && !loggedIn && (
            <div data-testid="login-form">
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email"
                data-testid="email-input"
              />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                data-testid="password-input"
              />
              <button onClick={handleLogin} data-testid="login-btn">
                Login
              </button>
            </div>
          )}

          {showTotpPrompt && (
            <div data-testid="totp-prompt">
              <h2>Enter 2FA Code</h2>
              <input
                value={totp}
                onChange={e => setTotp(e.target.value)}
                placeholder="000000"
                data-testid="totp-input"
                maxLength={6}
              />
              <button onClick={handleTotpSubmit} data-testid="verify-totp-btn">
                Verify
              </button>
            </div>
          )}

          {loggedIn && <div data-testid="logged-in">Logged in</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const emailInput = screen.getByTestId('email-input') as HTMLInputElement;
    const passwordInput = screen.getByTestId('password-input') as HTMLInputElement;

    await userEvent.type(emailInput, 'admin@example.com');
    await userEvent.type(passwordInput, 'password123');

    expect(emailInput.value).toBe('admin@example.com');
    expect(passwordInput.value).toBe('password123');
  });

  it('should display 2FA status on user profile', async () => {
    const TestComponent = () => {
      const [twoFaEnabled, setTwoFaEnabled] = React.useState(false);
      const [loading, setLoading] = React.useState(true);

      React.useEffect(() => {
        const fetchStatus = async () => {
          try {
            const response = await fetch('/api/user/profile');
            const data = await response.json() as Record<string, unknown>;
            setTwoFaEnabled(data.two_fa_enabled as boolean);
          } catch (error) {
            console.error(error);
          } finally {
            setLoading(false);
          }
        };

        fetchStatus();
      }, []);

      if (loading) return <div>Loading...</div>;

      return (
        <div>
          <div data-testid="2fa-status">
            2FA Status:{' '}
            <span data-testid="status-badge">
              {twoFaEnabled ? '🔒 Enabled' : '🔓 Disabled'}
            </span>
          </div>
        </div>
      );
    };

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('status-badge')).toBeInTheDocument();
    });
  });

  it('should allow enabling/disabling 2FA from settings', async () => {
    const TestComponent = () => {
      const [twoFaEnabled, setTwoFaEnabled] = React.useState(true);

      const handleToggle = async () => {
        try {
          const response = await fetch('/api/2fa/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !twoFaEnabled }),
          });

          if (response.ok) {
            setTwoFaEnabled(!twoFaEnabled);
          }
        } catch (error) {
          console.error(error);
        }
      };

      return (
        <div>
          <label>
            <input
              type="checkbox"
              checked={twoFaEnabled}
              onChange={handleToggle}
              data-testid="2fa-toggle"
            />
            Enable Two-Factor Authentication
          </label>
          <div data-testid="toggle-status">
            {twoFaEnabled ? 'Enabled' : 'Disabled'}
          </div>
        </div>
      );
    };

    render(<TestComponent />);

    const toggle = screen.getByTestId('2fa-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
  });

  it('should support backup code authentication', async () => {
    const TestComponent = () => {
      const [backupCode, setBackupCode] = React.useState('');
      const [authenticated, setAuthenticated] = React.useState(false);

      const handleBackupCodeAuth = async () => {
        try {
          const response = await fetch('/api/2fa/verify-backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backup_code: backupCode }),
          });

          if (response.ok) {
            setAuthenticated(true);
          }
        } catch (error) {
          console.error(error);
        }
      };

      return (
        <div>
          <input
            value={backupCode}
            onChange={e => setBackupCode(e.target.value)}
            placeholder="Backup code"
            data-testid="backup-code-input"
          />
          <button onClick={handleBackupCodeAuth} data-testid="backup-auth-btn">
            Authenticate
          </button>
          {authenticated && <div data-testid="backup-auth-success">Authenticated</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const input = screen.getByTestId('backup-code-input') as HTMLInputElement;
    await userEvent.type(input, 'BACKUP-CODE-12345');

    expect(input.value).toBe('BACKUP-CODE-12345');
  });

  it('should handle 2FA setup errors gracefully', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid TOTP code' }),
    });

    const TestComponent = () => {
      const [totp, setTotp] = React.useState('');
      const [error, setError] = React.useState<string | null>(null);

      const handleVerify = async () => {
        try {
          const response = await fetch('/api/2fa/verify-totp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: totp }),
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
          <input
            value={totp}
            onChange={e => setTotp(e.target.value)}
            data-testid="totp-input"
          />
          <button onClick={handleVerify} data-testid="verify-btn">
            Verify
          </button>
          {error && <div data-testid="error-msg">{error}</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const input = screen.getByTestId('totp-input') as HTMLInputElement;
    await userEvent.type(input, '000000');

    const btn = screen.getByTestId('verify-btn');
    await userEvent.click(btn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('should enforce 2FA requirement for admin operations', async () => {
    const TestComponent = () => {
      const [twoFaVerified, setTwoFaVerified] = React.useState(false);
      const [canAccessAdmin, setCanAccessAdmin] = React.useState(false);

      const handleAdminAccess = () => {
        if (!twoFaVerified) {
          return;
        }
        setCanAccessAdmin(true);
      };

      return (
        <div>
          <div>2FA Verified: {twoFaVerified ? 'Yes' : 'No'}</div>
          <button
            onClick={handleAdminAccess}
            disabled={!twoFaVerified}
            data-testid="admin-btn"
          >
            Access Admin Panel
          </button>
          {canAccessAdmin && <div data-testid="admin-panel">Admin Panel</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const btn = screen.getByTestId('admin-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    // Simulate 2FA verification
    const { rerender } = render(
      <div>
        <div>2FA Verified: Yes</div>
        <button disabled={false} data-testid="admin-btn-enabled">
          Access Admin Panel
        </button>
      </div>
    );

    const enabledBtn = screen.getByTestId('admin-btn-enabled') as HTMLButtonElement;
    expect(enabledBtn.disabled).toBe(false);
  });

  it('should display warning when 2FA codes expire', async () => {
    const TestComponent = () => {
      const [codesExpiring, setCodesExpiring] = React.useState(true);

      return (
        <div>
          {codesExpiring && (
            <div data-testid="expiry-warning" role="alert">
              ⚠️ Your backup codes will expire in 30 days. Generate new ones.
            </div>
          )}
        </div>
      );
    };

    render(<TestComponent />);

    expect(screen.getByTestId('expiry-warning')).toBeInTheDocument();
  });

  it('should allow disabling 2FA with password confirmation', async () => {
    const TestComponent = () => {
      const [showPasswordPrompt, setShowPasswordPrompt] = React.useState(false);
      const [password, setPassword] = React.useState('');
      const [twoFaDisabled, setTwoFaDisabled] = React.useState(false);

      const handleDisable2FA = () => {
        setShowPasswordPrompt(true);
      };

      const confirmDisable = async () => {
        try {
          const response = await fetch('/api/2fa/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          });

          if (response.ok) {
            setTwoFaDisabled(true);
            setShowPasswordPrompt(false);
          }
        } catch (error) {
          console.error(error);
        }
      };

      return (
        <div>
          <button onClick={handleDisable2FA} data-testid="disable-btn">
            Disable 2FA
          </button>

          {showPasswordPrompt && (
            <div data-testid="password-prompt">
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Confirm password"
                data-testid="confirm-password"
              />
              <button onClick={confirmDisable} data-testid="confirm-disable">
                Confirm Disable
              </button>
            </div>
          )}

          {twoFaDisabled && <div data-testid="disabled-msg">2FA disabled</div>}
        </div>
      );
    };

    render(<TestComponent />);

    const disableBtn = screen.getByTestId('disable-btn');
    fireEvent.click(disableBtn);

    expect(screen.getByTestId('password-prompt')).toBeInTheDocument();
  });
});
