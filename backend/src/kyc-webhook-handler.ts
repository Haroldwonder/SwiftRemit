/**
 * SEP-12 KYC Status Webhook Handler
 *
 * Receives push notifications from anchors when KYC status changes.
 * Reduces polling load by allowing anchors to push status updates.
 *
 * SR-131: this endpoint previously accepted any POST body with zero
 * authentication — verifyAnchorSignature existed but was never called, and
 * even if it had been, it only checked the caller-controlled anchor_id path
 * parameter against an allowlist, not a real signature. Anyone on the
 * internet could flip a user's KYC status, which feeds setKycApprovedOnChain
 * (stellar-kyc.ts). This mirrors the HMAC + timestamp/nonce replay
 * protection already applied to ramp-webhook-handler.ts under SR-045.
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import { saveUserKycStatus } from './database';
import { createLogger } from './correlation-id';

const logger = createLogger('kyc-webhook');

/** Reject webhooks whose timestamp is further than this from "now". */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/** Bound the in-memory replay-nonce cache so it cannot grow unbounded. */
const NONCE_CACHE_MAX_ENTRIES = 10_000;
const NONCE_CACHE_TTL_MS = MAX_TIMESTAMP_SKEW_MS * 2;

/** seen (anchor_id + nonce) -> expiry epoch ms. */
const seenNonces = new Map<string, number>();

function pruneExpiredNonces(now: number): void {
  for (const [key, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(key);
  }
  // Defensive cap in case pruning falls behind under sustained traffic.
  if (seenNonces.size > NONCE_CACHE_MAX_ENTRIES) {
    const oldestKeys = Array.from(seenNonces.keys()).slice(0, seenNonces.size - NONCE_CACHE_MAX_ENTRIES);
    for (const key of oldestKeys) seenNonces.delete(key);
  }
}

export interface KycWebhookPayload {
  user_id?: string;
  external_id?: string;
  status: 'APPROVED' | 'REJECTED' | 'PENDING' | 'NEEDS_INFO';
  timestamp?: number;
  [key: string]: unknown;
}

/**
 * Resolve the per-anchor HMAC secret from the environment, following the
 * same WEBHOOK_SECRET_{ANCHOR_ID} convention referenced in the SR-131 issue.
 * Anchor IDs are normalised (uppercased, non-alphanumeric replaced with `_`)
 * so `sandbox-anchor.example` maps to WEBHOOK_SECRET_SANDBOX_ANCHOR_EXAMPLE.
 */
function anchorSecretEnvVar(anchorId: string): string {
  return `WEBHOOK_SECRET_${anchorId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function getAnchorWebhookSecret(anchorId: string): string | undefined {
  return process.env[anchorSecretEnvVar(anchorId)];
}

/**
 * Verify an anchor webhook's HMAC-SHA256 signature over `${timestamp}.${rawBody}`,
 * using a per-anchor secret (WEBHOOK_SECRET_<ANCHOR_ID>). Also enforces a
 * timestamp window and a nonce replay cache, consistent with SR-045's
 * treatment of ramp provider webhooks.
 *
 * Returns a discriminated result rather than a boolean so callers can return
 * a specific 401 reason without re-deriving it.
 */
export function verifyAnchorSignature(
  anchorId: string,
  rawBody: string,
  signature?: string,
  timestamp?: string,
  nonce?: string,
): { ok: true } | { ok: false; reason: string } {
  const secret = getAnchorWebhookSecret(anchorId);
  if (!secret) {
    return { ok: false, reason: `No webhook secret configured for anchor '${anchorId}'` };
  }
  if (!signature) {
    return { ok: false, reason: 'Missing webhook signature' };
  }
  if (!timestamp) {
    return { ok: false, reason: 'Missing webhook timestamp' };
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: 'Malformed webhook timestamp' };
  }
  if (Math.abs(Date.now() - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: 'Webhook timestamp outside acceptable window' };
  }

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

  let signatureValid: boolean;
  try {
    signatureValid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return { ok: false, reason: 'Invalid webhook signature' };
  }

  if (nonce) {
    const now = Date.now();
    pruneExpiredNonces(now);
    const nonceKey = `${anchorId}:${nonce}`;
    if (seenNonces.has(nonceKey)) {
      return { ok: false, reason: 'Webhook nonce already used (replay)' };
    }
    seenNonces.set(nonceKey, now + NONCE_CACHE_TTL_MS);
  }

  return { ok: true };
}

/**
 * Map KYC webhook status to internal KYC status format.
 */
export function mapKycStatus(status: string): 'approved' | 'rejected' | 'pending' | 'needs_info' {
  const statusMap: Record<string, 'approved' | 'rejected' | 'pending' | 'needs_info'> = {
    APPROVED: 'approved',
    REJECTED: 'rejected',
    PENDING: 'pending',
    NEEDS_INFO: 'needs_info',
  };
  return statusMap[status.toUpperCase()] || 'pending';
}

interface RawBodyRequest extends Request {
  rawBody?: string;
}

/**
 * Handle SEP-12 KYC webhook callback from anchor.
 *
 * Rejects with 401 before touching the database unless the request carries
 * a valid HMAC signature for the target anchor.
 */
export async function handleKycWebhook(req: RawBodyRequest, res: Response): Promise<void> {
  const anchor_id = req.params.anchor_id as string;
  const payload: KycWebhookPayload = req.body;

  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
  const signature = (req.headers['x-webhook-signature'] as string | undefined)
    ?? (req.headers['x-anchor-signature'] as string | undefined);
  const timestamp = req.headers['x-webhook-timestamp'] as string | undefined;
  const nonce = req.headers['x-webhook-nonce'] as string | undefined;

  const verification = verifyAnchorSignature(anchor_id, rawBody, signature, timestamp, nonce);
  if (!verification.ok) {
    logger.warn('Rejected KYC webhook: signature verification failed', {
      anchor_id,
      reason: verification.reason,
    });
    res.status(401).json({ error: 'Invalid webhook signature', reason: verification.reason });
    return;
  }

  try {
    if (!payload.user_id && !payload.external_id) {
      logger.warn('KYC webhook missing user_id and external_id', { anchor_id, payload });
      res.status(400).json({ error: 'Missing user_id or external_id' });
      return;
    }

    const userId = (payload.user_id || payload.external_id) as string;
    const internalStatus = mapKycStatus(payload.status);

    logger.info('Processing KYC webhook', { anchor_id, userId, status: internalStatus });

    // Upsert KYC status
    await saveUserKycStatus({
      user_id: userId,
      anchor_id,
      status: internalStatus,
      last_checked: new Date(payload.timestamp ? payload.timestamp * 1000 : Date.now()),
    });

    logger.info('KYC webhook processed successfully', { anchor_id, userId });
    res.status(200).json({ success: true, message: 'KYC status updated' });
  } catch (error) {
    logger.error('Error processing KYC webhook', error, { anchor_id, payload });
    res.status(500).json({ error: 'Failed to process KYC webhook' });
  }
}
