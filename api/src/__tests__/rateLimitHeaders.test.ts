import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { createRateLimitMiddleware, addRateLimitHeaders } from '../middleware/rateLimitHeaders';

describe('Rate Limit Headers (Issue #877)', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '5';

    const limiter = createRateLimitMiddleware();
    
    app.use('/api/', limiter);
    app.use(addRateLimitHeaders);

    app.get('/api/test', (req, res) => {
      res.json({ success: true, message: 'OK' });
    });
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
  });

  it('should include RateLimit-Limit header', async () => {
    const response = await request(app).get('/api/test');
    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-limit']).toBe('5');
  });

  it('should include RateLimit-Remaining header', async () => {
    const response = await request(app).get('/api/test');
    expect(response.headers['ratelimit-remaining']).toBeDefined();
    expect(parseInt(response.headers['ratelimit-remaining'] as string)).toBeLessThanOrEqual(5);
  });

  it('should include RateLimit-Reset header', async () => {
    const response = await request(app).get('/api/test');
    expect(response.headers['ratelimit-reset']).toBeDefined();
  });

  it('should return 429 when rate limit exceeded', async () => {
    const requests = Array.from({ length: 6 });
    
    for (let i = 0; i < requests.length; i++) {
      const response = await request(app).get('/api/test');
      if (i < 5) {
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(429);
        expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      }
    }
  });

  it('should have RFC 6585 compliant headers on success', async () => {
    const response = await request(app).get('/api/test');
    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-remaining']).toBeDefined();
    expect(response.headers['ratelimit-reset']).toBeDefined();
    expect(response.headers['x-ratelimit-limit']).toBeUndefined(); // Legacy headers should be disabled
  });

  it('should have RFC 6585 compliant headers on rate limit error', async () => {
    const requests = Array.from({ length: 6 });
    
    for (let i = 0; i < requests.length; i++) {
      await request(app).get('/api/test');
    }

    const finalResponse = await request(app).get('/api/test');
    expect(finalResponse.status).toBe(429);
    expect(finalResponse.headers['ratelimit-limit']).toBeDefined();
    expect(finalResponse.headers['ratelimit-remaining']).toBe('0');
    expect(finalResponse.headers['ratelimit-reset']).toBeDefined();
  });
});
