/**
 * Proves that two `TokenStore` instances sharing one backing store behave
 * like two API instances behind a load balancer: a revocation or lockout
 * recorded on one is visible on the other, closing the gap described in
 * AUTH_MATRIX.md ("Token state is per-process").
 *
 * This uses a small in-process fake backend (an EventEmitter standing in for
 * Redis pub/sub plus a Map standing in for Redis storage) rather than a real
 * Redis server, since the important thing under test is `TokenStore`'s
 * event-application logic, not `ioredis` itself. `RedisBackend` is a thin
 * wrapper that would need a live server to exercise directly.
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { TokenStore, TokenStoreBackend, TokenStoreEvent, MAX_LOGIN_ATTEMPTS } from './tokenStore';

/** Shared fake backend standing in for "the same Redis instance". */
class FakeSharedBackend implements TokenStoreBackend {
  private bus = new EventEmitter();
  public store = new Map<string, string>();

  set(key: string, value: string): void {
    this.store.set(key, value);
  }
  del(key: string): void {
    this.store.delete(key);
  }
  publish(event: TokenStoreEvent): void {
    // Real Redis pub/sub is async and JSON-serializes the payload, so every
    // subscriber gets its own deserialized copy rather than a shared object
    // reference. Mirror both properties here — otherwise this fake would
    // pass tests "for free" via JS object aliasing that a real Redis-backed
    // deployment would never give you.
    const cloned = JSON.parse(JSON.stringify(event)) as TokenStoreEvent;
    queueMicrotask(() => this.bus.emit('event', cloned));
  }
  onEvent(handler: (event: TokenStoreEvent) => void): void {
    this.bus.on('event', handler);
  }
}

/** Waits for pending microtask-queued pub/sub deliveries to land. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('TokenStore — multi-instance behaviour via a shared backend', () => {
  it('propagates access-token revocation from instance A to instance B', async () => {
    const backend = new FakeSharedBackend();
    const instanceA = new TokenStore(backend);
    const instanceB = new TokenStore(backend);

    const jti = 'jti-shared-revocation';
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 900;

    // Not yet revoked anywhere.
    expect(instanceA.isAccessTokenRevoked(jti)).toBe(false);
    expect(instanceB.isAccessTokenRevoked(jti)).toBe(false);

    // Logout lands on instance A only.
    instanceA.revokeAccessToken(jti, expiresAtSeconds);
    await flush();

    // Instance B never received the HTTP logout request, but the token is
    // revoked there too because both instances share the same backend.
    expect(instanceA.isAccessTokenRevoked(jti)).toBe(true);
    expect(instanceB.isAccessTokenRevoked(jti)).toBe(true);
  });

  it('propagates refresh-family revocation (reuse detection) across instances', async () => {
    const backend = new FakeSharedBackend();
    const instanceA = new TokenStore(backend);
    const instanceB = new TokenStore(backend);

    const { token } = instanceA.issueRefreshToken('user-1', 'user');
    await flush();

    // Instance B can see the token issued on instance A.
    expect(instanceB.getRefreshRecord(token)?.userId).toBe('user-1');

    // First redemption happens on instance A.
    const first = instanceA.rotateRefreshToken(token);
    expect(first.ok).toBe(true);
    await flush();

    // A replay of the now-spent token arrives at instance B (e.g. an
    // attacker who captured the token before rotation, hitting a different
    // pod behind the load balancer). Instance B must still detect reuse even
    // though the original redemption happened on instance A.
    const replay = instanceB.rotateRefreshToken(token);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('reused');
  });

  it('shares login lockout state across instances', async () => {
    const backend = new FakeSharedBackend();
    const instanceA = new TokenStore(backend);
    const instanceB = new TokenStore(backend);

    const identity = 'attacker@example.com';

    // Failures split across both instances, simulating a load balancer
    // spreading a brute-force attempt across pods.
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
      instanceA.recordLoginFailure(identity);
      await flush();
    }

    expect(instanceA.isLockedOut(identity)).toBe(false);
    expect(instanceB.isLockedOut(identity)).toBe(false);

    // The final failure that trips the lockout happens on instance B.
    const lockedNow = instanceB.recordLoginFailure(identity);
    await flush();

    expect(lockedNow).toBe(true);
    expect(instanceB.isLockedOut(identity)).toBe(true);
    // Instance A is locked out too — without shared state, an attacker could
    // simply keep retrying against whichever instance hasn't locked them out.
    expect(instanceA.isLockedOut(identity)).toBe(true);
  });
});
