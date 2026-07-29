/**
 * Negative authentication tests (SR-047) and the route-guard matrix (SR-048).
 *
 * SR-047 names six cases that must fail closed. Each has a test below, and each
 * fails against the pre-SR-047 code, where HTTP routes verified no token at all:
 *
 *   1. expired token
 *   2. wrong signature
 *   3. `alg: none`
 *   4. replayed refresh token
 *   5. revoked token (after logout)
 *   6. user token on an admin route
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../app';
import {
  requireAdmin,
  requireAuth,
  verifyAccessToken,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../middleware/auth';
import { resetTokenStore } from '../services/tokenStore';
import { agentStore } from '../routes/agents';
import {
  TEST_JWT_SECRET,
  bearer,
  makeAccessToken,
  makeAlgNoneToken,
  useTestJwtSecret,
} from './helpers/authTestUtils';

const PASSWORD = 'correct-horse-battery-staple';

/** Minimal app exposing one guarded route of each kind. */
function guardedApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', requireAuth, (req, res) => {
    res.json({ success: true, userId: req.auth?.userId, role: req.auth?.role });
  });
  app.get('/admin-only', requireAdmin, (_req, res) => {
    res.json({ success: true });
  });
  return app;
}

beforeEach(() => {
  resetTokenStore();
  agentStore.clear();
  useTestJwtSecret();
  process.env.STUB_PASSWORD = PASSWORD;
  process.env.NODE_ENV = 'test';
  delete process.env.ADMIN_USER_IDS;
  delete process.env.AGENT_USER_IDS;
});

describe('SR-047 — the six negative auth cases', () => {
  it('1. rejects an expired token', async () => {
    const token = makeAccessToken('alice', { expiresInSeconds: -60 });
    const res = await request(guardedApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('2. rejects a token signed with the wrong secret', async () => {
    const token = makeAccessToken('alice', { secret: 'a-completely-different-secret' });
    const res = await request(guardedApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('3. rejects an unsigned alg:none token', async () => {
    // The classic forgery: strip the signature and claim admin.
    const token = makeAlgNoneToken('attacker', 'admin');
    const res = await request(guardedApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('4. rejects a replayed refresh token and revokes the family', async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const app = createApp();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'grace', password: PASSWORD });
    const cookies = (login.headers['set-cookie'] as unknown as string[]) ?? [];
    const original = cookies.find((c) => c.startsWith('swiftremit_refresh'))!;

    // First use succeeds and rotates.
    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', original).send({});
    expect(rotated.status).toBe(200);

    // Replaying the spent token is treated as a leak.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', original).send({});
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // ...and the token issued by the successful rotation is dead too, because
    // the whole family was revoked.
    const afterCookies = (rotated.headers['set-cookie'] as unknown as string[]) ?? [];
    const successor = afterCookies.find((c) => c.startsWith('swiftremit_refresh'))!;
    const successorRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', successor)
      .send({});
    expect(successorRes.status).toBe(401);
  });

  it('5. rejects an access token that logout revoked', async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const app = createApp();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'heidi', password: PASSWORD });
    const accessToken = login.body.data.access_token as string;

    // Valid before logout.
    expect(verifyAccessToken(accessToken).ok).toBe(true);

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    // Self-contained tokens survive logout unless explicitly revoked — this is
    // the check that proves revocation actually happens.
    const after = verifyAccessToken(accessToken);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.code).toBe('TOKEN_REVOKED');
  });

  it('6. rejects a user token on an admin route', async () => {
    const res = await request(guardedApp())
      .get('/admin-only')
      .set('Authorization', bearer('mallory', { role: 'user' }));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('SR-047 — claim validation', () => {
  it('rejects a token minted for another issuer', async () => {
    const res = await request(guardedApp())
      .get('/protected')
      .set('Authorization', bearer('alice', { issuer: 'some-other-service' }));
    expect(res.status).toBe(401);
  });

  it('rejects a token minted for another audience', async () => {
    const res = await request(guardedApp())
      .get('/protected')
      .set('Authorization', bearer('alice', { audience: 'some-other-audience' }));
    expect(res.status).toBe(401);
  });

  it('accepts a well-formed token and exposes the identity', async () => {
    const res = await request(guardedApp())
      .get('/protected')
      .set('Authorization', bearer('alice', { role: 'agent' }));

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('alice');
    expect(res.body.role).toBe('agent');
  });

  it('rejects a missing Authorization header', async () => {
    const res = await request(guardedApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a non-Bearer scheme', async () => {
    const res = await request(guardedApp())
      .get('/protected')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
  });

  it('admin tokens satisfy admin routes', async () => {
    const res = await request(guardedApp())
      .get('/admin-only')
      .set('Authorization', bearer('root', { role: 'admin' }));
    expect(res.status).toBe(200);
  });

  it('the issuer and audience constants are what the matrix documents', () => {
    expect(JWT_ISSUER).toBe('swiftremit-api');
    expect(JWT_AUDIENCE).toBe('swiftremit-clients');
  });
});

describe('SR-047 — login throttling', () => {
  it('locks an identity out after repeated failures', async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const app = createApp();

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ userId: 'ivan', password: 'wrong' });
      // The fifth failure is the one that trips the lockout.
      expect([401, 429]).toContain(res.status);
    }

    // Even the correct password is refused while locked out.
    const locked = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'ivan', password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('does not lock out a different identity', async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const app = createApp();

    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/auth/login').send({ userId: 'judy', password: 'wrong' });
    }

    const other = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'ken', password: PASSWORD });
    expect(other.status).toBe(200);
  });
});

describe('SR-048 — every data-returning route enforces its documented guard', () => {
  /**
   * Mirrors AUTH_MATRIX.md. A route added without a guard, or a guard weakened,
   * fails here.
   */
  const PROTECTED_ROUTES: Array<{ method: 'get' | 'post' | 'put'; path: string }> = [
    { method: 'get', path: '/api/remittances' },
    { method: 'get', path: '/api/remittances/abc/receipt' },
    { method: 'get', path: '/api/accounts/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/stellar-fees' },
  ];

  it.each(PROTECTED_ROUTES)('$method $path returns 401 unauthenticated', async ({ method, path }) => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const app = createApp();
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it('agent registration is refused without elevated auth', async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    delete process.env.ADMIN_API_KEY;
    const app = createApp();

    const res = await request(app).post('/api/agents').send({
      stellar_address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
      payout_address: 'addr1',
    });
    expect(res.status).toBe(401);
  });

  it('a plain user token cannot register an agent', async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    delete process.env.ADMIN_API_KEY;
    const app = createApp();

    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', bearer('nobody', { role: 'user' }))
      .send({
        stellar_address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        payout_address: 'addr1',
      });
    expect(res.status).toBe(401);
  });

  it('an agent token can register an agent', async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    delete process.env.ADMIN_API_KEY;
    const app = createApp();

    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', bearer('agent-1', { role: 'agent' }))
      .send({
        stellar_address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        payout_address: 'addr1',
        name: 'Agent One',
      });
    expect(res.status).toBe(201);
  });
});
