/**
 * Tests for JWT authentication endpoints (Issue #883).
 *
 * POST /api/auth/login   - issue access + refresh tokens
 * POST /api/auth/refresh - rotate refresh token
 * POST /api/auth/logout  - revoke refresh token
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { refreshTokenStore } from '../routes/auth';

function makeApp() {
  process.env.JWT_SECRET = 'test-secret-for-jwt-883';
  return createApp();
}

describe('POST /api/auth/login (Issue #883)', () => {
  beforeEach(() => {
    refreshTokenStore.clear();
    process.env.JWT_SECRET = 'test-secret-for-jwt-883';
    process.env.NODE_ENV = 'test';
  });

  it('returns 400 when userId is missing', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ password: 'pw' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ userId: 'user1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
  });

  it('returns 503 when JWT_SECRET is not set', async () => {
    delete process.env.JWT_SECRET;
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ userId: 'user1', password: 'any' });
    expect(res.status).toBe(503);
  });

  it('issues access_token and sets HttpOnly refresh cookie on success', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ userId: 'alice', password: 'any' }); // NODE_ENV=test skips password check
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.access_token).toBeTruthy();
    expect(res.body.data.token_type).toBe('Bearer');
    expect(res.body.data.expires_in).toBe(900);
    const cookie = res.headers['set-cookie'] as string[] | string;
    const cookieStr = Array.isArray(cookie) ? cookie.join('; ') : cookie;
    expect(cookieStr).toContain('swiftremit_refresh');
    expect(cookieStr).toContain('HttpOnly');
  });

  it('stores refresh token in the store', async () => {
    await request(makeApp())
      .post('/api/auth/login')
      .send({ userId: 'bob', password: 'any' });
    expect(refreshTokenStore.size).toBe(1);
  });
});

describe('POST /api/auth/refresh (Issue #883)', () => {
  beforeEach(() => {
    refreshTokenStore.clear();
    process.env.JWT_SECRET = 'test-secret-for-jwt-883';
    process.env.NODE_ENV = 'test';
  });

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
    // Login first to get a cookie
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'carol', password: 'any' });
    const cookie = (loginRes.headers['set-cookie'] as string[]).find((c) =>
      c.startsWith('swiftremit_refresh'),
    )!;

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .send({});

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.access_token).toBeTruthy();
    // Old token should be invalidated — store still has 1 (the new one)
    expect(refreshTokenStore.size).toBe(1);
  });

  it('old refresh token is invalidated after rotation', async () => {
    const app = makeApp();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'dan', password: 'any' });
    const cookie = (loginRes.headers['set-cookie'] as string[]).find((c) =>
      c.startsWith('swiftremit_refresh'),
    )!;

    // Use the token once
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).send({});

    // Attempt to reuse the same token
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout (Issue #883)', () => {
  beforeEach(() => {
    refreshTokenStore.clear();
    process.env.JWT_SECRET = 'test-secret-for-jwt-883';
    process.env.NODE_ENV = 'test';
  });

  it('returns 200 even without a cookie', async () => {
    const res = await request(makeApp()).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('removes token from store on logout', async () => {
    const app = makeApp();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'eve', password: 'any' });
    const cookie = (loginRes.headers['set-cookie'] as string[]).find((c) =>
      c.startsWith('swiftremit_refresh'),
    )!;

    expect(refreshTokenStore.size).toBe(1);

    await request(app).post('/api/auth/logout').set('Cookie', cookie).send({});
    expect(refreshTokenStore.size).toBe(0);
  });

  it('clears the cookie on logout', async () => {
    const app = makeApp();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'frank', password: 'any' });
    const cookie = (loginRes.headers['set-cookie'] as string[]).find((c) =>
      c.startsWith('swiftremit_refresh'),
    )!;

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .send({});

    const setCookie = (logoutRes.headers['set-cookie'] as string[] | undefined) ?? [];
    const cleared = setCookie.find((c) => c.startsWith('swiftremit_refresh'));
    expect(cleared).toContain('Expires=');
  });
});
