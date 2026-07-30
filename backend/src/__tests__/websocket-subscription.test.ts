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

/** Build a valid base64-encoded ed25519 signature for `${address}:${timestamp}`. */
function sign(keypair: Keypair, address: string, timestamp: number): string {
  const message = Buffer.from(`${address}:${timestamp}`);
  return Buffer.from(keypair.sign(message)).toString('base64');
}

/** Create a valid base64-encoded ed25519 signature for `${address}:${timestamp}`. */
function signMessage(kp: Keypair, address: string, timestamp: number): string {
  const msg = Buffer.from(`${address}:${timestamp}`);
  return Buffer.from(kp.sign(msg)).toString('base64');
}

describe('WebSocket Sender Subscription (SR-025)', () => {
  // Reset the nonce store before each test so replays are isolated.
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

  // ─── Helper / enum regression tests ────────────────────────────────────────

  describe('getSenderRoom', () => {
    it('returns the correct room name', () => {
      const addr = 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP';
      expect(getSenderRoom(addr)).toBe(`sender:${addr}`);
    });

    it('creates unique rooms for different addresses', () => {
      expect(getSenderRoom('ADDRESS1')).not.toBe(getSenderRoom('ADDRESS2'));
    });

    it('produces consistent room names for the same address', () => {
      const addr = 'GBUTQWP3Z4UP32NQKU5DNPOBLB7AAHT5FEZRVPNWM37DQHQG65KK3GP';
      expect(getSenderRoom(addr)).toBe(getSenderRoom(addr));
    });

    it('handles addresses with various characters', () => {
      const addr = 'GBZACUMVX6YRZG3QZYVJCZFJXFMLG2VFNVZZ2YWCXO6PYCWVX24ZYXU';
      const room = getSenderRoom(addr);
      expect(room).toContain('sender:');
      expect(room).toContain(addr);
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

  // -------------------------------------------------------------------------
  // Real cryptographic verification tests
  // -------------------------------------------------------------------------

  describe('validateSignatureProof — real ed25519 crypto', () => {
    /**
     * Test 1: Valid signature — the happy path.
     * A keypair signs its own address + timestamp; verification must succeed.
     */
    it('accepts a valid ed25519 signature', () => {
      const kp = Keypair.random();
      const address = kp.publicKey();
      const timestamp = Date.now();
      const signature = signMessage(kp, address, timestamp);

      expect(validateSignatureProof(address, signature, timestamp)).toBe(true);
    });

    /**
     * Test 2: Wrong key — a different keypair signs the message for address A.
     * The signature is structurally valid but belongs to the wrong key; must reject.
     */
    it('rejects a signature made with the wrong keypair', () => {
      const kpA = Keypair.random();
      const kpEvil = Keypair.random(); // attacker's keypair

      const address = kpA.publicKey(); // we claim to be kpA
      const timestamp = Date.now();

      // Sign with the evil keypair, not kpA
      const signature = signMessage(kpEvil, address, timestamp);

      expect(validateSignatureProof(address, signature, timestamp)).toBe(false);
    });

    /**
     * Test 3: Replayed nonce — the same address+timestamp pair is submitted twice.
     * The first call must succeed; the second must be rejected.
     */
    it('rejects a replayed nonce (same address+timestamp used twice)', () => {
      const kp = Keypair.random();
      const address = kp.publicKey();
      const timestamp = Date.now();
      const signature = signMessage(kp, address, timestamp);

      // First use — must succeed.
      expect(validateSignatureProof(address, signature, timestamp)).toBe(true);

      // Second use of the identical nonce — must be rejected.
      expect(validateSignatureProof(address, signature, timestamp)).toBe(false);
    });

    /**
     * Test 4: Expired timestamp — the timestamp is more than 5 minutes in the past.
     * Even with a valid signature, the proof must be rejected.
     */
    it('rejects a proof with an expired timestamp (> 5 minutes old)', () => {
      const kp = Keypair.random();
      const address = kp.publicKey();
      const timestamp = Date.now() - 360_000; // 6 minutes ago
      const signature = signMessage(kp, address, timestamp);

      expect(validateSignatureProof(address, signature, timestamp)).toBe(false);
    });

    /**
     * Test 5: Foreign-address subscription — keypair A signs, but the caller
     * submits keypair B's address as the target address.
     * The signature is for `addressA:timestamp` but the server verifies it
     * against `addressB`, so it must reject.
     */
    it('rejects a subscription to a foreign address (sig for A, claimed address B)', () => {
      const kpA = Keypair.random();
      const kpB = Keypair.random();

      const addressA = kpA.publicKey();
      const addressB = kpB.publicKey();
      const timestamp = Date.now();

      // kpA legitimately signs for its own address
      const signatureForA = signMessage(kpA, addressA, timestamp);

      // But the client sends addressB as the address to subscribe to —
      // the server will verify the signature against addressB, which must fail.
      expect(validateSignatureProof(addressB, signatureForA, timestamp)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Timestamp tolerance edge cases (still use real crypto)
  // -------------------------------------------------------------------------

  describe('validateSignatureProof — timestamp tolerance', () => {
    it('accepts a proof at the boundary of the tolerance window', () => {
      const kp = Keypair.random();
      const address = kp.publicKey();
      const tolerance = 300_000; // 5 minutes
      const timestamp = Date.now() - (tolerance - 5_000); // just within tolerance
      const signature = signMessage(kp, address, timestamp);

      expect(validateSignatureProof(address, signature, timestamp, tolerance)).toBe(true);
    });

    it('rejects a proof just outside the tolerance window', () => {
      const kp = Keypair.random();
      const address = kp.publicKey();
      const tolerance = 300_000; // 5 minutes
      const timestamp = Date.now() - (tolerance + 5_000); // just outside tolerance
      const signature = signMessage(kp, address, timestamp);

      expect(validateSignatureProof(address, signature, timestamp, tolerance)).toBe(false);
    });

    it('accepts a custom (smaller) tolerance window', () => {
      const kp = Keypair.random();
      const address = kp.publicKey();
      const tolerance = 60_000; // 1 minute
      const timestamp = Date.now() - 30_000; // 30 seconds ago — within 1 min
      const signature = signMessage(kp, address, timestamp);

      expect(validateSignatureProof(address, signature, timestamp, tolerance)).toBe(true);
    });

    it('rejects a future timestamp outside tolerance', () => {
      const kp = Keypair.random();
      const address = kp.publicKey();
      const timestamp = Date.now() + 400_000; // far in the future
      const signature = signMessage(kp, address, timestamp);

      expect(validateSignatureProof(address, signature, timestamp)).toBe(false);
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

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe('validateSignatureProof — invalid inputs', () => {
    it('rejects an empty signature string', () => {
      const kp = Keypair.random();
      const address = kp.publicKey();
      const timestamp = Date.now();

      expect(validateSignatureProof(address, '', timestamp)).toBe(false);
    });

    it('rejects a non-base64 / garbage signature', () => {
      const kp = Keypair.random();
      const address = kp.publicKey();
      const timestamp = Date.now();

      expect(validateSignatureProof(address, 'not-a-real-signature!!!', timestamp)).toBe(false);
    });

    it('rejects an invalid Stellar address (non-StrKey string)', () => {
      const timestamp = Date.now();
      // Keypair.fromPublicKey will throw for this — must return false, not throw.
      expect(validateSignatureProof('INVALID_ADDRESS', 'YWJj', timestamp)).toBe(false);
    });
  });
});
