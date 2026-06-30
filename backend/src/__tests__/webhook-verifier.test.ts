import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhookVerifier } from '../webhook-verifier';
import { Keypair } from '@stellar/stellar-sdk';

describe('WebhookVerifier', () => {
  let verifier: WebhookVerifier;
  let keypair: Keypair;

  beforeEach(() => {
    verifier = new WebhookVerifier(300);
    keypair = Keypair.random();
  });

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const payload = JSON.stringify({ transaction_id: 'test123', status: 'completed' });
      const signature = keypair.sign(Buffer.from(payload)).toString('base64');

      const result = verifier.verifySignature(payload, signature, keypair.publicKey());
      expect(result).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = JSON.stringify({ transaction_id: 'test123' });
      const wrongKeypair = Keypair.random();
      const signature = wrongKeypair.sign(Buffer.from(payload)).toString('base64');

      const result = verifier.verifySignature(payload, signature, keypair.publicKey());
      expect(result).toBe(false);
    });
  });

  describe('verifyHMAC', () => {
    it('should verify valid HMAC', () => {
      const payload = 'test payload';
      const secret = 'test-secret';
      const crypto = require('crypto');
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      const result = verifier.verifyHMAC(payload, signature, secret);
      expect(result).toBe(true);
    });

    it('should reject invalid HMAC', () => {
      const payload = 'test payload';
      const result = verifier.verifyHMAC(payload, 'invalid-signature', 'test-secret');
      expect(result).toBe(false);
    });
  });

  describe('validateTimestamp', () => {
    it('should accept recent timestamp', () => {
      const timestamp = new Date().toISOString();
      const result = verifier.validateTimestamp(timestamp);
      expect(result).toBe(true);
    });

    it('should reject old timestamp', () => {
      const oldDate = new Date(Date.now() - 400 * 1000); // 400 seconds ago
      const result = verifier.validateTimestamp(oldDate.toISOString());
      expect(result).toBe(false);
    });

    it('should reject future timestamp', () => {
      const futureDate = new Date(Date.now() + 400 * 1000);
      const result = verifier.validateTimestamp(futureDate.toISOString());
      expect(result).toBe(false);
    });

    it('should reject invalid timestamp', () => {
      const result = verifier.validateTimestamp('invalid-date');
      expect(result).toBe(false);
    });
  });

  describe('validateNonce', () => {
    it('should accept new nonce', () => {
      const result = verifier.validateNonce('nonce-123');
      expect(result).toBe(true);
    });

    it('should reject duplicate nonce', () => {
      const nonce = 'nonce-456';
      verifier.validateNonce(nonce);
      const result = verifier.validateNonce(nonce);
      expect(result).toBe(false);
    });
  });
});
