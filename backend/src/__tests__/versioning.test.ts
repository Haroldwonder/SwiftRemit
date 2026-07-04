import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { createLegacyRedirectMiddleware, createVersionedRouter, getApiVersion, addDeprecationHeader } from '../versioning';

describe('API Versioning (#873)', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Apply legacy redirect middleware
    app.use(createLegacyRedirectMiddleware());

    // Create versioned routers
    const v1Router = createVersionedRouter();
    v1Router.get('/remittance/:id', (req, res) => {
      res.json({ version: 'v1', remittance_id: req.params.id });
    });

    const v2Router = createVersionedRouter();
    v2Router.get('/remittance/:id', (req, res) => {
      res.json({ version: 'v2', remittance_id: req.params.id, new_field: true });
    });

    app.use('/api/v1', v1Router);
    app.use('/api/v2', v2Router);
  });

  describe('Legacy redirect', () => {
    it('should redirect /api/remittance to /api/v1/remittance', async () => {
      const res = await request(app)
        .get('/api/remittance/123')
        .expect(301);

      expect(res.headers.location).toBe('/api/v1/remittance/123');
    });

    it('should redirect other root /api routes to v1', async () => {
      app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
      
      const res = await request(app)
        .get('/api/health')
        .expect(301);

      expect(res.headers.location).toBe('/api/v1/health');
    });

    it('should NOT redirect v1 routes', async () => {
      const res = await request(app)
        .get('/api/v1/remittance/123')
        .expect(200);

      expect(res.body.version).toBe('v1');
    });

    it('should NOT redirect v2 routes', async () => {
      const res = await request(app)
        .get('/api/v2/remittance/123')
        .expect(200);

      expect(res.body.version).toBe('v2');
    });
  });

  describe('Versioned endpoints', () => {
    it('v1 endpoint should return v1 response', async () => {
      const res = await request(app)
        .get('/api/v1/remittance/123')
        .expect(200);

      expect(res.body).toEqual({ version: 'v1', remittance_id: '123' });
    });

    it('v2 endpoint should return v2 response with new fields', async () => {
      const res = await request(app)
        .get('/api/v2/remittance/123')
        .expect(200);

      expect(res.body).toEqual({
        version: 'v2',
        remittance_id: '123',
        new_field: true,
      });
    });
  });

  describe('getApiVersion helper', () => {
    it('should return v1 as default', () => {
      const req = { headers: {} } as any;
      expect(getApiVersion(req)).toBe('v1');
    });

    it('should return X-API-Version header if provided', () => {
      const req = { headers: { 'x-api-version': 'v2' } } as any;
      expect(getApiVersion(req)).toBe('v2');
    });

    it('should ignore invalid X-API-Version header', () => {
      const req = { headers: { 'x-api-version': 'invalid' } } as any;
      expect(getApiVersion(req)).toBe('v1');
    });
  });

  describe('Deprecation headers', () => {
    it('should add Deprecation, Sunset, and Link headers', () => {
      const res = {
        set: (key: string, value: string) => {},
        headers: {} as Record<string, string>,
      };
      res.set = (key: string, value: string) => {
        res.headers[key] = value;
      };

      const deprecatedAt = new Date('2026-01-01');
      const sunsetDate = new Date('2026-07-01');
      addDeprecationHeader(res as any, deprecatedAt, sunsetDate, 'https://docs.example.com/migrate');

      expect(res.headers['Deprecation']).toBe('true');
      expect(res.headers['Sunset']).toMatch(/\d{1,2} \w+ \d{4}/); // RFC 7231 format
      expect(res.headers['Link']).toContain('rel="deprecation"');
    });
  });
});
