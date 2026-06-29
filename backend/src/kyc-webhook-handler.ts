/**
 * SEP-12 KYC Status Webhook Handler
 * 
 * Receives push notifications from anchors when KYC status changes.
 * Reduces polling load by allowing anchors to push status updates.
 */

import { Request, Response } from 'express';
import { saveUserKycStatus } from './database';
import { createLogger } from './correlation-id';

const logger = createLogger('kyc-webhook');

export interface KycWebhookPayload {
  user_id?: string;
  external_id?: string;
  status: 'APPROVED' | 'REJECTED' | 'PENDING' | 'NEEDS_INFO';
  timestamp?: number;
  [key: string]: unknown;
}

/**
 * Verify anchor webhook signature (if anchor sends one).
 * For now, we accept webhooks from known anchors.
 */
export function verifyAnchorSignature(
  anchorId: string,
  signature?: string,
): boolean {
  // In production, verify HMAC signature from anchor
  // For now, we trust anchors by ID
  const trustedAnchors = process.env.TRUSTED_ANCHOR_IDS?.split(',') || [];
  return trustedAnchors.includes(anchorId);
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

/**
 * Handle SEP-12 KYC webhook callback from anchor.
 */
export async function handleKycWebhook(req: Request, res: Response): Promise<void> {
  const { anchor_id } = req.params;
  const payload: KycWebhookPayload = req.body;

  try {
    if (!payload.user_id && !payload.external_id) {
      logger.warn('KYC webhook missing user_id and external_id', { anchor_id, payload });
      res.status(400).json({ error: 'Missing user_id or external_id' });
      return;
    }

    const userId = payload.user_id || payload.external_id;
    const internalStatus = mapKycStatus(payload.status);

    logger.info('Processing KYC webhook', { anchor_id, userId, status: internalStatus });

    // Upsert KYC status
    await saveUserKycStatus({
      user_id: userId,
      anchor_id,
      status: internalStatus,
      updated_at: new Date(payload.timestamp ? payload.timestamp * 1000 : Date.now()),
    });

    logger.info('KYC webhook processed successfully', { anchor_id, userId });
    res.status(200).json({ success: true, message: 'KYC status updated' });
  } catch (error) {
    logger.error('Error processing KYC webhook', error, { anchor_id, payload });
    res.status(500).json({ error: 'Failed to process KYC webhook' });
  }
}
