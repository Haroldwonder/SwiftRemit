/**
 * Tests for agent registration and management endpoints (Issue #880).
 *
 * POST /api/agents
 * GET  /api/agents
 * GET  /api/agents/:id
 * PUT  /api/agents/:id/payout-address
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { agentStore } from '../routes/agents';
import { bearer, useTestJwtSecret } from './helpers/authTestUtils';

const ADMIN_KEY = 'test-admin-key';
const VALID_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

describe('POST /api/agents', () => {
  beforeEach(() => agentStore.clear());

  it('returns 401 without admin key', async () => {
    const app = createApp();
    const res = await request(app).post('/api/agents').send({
      stellar_address: VALID_ADDRESS,
      payout_address: 'addr1',
      name: 'Test Agent',
    });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 for invalid stellar_address', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = createApp();
    const res = await request(app)
      .post('/api/agents')
      .set('x-api-key', ADMIN_KEY)
      .send({ stellar_address: 'INVALID', payout_address: 'addr1', name: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ADDRESS');
  });

  it('returns 400 when name is missing', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = createApp();
    const res = await request(app)
      .post('/api/agents')
      .set('x-api-key', ADMIN_KEY)
      .send({ stellar_address: VALID_ADDRESS, payout_address: 'addr1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
  });

  it('returns 400 when payout_address is missing', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = createApp();
    const res = await request(app)
      .post('/api/agents')
      .set('x-api-key', ADMIN_KEY)
      .send({ stellar_address: VALID_ADDRESS, name: 'Agent' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
  });

  it('creates agent with status pending', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = createApp();
    const res = await request(app)
      .post('/api/agents')
      .set('x-api-key', ADMIN_KEY)
      .send({ stellar_address: VALID_ADDRESS, payout_address: 'iban123', name: 'Alice' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stellar_address).toBe(VALID_ADDRESS);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.payout_address).toBe('iban123');
  });

  it('returns 409 on duplicate stellar_address', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = createApp();
    const payload = { stellar_address: VALID_ADDRESS, payout_address: 'x', name: 'A' };
    await request(app).post('/api/agents').set('x-api-key', ADMIN_KEY).send(payload);
    const res = await request(app).post('/api/agents').set('x-api-key', ADMIN_KEY).send(payload);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AGENT_EXISTS');
  });
});

describe('GET /api/agents/:id', () => {
  beforeEach(() => {
    agentStore.clear();
    useTestJwtSecret();
  });

  it('returns 401 without authentication', async () => {
    const app = createApp();
    const res = await request(app).get(`/api/agents/${VALID_ADDRESS}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown agent', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/api/agents/${VALID_ADDRESS}`)
      .set('Authorization', bearer('user-1'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('AGENT_NOT_FOUND');
  });

  it('returns agent profile for known agent', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = createApp();
    await request(app)
      .post('/api/agents')
      .set('x-api-key', ADMIN_KEY)
      .send({ stellar_address: VALID_ADDRESS, payout_address: 'iban456', name: 'Bob' });

    const res = await request(app)
      .get(`/api/agents/${VALID_ADDRESS}`)
      .set('Authorization', bearer(VALID_ADDRESS, { role: 'agent' }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Bob');
    expect(res.body.data.payout_address).toBe('iban456');
  });
});

describe('GET /api/agents', () => {
  const ADDRESS_2 = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const ADDRESS_3 = 'GCCD6AJOYZCUAQLX32ZJRWCGYRXJE5RON3FYO44PNEMXHUIO4UGK6BXL';

  beforeEach(() => {
    agentStore.clear();
    useTestJwtSecret();
  });

  async function seed(app: ReturnType<typeof createApp>) {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    for (const [address, name] of [
      [VALID_ADDRESS, 'Alice'],
      [ADDRESS_2, 'Bob'],
      [ADDRESS_3, 'Carol'],
    ]) {
      await request(app)
        .post('/api/agents')
        .set('x-api-key', ADMIN_KEY)
        .send({ stellar_address: address, payout_address: `payout-${name}`, name });
    }
  }

  it('returns 401 without authentication', async () => {
    const app = createApp();
    const res = await request(app).get('/api/agents');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin callers', async () => {
    const app = createApp();
    const res = await request(app).get('/api/agents').set('Authorization', bearer('user-1'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lists agents with a cursor envelope and no payout_address', async () => {
    const app = createApp();
    await seed(app);

    const res = await request(app)
      .get('/api/agents?limit=2')
      .set('Authorization', bearer('admin-1', { role: 'admin' }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.has_more).toBe(true);
    expect(res.body.page_size).toBe(2);
    expect(typeof res.body.next_cursor).toBe('string');
    expect(res.body.data[0].payout_address).toBeUndefined();

    const next = await request(app)
      .get(`/api/agents?limit=2&cursor=${res.body.next_cursor}`)
      .set('Authorization', bearer('admin-1', { role: 'admin' }));
    expect(next.status).toBe(200);
    expect(next.body.data).toHaveLength(1);
    expect(next.body.has_more).toBe(false);
    expect(next.body.next_cursor).toBeNull();
  });

  it('filters by status', async () => {
    const app = createApp();
    await seed(app);

    const res = await request(app)
      .get('/api/agents?status=active')
      .set('Authorization', bearer('admin-1', { role: 'admin' }));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);

    const pending = await request(app)
      .get('/api/agents?status=pending')
      .set('Authorization', bearer('admin-1', { role: 'admin' }));
    expect(pending.status).toBe(200);
    expect(pending.body.data).toHaveLength(3);
  });

  it('returns 400 for an invalid status', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/agents?status=bogus')
      .set('Authorization', bearer('admin-1', { role: 'admin' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });
});

describe('PUT /api/agents/:id/payout-address', () => {
  beforeEach(() => agentStore.clear());

  it('returns 401 without admin key', async () => {
    const app = createApp();
    const res = await request(app)
      .put(`/api/agents/${VALID_ADDRESS}/payout-address`)
      .send({ payout_address: 'new' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown agent', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = createApp();
    const res = await request(app)
      .put(`/api/agents/${VALID_ADDRESS}/payout-address`)
      .set('x-api-key', ADMIN_KEY)
      .send({ payout_address: 'new' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for empty payout_address', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = createApp();
    await request(app)
      .post('/api/agents')
      .set('x-api-key', ADMIN_KEY)
      .send({ stellar_address: VALID_ADDRESS, payout_address: 'old', name: 'C' });

    const res = await request(app)
      .put(`/api/agents/${VALID_ADDRESS}/payout-address`)
      .set('x-api-key', ADMIN_KEY)
      .send({ payout_address: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
  });

  it('updates payout address', async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    const app = createApp();
    await request(app)
      .post('/api/agents')
      .set('x-api-key', ADMIN_KEY)
      .send({ stellar_address: VALID_ADDRESS, payout_address: 'old-addr', name: 'D' });

    const res = await request(app)
      .put(`/api/agents/${VALID_ADDRESS}/payout-address`)
      .set('x-api-key', ADMIN_KEY)
      .send({ payout_address: 'new-addr' });
    expect(res.status).toBe(200);
    expect(res.body.data.payout_address).toBe('new-addr');
    // updated_at should change
    expect(res.body.data.updated_at).toBeDefined();
  });
});
