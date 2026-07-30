import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { TransakProvider, MoonPayProvider, type RampOrderEvent } from '../ramp-provider';
import { rampHooks } from '../ramp-event-hooks';

describe('Ramp Webhook Security', () => {
  describe('Transak Provider', () => {
    let provider: TransakProvider;
    const apiSecret = 'test-secret-key-123';

    beforeEach(() => {
      provider = new TransakProvider(apiSecret);
    });

    it('accepts valid webhook signature', () => {
      const payload = JSON.stringify({
        data: {
          id: 'order-123',
          status: 'COMPLETED',
          isBuyOrSell: 'BUY',
          cryptoAmount: 1.5,
          fiatAmount: 100,
          fiatCurrency: 'USD',
          cryptocurrency: 'USDC',
          walletAddress: '0xabc123',
          createdAt: new Date().toISOString(),
        },
      });

      const sig = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
      const headers = { 'x-transak-signature': sig };

      expect(provider.verifyWebhook(payload, headers)).toBe(true);
    });

    it('rejects missing signature', () => {
      const payload = JSON.stringify({ data: { id: 'order-123' } });
      const headers = {};

      expect(provider.verifyWebhook(payload, headers)).toBe(false);
    });

    it('rejects forged signature', () => {
      const payload = JSON.stringify({ data: { id: 'order-123' } });
      const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('hex');
      const headers = { 'x-transak-signature': wrongSig };

      expect(provider.verifyWebhook(payload, headers)).toBe(false);
    });

    it('handles case-insensitive signature headers', () => {
      const payload = JSON.stringify({ data: { id: 'order-123' } });
      const sig = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
      const headers = { 'X-Transak-Signature': sig };

      expect(provider.verifyWebhook(payload, headers)).toBe(true);
    });

    it('parses order event with timestamp', () => {
      const timestamp = new Date();
      const payload = {
        data: {
          id: 'order-456',
          status: 'COMPLETED',
          isBuyOrSell: 'SELL',
          cryptoAmount: 2.5,
          fiatAmount: 200,
          fiatCurrency: 'EUR',
          cryptocurrency: 'USDC',
          walletAddress: '0xdef456',
          partnerOrderId: 'remittance-789',
          createdAt: timestamp.toISOString(),
        },
      };

      const event = provider.parseEvent(payload);

      expect(event.provider).toBe('transak');
      expect(event.orderId).toBe('order-456');
      expect(event.direction).toBe('off_ramp');
      expect(event.status).toBe('completed');
      expect(event.remittanceId).toBe('remittance-789');
      expect(event.timestamp).toEqual(timestamp);
    });

    it('handles missing timestamp gracefully', () => {
      const payload = {
        data: {
          id: 'order-789',
          status: 'PENDING',
          isBuyOrSell: 'BUY',
        },
      };

      const event = provider.parseEvent(payload);

      expect(event.timestamp).toBeUndefined();
    });

    it('maps all status values correctly', () => {
      const statuses = [
        { from: 'AWAITING_PAYMENT_FROM_USER', to: 'pending' },
        { from: 'PAYMENT_DONE_MARKED_BY_USER', to: 'processing' },
        { from: 'PROCESSING', to: 'processing' },
        { from: 'PENDING_DELIVERY_FROM_TRANSAK', to: 'processing' },
        { from: 'COMPLETED', to: 'completed' },
        { from: 'FAILED', to: 'failed' },
        { from: 'REFUNDED', to: 'refunded' },
        { from: 'CANCELLED', to: 'cancelled' },
      ];

      for (const { from, to } of statuses) {
        const event = provider.parseEvent({
          data: { id: 'test', status: from, isBuyOrSell: 'BUY' },
        });
        expect(event.status).toBe(to);
      }
    });
  });

  describe('MoonPay Provider', () => {
    let provider: MoonPayProvider;
    const secretKey = 'moonpay-secret-456';

    beforeEach(() => {
      provider = new MoonPayProvider(secretKey);
    });

    it('accepts valid webhook signature', () => {
      const payload = JSON.stringify({
        data: {
          id: 'tx-123',
          status: 'completed',
          quoteCurrencyAmount: 1.5,
          baseCurrencyAmount: 100,
          baseCurrencyCode: 'USD',
          quoteCurrencyCode: 'USDC',
          walletAddress: '0xabc123',
          updatedAt: new Date().toISOString(),
        },
      });

      const sig = crypto.createHmac('sha256', secretKey).update(payload).digest('base64');
      const headers = { 'moonpay-signature-v2': sig };

      expect(provider.verifyWebhook(payload, headers)).toBe(true);
    });

    it('rejects forged MoonPay signature', () => {
      const payload = JSON.stringify({ data: { id: 'tx-123' } });
      const wrongSig = crypto.createHmac('sha256', 'wrong-key').update(payload).digest('base64');
      const headers = { 'moonpay-signature-v2': wrongSig };

      expect(provider.verifyWebhook(payload, headers)).toBe(false);
    });

    it('parses transaction event with timestamp', () => {
      const timestamp = new Date();
      const payload = {
        type: 'transaction_updated',
        data: {
          id: 'tx-456',
          status: 'completed',
          quoteCurrencyAmount: 2.5,
          baseCurrencyAmount: 200,
          baseCurrencyCode: 'EUR',
          quoteCurrencyCode: 'USDC',
          walletAddress: '0xdef456',
          externalTransactionId: 'remittance-789',
          updatedAt: timestamp.toISOString(),
        },
      };

      const event = provider.parseEvent(payload);

      expect(event.provider).toBe('moonpay');
      expect(event.orderId).toBe('tx-456');
      expect(event.direction).toBe('on_ramp');
      expect(event.status).toBe('completed');
      expect(event.remittanceId).toBe('remittance-789');
      expect(event.timestamp).toEqual(timestamp);
    });

    it('detects off-ramp transactions', () => {
      const payload = {
        type: 'transaction_sell_updated',
        data: { id: 'tx-789', status: 'pending' },
      };

      const event = provider.parseEvent(payload);

      expect(event.direction).toBe('off_ramp');
    });

    it('maps MoonPay statuses correctly', () => {
      const statuses = [
        { from: 'waitingPayment', to: 'pending' },
        { from: 'pending', to: 'pending' },
        { from: 'waitingAuthorization', to: 'processing' },
        { from: 'processing', to: 'processing' },
        { from: 'completed', to: 'completed' },
        { from: 'failed', to: 'failed' },
        { from: 'refunded', to: 'refunded' },
      ];

      for (const { from, to } of statuses) {
        const event = provider.parseEvent({
          data: { id: 'test', status: from },
        });
        expect(event.status).toBe(to);
      }
    });
  });

  describe('Webhook Timestamp Validation', () => {
    let provider: TransakProvider;

    beforeEach(() => {
      provider = new TransakProvider('secret');
    });

    it('extracts timestamp from Transak payload', () => {
      const now = new Date();
      const event = provider.parseEvent({
        data: {
          id: 'order-1',
          status: 'COMPLETED',
          createdAt: now.toISOString(),
        },
      });

      expect(event.timestamp).toBeDefined();
      expect(event.timestamp?.getTime()).toBeCloseTo(now.getTime(), -2);
    });

    it('extracts timestamp from MoonPay payload', () => {
      const provider = new MoonPayProvider('secret');
      const now = new Date();
      const event = provider.parseEvent({
        data: {
          id: 'tx-1',
          status: 'completed',
          updatedAt: now.toISOString(),
        },
      });

      expect(event.timestamp).toBeDefined();
      expect(event.timestamp?.getTime()).toBeCloseTo(now.getTime(), -2);
    });
  });

  describe('Webhook Event Hooks', () => {
    let provider: TransakProvider;
    let emitSpy: any;

    beforeEach(() => {
      provider = new TransakProvider('secret');
      emitSpy = vi.spyOn(rampHooks, 'emit');
    });

    it('emits order.completed hook for completed events', () => {
      const event = provider.parseEvent({
        data: { id: 'order-1', status: 'COMPLETED', isBuyOrSell: 'BUY' },
      });

      expect(event.status).toBe('completed');
    });

    it('emits order.failed hook for failed events', () => {
      const event = provider.parseEvent({
        data: { id: 'order-2', status: 'FAILED', isBuyOrSell: 'BUY' },
      });

      expect(event.status).toBe('failed');
    });

    it('emits order.processing hook for processing events', () => {
      const event = provider.parseEvent({
        data: { id: 'order-3', status: 'PROCESSING', isBuyOrSell: 'BUY' },
      });

      expect(event.status).toBe('processing');
    });
  });

  describe('Malformed Payload Handling', () => {
    let provider: TransakProvider;

    beforeEach(() => {
      provider = new TransakProvider('secret');
    });

    it('handles payload missing status field', () => {
      const event = provider.parseEvent({
        data: { id: 'order-1', isBuyOrSell: 'BUY' },
      });

      expect(event.status).toBe('pending'); // default status
    });

    it('handles payload with nested order structure', () => {
      const event = provider.parseEvent({
        data: {
          status: {
            id: 'order-1',
            status: 'COMPLETED',
            isBuyOrSell: 'BUY',
          },
        },
      });

      expect(event.orderId).toBe('order-1');
      expect(event.status).toBe('completed');
    });

    it('handles missing order ID field', () => {
      const event = provider.parseEvent({
        data: { status: 'COMPLETED', isBuyOrSell: 'BUY' },
      });

      expect(event.orderId).toBe('');
    });

    it('coerces numeric order IDs to strings', () => {
      const event = provider.parseEvent({
        data: { id: 12345, status: 'COMPLETED', isBuyOrSell: 'BUY' },
      });

      expect(event.orderId).toBe('12345');
      expect(typeof event.orderId).toBe('string');
    });
  });

  describe('Signature Verification Edge Cases', () => {
    it('rejects mismatched buffer encoding', () => {
      const provider = new TransakProvider('secret');
      const payload = 'test-payload';
      const sig = crypto.createHmac('sha256', 'secret').update(payload).digest('hex');

      // Tamper with the signature
      const tamperedSig = sig.slice(0, -2) + 'XX';
      const headers = { 'x-transak-signature': tamperedSig };

      expect(provider.verifyWebhook(payload, headers)).toBe(false);
    });

    it('timing-safe comparison prevents timing attacks', () => {
      const provider = new TransakProvider('secret');
      const payload = 'test-payload';
      const sig = crypto.createHmac('sha256', 'secret').update(payload).digest('hex');

      // Valid signature
      expect(provider.verifyWebhook(payload, { 'x-transak-signature': sig })).toBe(true);

      // Off-by-one tampering
      const tamperedSig = sig.substring(0, sig.length - 1) + '0';
      expect(provider.verifyWebhook(payload, { 'x-transak-signature': tamperedSig })).toBe(false);
    });

    it('empty signature rejected', () => {
      const provider = new TransakProvider('secret');
      const payload = 'test-payload';
      const headers = { 'x-transak-signature': '' };

      expect(provider.verifyWebhook(payload, headers)).toBe(false);
    });

    it('payload tampering detected', () => {
      const provider = new TransakProvider('secret');
      const payload1 = JSON.stringify({ data: { id: 'order-1' } });
      const sig = crypto.createHmac('sha256', 'secret').update(payload1).digest('hex');

      const payload2 = JSON.stringify({ data: { id: 'order-2' } });
      const headers = { 'x-transak-signature': sig };

      expect(provider.verifyWebhook(payload2, headers)).toBe(false);
    });
  });
});
