import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../database', () => ({ saveUserKycStatus: vi.fn().mockResolvedValue(undefined) }));

import { handleKycWebhook, mapKycStatus, verifyAnchorSignature, KycWebhookPayload } from '../kyc-webhook-handler';
import { saveUserKycStatus } from '../database';

const ANCHOR_ID = 'moneygram';
const SECRET_ENV_VAR = 'WEBHOOK_SECRET_MONEYGRAM';
const SECRET = 'test-anchor-shared-secret';

function sign(body: string, timestamp: string): string {
  return crypto.createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
}

function makeRequest(overrides: Partial<any> = {}) {
  const body = overrides.body ?? { user_id: 'user123', status: 'APPROVED' };
  const rawBody = JSON.stringify(body);
  const timestamp = overrides.timestamp ?? String(Date.now());
  const signature = overrides.signature ?? sign(rawBody, timestamp);

  return {
    params: { anchor_id: overrides.anchorId ?? ANCHOR_ID },
    body,
    rawBody,
    headers: {
      'x-webhook-signature': overrides.omitSignature ? undefined : signature,
      'x-webhook-timestamp': overrides.omitTimestamp ? undefined : timestamp,
      'x-webhook-nonce': overrides.nonce,
      ...overrides.headers,
    },
    ...overrides.requestOverrides,
  };
}

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe('KYC Webhook Handler', () => {
  beforeEach(() => {
    process.env[SECRET_ENV_VAR] = SECRET;
    vi.mocked(saveUserKycStatus).mockClear();
  });

  afterEach(() => {
    delete process.env[SECRET_ENV_VAR];
  });

  describe('mapKycStatus', () => {
    it('maps known SEP-12 statuses', () => {
      expect(mapKycStatus('APPROVED')).toBe('approved');
      expect(mapKycStatus('REJECTED')).toBe('rejected');
      expect(mapKycStatus('PENDING')).toBe('pending');
      expect(mapKycStatus('NEEDS_INFO')).toBe('needs_info');
    });

    it('is case-insensitive and defaults unknown values to pending', () => {
      expect(mapKycStatus('approved')).toBe('approved');
      expect(mapKycStatus('UNKNOWN')).toBe('pending');
    });
  });

  describe('verifyAnchorSignature', () => {
    it('accepts a correctly signed, fresh request', () => {
      const rawBody = JSON.stringify({ user_id: 'u1', status: 'APPROVED' });
      const timestamp = String(Date.now());
      const signature = sign(rawBody, timestamp);

      const result = verifyAnchorSignature(ANCHOR_ID, rawBody, signature, timestamp);
      expect(result.ok).toBe(true);
    });

    it('rejects when no secret is configured for the anchor', () => {
      const result = verifyAnchorSignature('unconfigured-anchor', 'body', 'sig', String(Date.now()));
      expect(result.ok).toBe(false);
    });

    it('rejects a tampered body (signature no longer matches)', () => {
      const timestamp = String(Date.now());
      const signature = sign(JSON.stringify({ user_id: 'u1', status: 'APPROVED' }), timestamp);
      const tamperedBody = JSON.stringify({ user_id: 'u1', status: 'REJECTED' });

      const result = verifyAnchorSignature(ANCHOR_ID, tamperedBody, signature, timestamp);
      expect(result.ok).toBe(false);
    });

    it('rejects a stale timestamp outside the acceptable window', () => {
      const rawBody = JSON.stringify({ user_id: 'u1', status: 'APPROVED' });
      const staleTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      const signature = sign(rawBody, staleTimestamp);

      const result = verifyAnchorSignature(ANCHOR_ID, rawBody, signature, staleTimestamp);
      expect(result.ok).toBe(false);
    });

    it('rejects a replayed nonce', () => {
      const rawBody = JSON.stringify({ user_id: 'u1', status: 'APPROVED' });
      const timestamp = String(Date.now());
      const signature = sign(rawBody, timestamp);
      const nonce = 'nonce-1';

      expect(verifyAnchorSignature(ANCHOR_ID, rawBody, signature, timestamp, nonce).ok).toBe(true);
      expect(verifyAnchorSignature(ANCHOR_ID, rawBody, signature, timestamp, nonce).ok).toBe(false);
    });
  });

  describe('handleKycWebhook — signature enforcement (SR-131 regression)', () => {
    it('rejects an unsigned request with 401 and does not touch the database', async () => {
      const req = makeRequest({ omitSignature: true });
      const res = makeResponse();

      await handleKycWebhook(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(saveUserKycStatus).not.toHaveBeenCalled();
    });

    it('rejects a mis-signed request with 401 and does not touch the database', async () => {
      const req = makeRequest({ signature: 'deadbeef'.repeat(8) });
      const res = makeResponse();

      await handleKycWebhook(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(saveUserKycStatus).not.toHaveBeenCalled();
    });

    it('rejects a request signed for a different anchor', async () => {
      const req = makeRequest({ anchorId: 'a-different-anchor' });
      const res = makeResponse();

      await handleKycWebhook(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(saveUserKycStatus).not.toHaveBeenCalled();
    });

    it('accepts a correctly signed request and updates KYC status', async () => {
      const req = makeRequest();
      const res = makeResponse();

      await handleKycWebhook(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(saveUserKycStatus).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user123', anchor_id: ANCHOR_ID, status: 'approved' }),
      );
    });

    it('still validates the body after signature verification passes', async () => {
      const req = makeRequest({ body: { status: 'APPROVED' } }); // no user_id/external_id
      const res = makeResponse();

      await handleKycWebhook(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(saveUserKycStatus).not.toHaveBeenCalled();
    });
  });
});
