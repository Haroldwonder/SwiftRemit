import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Nodemailer mock ────────────────────────────────────────────────────────────

const sendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
const createTransport = vi.fn().mockReturnValue({ sendMail });

vi.mock('nodemailer', () => ({
  default: { createTransport },
  createTransport,
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  it('logs a warning and does not call sendMail when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    const warnSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { sendEmail } = await import('../email');
    await sendEmail('user@example.com', 'Test Subject', 'body text');

    expect(sendMail).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('calls sendMail with the correct envelope when SMTP is configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'pass';
    process.env.SMTP_FROM = 'no-reply@swiftremit.example';

    const { sendEmail } = await import('../email');
    await sendEmail('recipient@example.com', 'Hello', 'plain text', '<p>html</p>');

    expect(sendMail).toHaveBeenCalledOnce();
    const call = sendMail.mock.calls[0][0];
    expect(call.to).toBe('recipient@example.com');
    expect(call.subject).toBe('Hello');
    expect(call.text).toBe('plain text');
    expect(call.html).toBe('<p>html</p>');
    expect(call.from).toBe('no-reply@swiftremit.example');
  });

  it('uses port 465 (secure) correctly', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';

    const { sendEmail } = await import('../email');
    await sendEmail('a@b.com', 'S', 'T');

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  it('uses non-secure mode for port 587', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';

    const { sendEmail } = await import('../email');
    await sendEmail('a@b.com', 'S', 'T');

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it('uses default from address when SMTP_FROM is not set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    delete process.env.SMTP_FROM;

    const { sendEmail } = await import('../email');
    await sendEmail('x@y.com', 'S', 'T');

    const call = sendMail.mock.calls[0][0];
    expect(call.from).toBe('no-reply@swiftremit.example');
  });

  it('omits auth when SMTP_USER / SMTP_PASS are not set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const { sendEmail } = await import('../email');
    await sendEmail('x@y.com', 'S', 'T');

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });
});
