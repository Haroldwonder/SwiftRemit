/**
 * Regression test: cors() must not default to origin '*' (SR-issue: CORS
 * allowlist). An unlisted origin must not receive an
 * Access-Control-Allow-Origin header; an allowlisted origin must.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const ORIGINAL_ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;

describe('CORS allowlist', () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = 'https://app.swiftremit.io';
  });

  afterEach(() => {
    if (ORIGINAL_ALLOWED_ORIGINS === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = ORIGINAL_ALLOWED_ORIGINS;
    }
  });

  it('does not send Access-Control-Allow-Origin for an unlisted origin', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://evil-third-party.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reflects Access-Control-Allow-Origin for an allowlisted origin', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://app.swiftremit.io');

    expect(res.headers['access-control-allow-origin']).toBe('https://app.swiftremit.io');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('preflight OPTIONS from an unlisted origin gets no allow-origin header', async () => {
    const app = createApp();
    const res = await request(app)
      .options('/health')
      .set('Origin', 'https://evil-third-party.example')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
