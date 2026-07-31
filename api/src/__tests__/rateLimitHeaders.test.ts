import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { createRateLimitMiddleware, addRateLimitHeaders, getRateLimitTiers, createTieredRateLimiter } from '../middleware/rateLimitHeaders';

describe('Rate Limit Headers (Issue #1133)', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '5';

    const limiter = createRateLimitMiddleware();
    
    app.use('/api/', limiter);
    app.use(addRateLimitHeaders);

    app.get('/api/test', (_req, res) => {
      res.json({ success: true, message: 'OK' });
    });
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.API_KEY_RATE_LIMIT_WINDOW_MS;
    delete process.env.API_KEY_RATE_LIMIT_MAX;
    delete process.env.ADMIN_RATE_LIMIT_WINDOW_MS;
    delete process.env.ADMIN_RATE_LIMIT_MAX;
    delete process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS;
    delete process.env.WEBHOOK_RATE_LIMIT_MAX;
  });

  it('should include RateLimit-Limit header on 2xx responses', async () => {
    const response = await request(app).get('/api/test');
    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-limit']).toBe('5');
  });

  it('should include RateLimit-Remaining header on 2xx responses', async () => {
    const response = await request(app).get('/api/test');
    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-remaining']).toBeDefined();
    expect(parseInt(response.headers['ratelimit-remaining'] as string)).toBeLessThanOrEqual(5);
  });

  it('should include RateLimit-Reset header on 2xx responses', async () => {
    const response = await request(app).get('/api/test');
    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-reset']).toBeDefined();
    
    // Verify it's a valid ISO timestamp
    const resetTime = new Date(response.headers['ratelimit-reset'] as string);
    expect(resetTime.getTime()).toBeGreaterThan(Date.now());
  });

  it('should include all three RFC 6585 headers on 2xx responses', async () => {
    const response = await request(app).get('/api/test');
    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-remaining']).toBeDefined();
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

  it('should include Retry-After header on 429 responses', async () => {
    // Exhaust the rate limit
    for (let i = 0; i < 5; i++) {
      await request(app).get('/api/test');
    }
    
    // Next request should get 429 with Retry-After
    const response = await request(app).get('/api/test');
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    
    const retryAfter = parseInt(response.headers['retry-after'] as string);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60); // 60 seconds window
  });

  it('should include retryAfter and resetAt in 429 response body', async () => {
    // Exhaust the rate limit
    for (let i = 0; i < 5; i++) {
      await request(app).get('/api/test');
    }
    
    const response = await request(app).get('/api/test');
    expect(response.status).toBe(429);
    expect(response.body.error.retryAfter).toBeDefined();
    expect(response.body.error.resetAt).toBeDefined();
    
    // Verify resetAt is a valid ISO timestamp
    const resetTime = new Date(response.body.error.resetAt);
    expect(resetTime.getTime()).toBeGreaterThan(Date.now());
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
    // Exhaust the rate limit
    for (let i = 0; i < 6; i++) {
      await request(app).get('/api/test');
    }

    const finalResponse = await request(app).get('/api/test');
    expect(finalResponse.status).toBe(429);
    expect(finalResponse.headers['ratelimit-limit']).toBeDefined();
    expect(finalResponse.headers['ratelimit-remaining']).toBe('0');
    expect(finalResponse.headers['ratelimit-reset']).toBeDefined();
    expect(finalResponse.headers['retry-after']).toBeDefined();
  });

  it('should decrement RateLimit-Remaining with each request', async () => {
    const responses = [];
    for (let i = 0; i < 3; i++) {
      const response = await request(app).get('/api/test');
      responses.push(parseInt(response.headers['ratelimit-remaining'] as string));
    }

    // All three should be defined numbers
    for (const r of responses) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(5);
    }
    // The last value should be less than the first (limit has been consumed)
    expect(responses[2]).toBeLessThan(responses[0]);
  });
});

describe('Rate Limit Tiers (Issue #1133)', () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_WINDOW_MS = '900000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '100';
    process.env.API_KEY_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.API_KEY_RATE_LIMIT_MAX = '200';
    process.env.ADMIN_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.ADMIN_RATE_LIMIT_MAX = '500';
    process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.WEBHOOK_RATE_LIMIT_MAX = '1000';
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.API_KEY_RATE_LIMIT_WINDOW_MS;
    delete process.env.API_KEY_RATE_LIMIT_MAX;
    delete process.env.ADMIN_RATE_LIMIT_WINDOW_MS;
    delete process.env.ADMIN_RATE_LIMIT_MAX;
    delete process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS;
    delete process.env.WEBHOOK_RATE_LIMIT_MAX;
  });

  it('should return all configured rate limit tiers', () => {
    const tiers = getRateLimitTiers();
    
    expect(tiers.global).toBeDefined();
    expect(tiers.perKey).toBeDefined();
    expect(tiers.admin).toBeDefined();
    expect(tiers.webhook).toBeDefined();
    
    expect(tiers.global.maxRequests).toBe(100);
    expect(tiers.perKey.maxRequests).toBe(200);
    expect(tiers.admin.maxRequests).toBe(500);
    expect(tiers.webhook.maxRequests).toBe(1000);
  });

  it('should create tiered rate limiter with correct configuration', async () => {
    const app = express();
    const perKeyLimiter = createTieredRateLimiter('perKey');

    // Mount only the tiered limiter (no addRateLimitHeaders fallback) so
    // we can verify the limiter itself sets the correct max.
    app.use('/api/keyed', perKeyLimiter);
    app.get('/api/keyed/test', (_req, res) => {
      res.json({ success: true });
    });

    const response = await request(app).get('/api/keyed/test');
    // draft-7 standard headers report the configured max for this tier
    const limitHeader = response.headers['ratelimit-limit'];
    expect(limitHeader).toBeDefined();
    expect(parseInt(limitHeader as string)).toBe(200);
  });

  it('should apply most restrictive limit when multiple tiers apply', async () => {
    // This test verifies the concept - in practice, express-rate-limit handles this
    // by having separate middleware instances that each decrement independently
    const tiers = getRateLimitTiers();
    
    // Find the most restrictive (lowest maxRequests)
    const tierValues = Object.values(tiers);
    const mostRestrictive = tierValues.reduce((min, tier) => 
      tier.maxRequests < min.maxRequests ? tier : min
    );
    
    expect(mostRestrictive.name).toBe('global');
    expect(mostRestrictive.maxRequests).toBe(100);
  });
});
