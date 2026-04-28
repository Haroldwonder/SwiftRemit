/**
 * Fiat on/off ramp provider interface and adapters.
 *
 * Normalises Transak and MoonPay webhook payloads into a canonical
 * RampOrderEvent so the rest of the system stays provider-agnostic.
 */

import crypto from 'crypto';

// ── Canonical types ────────────────────────────────────────────────

export type RampOrderStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export type RampDirection = 'on_ramp' | 'off_ramp';

export interface RampOrderEvent {
  provider: string;
  orderId: string;
  direction: RampDirection;
  status: RampOrderStatus;
  cryptoAmount?: number;
  fiatAmount?: number;
  fiatCurrency?: string;
  cryptoCurrency?: string;
  walletAddress?: string;
  /** Populated when the order carries a SwiftRemit remittance reference. */
  remittanceId?: string;
  /** Original provider payload for audit. */
  raw: unknown;
}

// ── Provider interface ─────────────────────────────────────────────

export interface RampProvider {
  readonly name: string;
  /** Verify the webhook signature and return true if authentic. */
  verifyWebhook(payload: string, headers: Record<string, string>): boolean;
  /** Normalise the raw provider payload into a canonical RampOrderEvent. */
  parseEvent(payload: unknown): RampOrderEvent;
}

// ── Transak adapter ────────────────────────────────────────────────

export class TransakProvider implements RampProvider {
  readonly name = 'transak';

  constructor(private readonly apiSecret: string) {}

  verifyWebhook(payload: string, headers: Record<string, string>): boolean {
    const sig = headers['x-transak-signature'] ?? headers['X-Transak-Signature'];
    if (!sig) return false;
    const expected = crypto.createHmac('sha256', this.apiSecret).update(payload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parseEvent(payload: unknown): RampOrderEvent {
    const p = payload as any;
    const order = p?.data?.status ?? p?.data ?? p;

    const statusMap: Record<string, RampOrderStatus> = {
      AWAITING_PAYMENT_FROM_USER: 'pending',
      PAYMENT_DONE_MARKED_BY_USER: 'processing',
      PROCESSING: 'processing',
      PENDING_DELIVERY_FROM_TRANSAK: 'processing',
      COMPLETED: 'completed',
      FAILED: 'failed',
      REFUNDED: 'refunded',
      CANCELLED: 'cancelled',
    };

    return {
      provider: this.name,
      orderId: String(order.id ?? order.orderId ?? ''),
      direction: order.isBuyOrSell === 'SELL' ? 'off_ramp' : 'on_ramp',
      status: statusMap[order.status] ?? 'pending',
      cryptoAmount: order.cryptoAmount,
      fiatAmount: order.fiatAmount,
      fiatCurrency: order.fiatCurrency,
      cryptoCurrency: order.cryptocurrency,
      walletAddress: order.walletAddress,
      remittanceId: order.partnerOrderId ?? order.externalId,
      raw: payload,
    };
  }
}

// ── MoonPay adapter ────────────────────────────────────────────────

export class MoonPayProvider implements RampProvider {
  readonly name = 'moonpay';

  constructor(private readonly secretKey: string) {}

  verifyWebhook(payload: string, headers: Record<string, string>): boolean {
    const sig =
      headers['moonpay-signature-v2'] ??
      headers['MoonPay-Signature-V2'] ??
      headers['x-moonpay-signature'];
    if (!sig) return false;
    const expected = crypto.createHmac('sha256', this.secretKey).update(payload).digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parseEvent(payload: unknown): RampOrderEvent {
    const p = payload as any;
    const tx = p?.data ?? p;

    const statusMap: Record<string, RampOrderStatus> = {
      waitingPayment: 'pending',
      pending: 'pending',
      waitingAuthorization: 'processing',
      processing: 'processing',
      completed: 'completed',
      failed: 'failed',
      refunded: 'refunded',
    };

    return {
      provider: this.name,
      orderId: String(tx.id ?? ''),
      direction: p.type === 'transaction_sell_updated' ? 'off_ramp' : 'on_ramp',
      status: statusMap[tx.status] ?? 'pending',
      cryptoAmount: tx.quoteCurrencyAmount,
      fiatAmount: tx.baseCurrencyAmount,
      fiatCurrency: tx.baseCurrencyCode,
      cryptoCurrency: tx.quoteCurrencyCode,
      walletAddress: tx.walletAddress,
      remittanceId: tx.externalTransactionId,
      raw: payload,
    };
  }
}

// ── Provider registry ──────────────────────────────────────────────

const _providers = new Map<string, RampProvider>();

export function registerProvider(provider: RampProvider): void {
  _providers.set(provider.name, provider);
}

export function getProvider(name: string): RampProvider | undefined {
  return _providers.get(name);
}

export function listProviders(): string[] {
  return Array.from(_providers.keys());
}
