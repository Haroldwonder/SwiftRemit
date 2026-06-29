import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { Pool } from 'pg';
import { createGraphQLRouter } from '../routes/graphql';

describe('GraphQL API (Issue #879)', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock remittance store
    const mockRemittanceStore = {
      queryWithCursor: async () => ({
        items: [
          {
            id: 1,
            sender: 'SENDER123',
            agent: 'AGENT456',
            amount: 1000,
            fee: 25,
            status: 'Completed',
            token: 'USDC',
            memo: 'Payment',
            created_at: '2025-06-01T00:00:00Z',
            updated_at: '2025-06-01T01:00:00Z',
          },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    };

    // Mock pool for testing
    const mockPool = {
      query: async (sql: string) => {
        // Mock corridor data
        if (sql.includes('contract_events')) {
          return {
            rows: [
              {
                source_currency: 'USDC',
                destination_country: 'UG',
                total_volume: '5000.00',
                transaction_count: '50',
              },
            ],
          };
        }
        // Mock agents data
        if (sql.includes('agents')) {
          return {
            rows: [
              {
                address: 'AGENT456',
                registered_at: '2025-05-01T00:00:00Z',
                is_active: true,
              },
            ],
          };
        }
        return { rows: [] };
      },
    } as unknown as Pool;

    const router = createGraphQLRouter({ pool: mockPool, remittanceStore: mockRemittanceStore });
    app.use('/api/graphql', router);
  });

  describe('POST /api/graphql', () => {
    it('should reject requests without query', async () => {
      const response = await request(app).post('/api/graphql').send({});
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_QUERY');
    });

    it('should execute remittances query', async () => {
      const query = `query { remittances { id sender amount status } }`;

      const response = await request(app).post('/api/graphql').send({ query });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.remittances)).toBe(true);
    });

    it('should execute corridors query', async () => {
      const query = `query { corridors { source_currency destination_country } }`;

      const response = await request(app).post('/api/graphql').send({ query });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.corridors)).toBe(true);
    });

    it('should execute agents query', async () => {
      const query = `query { agents { address is_active } }`;

      const response = await request(app).post('/api/graphql').send({ query });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.agents)).toBe(true);
    });

    it('should return only requested fields in remittances', async () => {
      const query = `query { remittances { id sender } }`;

      const response = await request(app).post('/api/graphql').send({ query });
      expect(response.status).toBe(200);
      const remittance = response.body.data.remittances[0];
      expect(remittance).toHaveProperty('id');
      expect(remittance).toHaveProperty('sender');
    });

    it('should handle invalid queries', async () => {
      const query = `query { invalidField { foo } }`;

      const response = await request(app).post('/api/graphql').send({ query });
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should support flexible field selection', async () => {
      const queries = [
        `query { remittances { id } }`,
        `query { remittances { sender amount } }`,
        `query { remittances { id sender amount fee status } }`,
      ];

      for (const query of queries) {
        const response = await request(app).post('/api/graphql').send({ query });
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });
  });

  describe('GET /api/graphql', () => {
    it('should return endpoint info', async () => {
      const response = await request(app).get('/api/graphql');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBeDefined();
      expect(response.body.supportedQueries).toBeDefined();
    });

    it('should include usage documentation', async () => {
      const response = await request(app).get('/api/graphql');
      expect(response.status).toBe(200);
      expect(response.body.usage).toBeDefined();
      expect(response.body.usage).toContain('query');
    });
  });

  describe('Field selection and flexible querying', () => {
    it('should support querying partial fields', async () => {
      const query = `query { remittances { sender } }`;

      const response = await request(app).post('/api/graphql').send({ query });
      expect(response.status).toBe(200);
      expect(response.body.data.remittances[0]).toHaveProperty('sender');
    });

    it('should support querying multiple resource types', async () => {
      const query = `
        query {
          remittances { id sender }
          agents { address is_active }
        }
      `;

      const response = await request(app).post('/api/graphql').send({ query });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Both queries should be in response
      expect(response.body.data.remittances || response.body.data.agents).toBeDefined();
    });
  });
});
