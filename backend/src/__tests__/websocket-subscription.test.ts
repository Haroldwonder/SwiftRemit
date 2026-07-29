/**
 * Tests for SR-025: WebSocket subscription signature verification.
 *
 * Covers all five acceptance-criteria cases:
 *   1. Valid signature accepted
 *   2. Wrong key rejected
 *   3. Replayed nonce rejected
 *   4. Expired nonce rejected
 *   5. Foreign-address subscription rejected
 *
 * Plus the existing helper/enum tests retained for regression.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  getSenderRoom,
  validateSignatureProof,
  resetNonceStore,
  getSubscriberCount,
  SocketEvents,
} from '../websocket-subscription';
import { Server as SocketServer } from 'socket.io';

/** Build a valid base64-encoded ed25519 signature for `${address}:${timestamp}`. */
function sign(keypair: Keypair, address: string, timestamp: number): string {
  const message = Buffer.from(`${address}:${timestamp}`);
  return Buffer.from(keypair.sign(message)).toString('base64');
}

describe('WebSocket Sender Subscription – SR-025', () => {
  // Reset nonce store before each test so replays are isolated.
  beforeEach(() => {
    resetNonceStore();
  });

  // ─── Core acceptance-criteria tests ────────────────────────────────────────

  describe('Signature verification (AC tests)', () => {
    it('1. accepts a subscription with a valid ed25519 signature', () => {
      const kp = Keypair.random();
      const ts = Date.now();
      const sig = sign(kp, kp.publicKey(), ts);

      expect(validateSignatureProof(kp.publicKey(), sig, ts)).toBe(true);
    });

    it('2. rejects a signature produced by the wrong key', () => {
      const ownerKp = Keypair.random();   // address we're claiming
      const attackerKp = Keypair.random(); // attacker's key
      const ts = Date.now();

      // Attacker signs with their key but claims owner's address
      const sig = sign(attackerKp, ownerKp.publicKey(), ts);

      expect(validateSignatureProof(ownerKp.publicKey(), sig, ts)).toBe(false);
    });

    it('3. rejects a replayed nonce (same address + timestamp used twice)', () => {
      const kp = Keypair.random();
      const ts = Date.now();
      const sig = sign(kp, kp.publicKey(), ts);

      // First use — should succeed
      expect(validateSignatureProof(kp.publicKey(), sig, ts)).toBe(true);
      // Second use of identical nonce — must fail
      expect(validateSignatureProof(kp.publicKey(), sig, ts)).toBe(false);
    });

    it('4. rejects an expired nonce (timestamp outside 5-minute window)', () => {
      const kp = Keypair.random();
      const ts = Date.now() - 310_000; // ~5 min 10 s ago
      const sig = sign(kp, kp.publicKey(), ts);

      expect(validateSignatureProof(kp.publicKey(), sig, ts)).toBe(false);
    });

    it('5. rejects a subscription to a foreign address', () => {
      const ownerKp = Keypair.random();    // key owner
      const foreignAddr = Keypair.random().publicKey(); // different address
      const ts = Date.now();

      // Client signs for foreignAddr using ownerKp — message = `${foreignAddr}:${ts}`
      // but passes foreignAddr as the claimed address, and ownerKp's signature
      const message = Buffer.from(`${foreignAddr}:${ts}`);
      const sig = Buffer.from(ownerKp.sign(message)).toString('base64');

      // Verification uses Keypair.fromPublicKey(foreignAddr), which is a different
      // public key than ownerKp — so the ed25519 check must fail.
      expect(validateSignatureProof(foreignAddr, sig, ts)).toBe(false);
    });
  });

  // ─── Existing helper / regression tests ────────────────────────────────────

  describe('getSenderRoom', () => {
    const addr = 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP';

    it('returns the correct room name', () => {
      expect(getSenderRoom(addr)).toBe(`sender:${addr}`);
    });

    it('returns unique rooms for different addresses', () => {
      expect(getSenderRoom('ADDRESS1')).not.toBe(getSenderRoom('ADDRESS2'));
    });

    it('is consistent across calls', () => {
      expect(getSenderRoom(addr)).toBe(getSenderRoom(addr));
    });

    it('handles addresses containing special characters', () => {
      const a = 'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU';
      const room = getSenderRoom(a);
      expect(room).toContain('sender:');
      expect(room).toContain(a);
    });
  });

  describe('SocketEvents enum', () => {
    it('defines all required event names', () => {
      expect(SocketEvents.SUBSCRIBE_SENDER).toBe('subscribe_sender');
      expect(SocketEvents.UNSUBSCRIBE_SENDER).toBe('unsubscribe_sender');
      expect(SocketEvents.REMITTANCE_STATUS_UPDATE).toBe('remittance_status_update');
      expect(SocketEvents.SUBSCRIPTION_CONFIRMED).toBe('subscription_confirmed');
      expect(SocketEvents.SUBSCRIPTION_ERROR).toBe('subscription_error');
      expect(SocketEvents.RECONNECT_SUBSCRIBE).toBe('reconnect_subscribe');
    });
  });

  describe('validateSignatureProof – timestamp / tolerance', () => {
    it('rejects timestamps far in the future', () => {
      const kp = Keypair.random();
      const ts = Date.now() + 400_000; // 6+ min future
      const sig = sign(kp, kp.publicKey(), ts);
      expect(validateSignatureProof(kp.publicKey(), sig, ts)).toBe(false);
    });

    it('accepts with a custom tolerance that covers the timestamp', () => {
      const kp = Keypair.random();
      const ts = Date.now() - 50_000; // 50 s ago
      const sig = sign(kp, kp.publicKey(), ts);
      expect(validateSignatureProof(kp.publicKey(), sig, ts, 100_000)).toBe(true);
    });

    it('rejects when timestamp is outside the custom tolerance', () => {
      const kp = Keypair.random();
      const ts = Date.now() - 150_000; // 150 s ago
      const sig = sign(kp, kp.publicKey(), ts);
      expect(validateSignatureProof(kp.publicKey(), sig, ts, 100_000)).toBe(false);
    });

    it('accepts timestamps at the boundary of default tolerance', () => {
      const kp = Keypair.random();
      const ts = Date.now() - 295_000; // just inside 5 min
      const sig = sign(kp, kp.publicKey(), ts);
      expect(validateSignatureProof(kp.publicKey(), sig, ts)).toBe(true);
    });
  });

  describe('validateSignatureProof – invalid inputs', () => {
    it('rejects an invalid (non-Stellar) address', () => {
      const ts = Date.now();
      // Keypair.fromPublicKey will throw; expect false rather than an exception
      expect(validateSignatureProof('not-a-valid-address', 'somesig', ts)).toBe(false);
    });

    it('rejects an empty signature', () => {
      const kp = Keypair.random();
      const ts = Date.now();
      expect(validateSignatureProof(kp.publicKey(), '', ts)).toBe(false);
    });

    it('rejects a signature with invalid base64', () => {
      const kp = Keypair.random();
      const ts = Date.now();
      // "!!!" is not valid base64 and will produce a buffer that fails verify
      expect(validateSignatureProof(kp.publicKey(), '!!!invalid!!!', ts)).toBe(false);
    });
  });
});
