/**
 * Issue #852 / #950 wiring test.
 *
 * NotificationService.notifyRemittanceStatus() (SendGrid email + Twilio SMS,
 * localized via SR-035 templates) was fully implemented but never called
 * from RemittanceEventEmitter.emitStatusChange() in production code. This
 * asserts that once wired via setNotificationService(), a status-changed
 * event actually triggers an outbound email and SMS send.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

import { RemittanceEventEmitter } from '../remittance/events';
import { NotificationService } from '../notification-service';

const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

function fakePool(prefsRow: Record<string, unknown> | null) {
  return {
    query: vi.fn().mockResolvedValue({ rows: prefsRow ? [prefsRow] : [], rowCount: prefsRow ? 1 : 0 }),
  } as any;
}

describe('RemittanceEventEmitter -> NotificationService wiring', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.SENDGRID_API_KEY = 'test-sendgrid-key';
    process.env.TWILIO_ACCOUNT_SID = 'test-sid';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_FROM_NUMBER = '+15550000000';
    mockedAxios.post = vi.fn().mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
  });

  it('sends an email and SMS when a remittance completes', async () => {
    const pool = fakePool({
      user_id: 'user-1',
      email: 'user@example.com',
      phone: '+15551234567',
      email_opt_in: true,
      sms_opt_in: true,
      preferred_language: 'en',
    });

    const emitter = new RemittanceEventEmitter();
    emitter.setNotificationService(new NotificationService(pool));

    await emitter.emitStatusChange({
      remittanceId: 'rem-1',
      status: 'completed',
      amount: 100,
      currency: 'USDC',
      recipientId: 'user-1',
      timestamp: new Date(),
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.anything(),
      expect.anything(),
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('api.twilio.com'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('does not send a notification when the user has not opted in', async () => {
    const pool = fakePool({
      user_id: 'user-2',
      email: 'user2@example.com',
      phone: '+15551234567',
      email_opt_in: false,
      sms_opt_in: false,
      preferred_language: 'en',
    });

    const emitter = new RemittanceEventEmitter();
    emitter.setNotificationService(new NotificationService(pool));

    await emitter.emitStatusChange({
      remittanceId: 'rem-2',
      status: 'failed',
      amount: 50,
      currency: 'USDC',
      recipientId: 'user-2',
      timestamp: new Date(),
    });

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('skips notification dispatch entirely when no NotificationService is wired', async () => {
    const emitter = new RemittanceEventEmitter();

    await expect(
      emitter.emitStatusChange({
        remittanceId: 'rem-3',
        status: 'completed',
        amount: 10,
        currency: 'USDC',
        recipientId: 'user-3',
        timestamp: new Date(),
      }),
    ).resolves.not.toThrow();

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
