/**
 * Tests for JWT authentication endpoints (Issue #883, updated for SR-047).
 *
 * POST /api/auth/login   - issue access + refresh tokens
 * POST /api/auth/refresh - rotate refresh token
 * POST /api/auth/logout  - revoke refresh family and access token
 *
 * Two things changed with SR-047 and are reflected here:
 *  - Login no longer accepts any password when NODE_ENV=test. Tests configure
 *    STUB_PASSWORD like any other environment would.
 *  - Refresh-token state moved out of `routes/auth` into `services/tokenStore`,
 *    so these assert observable behaviour rather than the size of a private Map.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { resetTokenStore } from '../services/tokenStore';

const PASSWORD = 'correct-horse-battery-staple';

function makeApp() {
  process.env.JWT_SECRET = 'test-secret-for-jwt-883';
  process.env.STUB_PASSWORD = PASSWORD;
  return createApp();
}

function refreshCookie(res: request.Response): string {
  const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const cookie = cookies.find((c) => c.startsWith('swiftremit_refresh'));
  if (!cookie) throw new Error('no refresh cookie on response');
  return cookie;
}

beforeEach(() => {
  resetTokenStore();
  process.env.JWT_SECRET = 'test-secret-for-jwt-883';
  process.env.STUB_PASSWORD = PASSWORD;
  process.env.NODE_ENV = 'test';
  delete process.env.ADMIN_USER_IDS;
  delete process.env.AGENT_USER_IDS;
});

describe('POST /api/auth/login (Issue #883)', () => {
  it('returns 400 when userId is missing', async () => {
    const res = await request(makeApp()).post('/api/auth/login').send({ password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(makeApp()).post('/api/auth/login').send({ userId: 'user1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
  });

  it('returns 503 when JWT_SECRET is not set', async () => {
    delete process.env.JWT_SECRET;
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ userId: 'user1', password: PASSWORD });
    expect(res.status).toBe(503);
  });

  it('issues access_token and sets HttpOnly refresh cookie on success', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ userId: 'alice', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.access_token).toBeTruthy();
    expect(res.body.data.token_type).toBe('Bearer');
    expect(res.body.data.expires_in).toBe(900);

    const cookie = refreshCookie(res);
    expect(cookie).toContain('swiftremit_refresh');
    expect(cookie).toContain('HttpOnly');
  });

  it('rejects a wrong password (SR-047: the NODE_ENV=test bypass is gone)', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ userId: 'bob', password: 'not-the-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('issues a usable refresh token', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'bob', password: PASSWORD });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie(login))
      .send({});

    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/refresh (Issue #883)', () => {
  it('returns 401 with no cookie', async () => {
    const res = await request(makeApp()).post('/api/auth/refresh').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_REFRESH_TOKEN');
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(makeApp())
      .post('/api/auth/refresh')
      .set('Cookie', 'swiftremit_refresh=bogus')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rotates token and returns new access token', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'carol', password: PASSWORD });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie(login))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();
    // Rotation must hand back a different cookie than it consumed.
    expect(refreshCookie(res)).not.toBe(refreshCookie(login));
  });

  it('old refresh token is invalidated after rotation', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'dan', password: PASSWORD });
    const cookie = refreshCookie(login);

    await request(app).post('/api/auth/refresh').set('Cookie', cookie).send({});

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie).send({});
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout (Issue #883)', () => {
  it('returns 200 even without a cookie', async () => {
    const res = await request(makeApp()).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('invalidates the refresh token on logout', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'eve', password: PASSWORD });
    const cookie = refreshCookie(login);

    await request(app).post('/api/auth/logout').set('Cookie', cookie).send({});

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie).send({});
    expect(res.status).toBe(401);
  });

  it('clears the cookie on logout', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'frank', password: PASSWORD });

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', refreshCookie(login))
      .send({});

    const setCookie = (logout.headers['set-cookie'] as unknown as string[]) ?? [];
    const cleared = setCookie.find((c) => c.startsWith('swiftremit_refresh'));
    expect(cleared).toContain('Expires=');
  });
});
