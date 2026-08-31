import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDeviceRouter } from '../routes/devices';
import { DeviceTokenService } from '../device-token-service';
import request from 'supertest';
import express, { Express } from 'express';

// ── DB mock factory ────────────────────────────────────────────────────────────

function makePool(rows: Record<string, unknown>[][] = []) {
  let callIndex = 0;
  return {
    query: vi.fn(async () => {
      const result = rows[callIndex] ?? [];
      callIndex++;
      return { rows: result, rowCount: result.length };
    }),
  };
}

// ── Shared test fixtures ───────────────────────────────────────────────────────

const mockToken = 'ExponentPushToken[abcdef1234567890abcdef1234567890ab]';
const userId = 'user_123';
const walletAddress = 'G' + 'A'.repeat(55);

const mockDeviceToken = {
  id: 1,
  user_id: userId,
  token: mockToken,
  platform: 'ios' as const,
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
};

// ── DeviceTokenService Unit Tests ──────────────────────────────────────────────

describe('DeviceTokenService', () => {
  describe('register', () => {
    it('inserts a device token with the provided userId', async () => {
      const pool = makePool([[]]);
      const svc = new DeviceTokenService(pool as any);

      await svc.register({
        userId,
        token: mockToken,
        platform: 'ios',
      });

      expect(pool.query).toHaveBeenCalledOnce();
      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain('INSERT INTO device_tokens');
      expect(params).toEqual([userId, mockToken, 'ios']);
    });

    it('handles upsert correctly', async () => {
      const pool = makePool([[]]);
      const svc = new DeviceTokenService(pool as any);

      await svc.register({
        userId,
        token: mockToken,
        platform: 'android',
      });

      const [query] = pool.query.mock.calls[0];
      expect(query).toContain('ON CONFLICT (token) DO UPDATE SET');
    });

    it('throws on database error', async () => {
      const pool = {
        query: vi.fn(async () => {
          throw new Error('Database connection failed');
        }),
      };
      const svc = new DeviceTokenService(pool as any);

      await expect(
        svc.register({
          userId,
          token: mockToken,
          platform: 'web',
        })
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('deregister', () => {
    it('deletes a device token by token string', async () => {
      const pool = makePool([[]]);
      const svc = new DeviceTokenService(pool as any);

      await svc.deregister(mockToken);

      expect(pool.query).toHaveBeenCalledOnce();
      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain('DELETE FROM device_tokens WHERE token = $1');
      expect(params).toEqual([mockToken]);
    });

    it('is idempotent when token does not exist', async () => {
      const pool = makePool([{ rowCount: 0 }]);
      const svc = new DeviceTokenService(pool as any);

      await expect(svc.deregister(mockToken)).resolves.toBeUndefined();
    });

    it('throws on database error', async () => {
      const pool = {
        query: vi.fn(async () => {
          throw new Error('Database error');
        }),
      };
      const svc = new DeviceTokenService(pool as any);

      await expect(svc.deregister(mockToken)).rejects.toThrow('Database error');
    });
  });

  describe('deregisterAll', () => {
    it('deletes all tokens for a user', async () => {
      const pool = makePool([[]]);
      const svc = new DeviceTokenService(pool as any);

      await svc.deregisterAll(userId);

      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain('DELETE FROM device_tokens WHERE user_id = $1');
      expect(params).toEqual([userId]);
    });
  });

  describe('getTokensForUser', () => {
    it('returns device tokens for a user', async () => {
      const pool = makePool([[mockDeviceToken]]);
      const svc = new DeviceTokenService(pool as any);

      const tokens = await svc.getTokensForUser(userId);

      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toEqual(mockDeviceToken);
    });

    it('returns empty array when user has no tokens', async () => {
      const pool = makePool([[]]);
      const svc = new DeviceTokenService(pool as any);

      const tokens = await svc.getTokensForUser(userId);

      expect(tokens).toEqual([]);
    });
  });

  describe('sendToUser', () => {
    it('retrieves tokens and does not send when user has no tokens', async () => {
      const pool = makePool([[]]);
      const svc = new DeviceTokenService(pool as any);

      await svc.sendToUser({
        userId,
        templateKey: 'remittance_sent',
        data: { type: 'remittance', remittanceId: 'rem_123' },
      });

      expect(pool.query).toHaveBeenCalledOnce();
    });
  });
});

// ── Route Tests (POST /api/devices/register) ──────────────────────────────────

describe('POST /api/devices/register', () => {
  let app: Express;
  let mockPool: any;

  beforeEach(() => {
    mockPool = makePool([[]]);
    app = express();
    app.use(express.json());

    // Mock auth middleware that sets req.user
    app.use((req, res, next) => {
      const userId = req.headers['x-user-id'] as string;
      const walletAddr = req.headers['x-wallet-address'] as string;
      if (userId || walletAddr) {
        (req as any).user = { id: userId, walletAddress: walletAddr };
      }
      next();
    });

    const router = createDeviceRouter(mockPool);
    app.use('/api/devices', router);
  });

  it('returns 401 when req.user is missing', async () => {
    const response = await request(app)
      .post('/api/devices/register')
      .send({ token: mockToken, platform: 'ios' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('returns 400 for invalid token (too short)', async () => {
    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .send({ token: 'short', platform: 'ios' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid payload');
  });

  it('returns 400 for invalid token (too long)', async () => {
    const longToken = 'a'.repeat(513);
    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .send({ token: longToken, platform: 'ios' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid payload');
  });

  it('returns 400 for invalid platform', async () => {
    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .send({ token: mockToken, platform: 'windows' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid payload');
  });

  it('returns 400 when token is missing', async () => {
    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .send({ platform: 'ios' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid payload');
  });

  it('returns 204 on successful registration with userId', async () => {
    mockPool = makePool([[]]);
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const userId = req.headers['x-user-id'] as string;
      if (userId) {
        (req as any).user = { id: userId };
      }
      next();
    });
    const router = createDeviceRouter(mockPool);
    app.use('/api/devices', router);

    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .send({ token: mockToken, platform: 'ios' });

    expect(response.status).toBe(204);
    expect(mockPool.query).toHaveBeenCalled();
  });

  it('ignores userId from request body and uses req.user instead', async () => {
    mockPool = makePool([[]]);
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const userId = req.headers['x-user-id'] as string;
      if (userId) {
        (req as any).user = { id: userId };
      }
      next();
    });
    const router = createDeviceRouter(mockPool);
    app.use('/api/devices', router);

    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .send({
        token: mockToken,
        platform: 'ios',
        userId: 'different_user_123', // This should be ignored
      });

    expect(response.status).toBe(204);
    const [query, params] = mockPool.query.mock.calls[0];
    expect(params[0]).toBe(userId); // Should use req.user.id, not body.userId
  });

  it('uses walletAddress when id is not present in req.user', async () => {
    mockPool = makePool([[]]);
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const walletAddr = req.headers['x-wallet-address'] as string;
      if (walletAddr) {
        (req as any).user = { walletAddress: walletAddr };
      }
      next();
    });
    const router = createDeviceRouter(mockPool);
    app.use('/api/devices', router);

    const response = await request(app)
      .post('/api/devices/register')
      .set('x-wallet-address', walletAddress)
      .send({ token: mockToken, platform: 'ios' });

    expect(response.status).toBe(204);
    const [query, params] = mockPool.query.mock.calls[0];
    expect(params[0]).toBe(walletAddress);
  });

  it('prefers id over walletAddress in req.user', async () => {
    mockPool = makePool([[]]);
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const userId = req.headers['x-user-id'] as string;
      const walletAddr = req.headers['x-wallet-address'] as string;
      if (userId || walletAddr) {
        (req as any).user = { id: userId, walletAddress: walletAddr };
      }
      next();
    });
    const router = createDeviceRouter(mockPool);
    app.use('/api/devices', router);

    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .set('x-wallet-address', walletAddress)
      .send({ token: mockToken, platform: 'ios' });

    expect(response.status).toBe(204);
    const [query, params] = mockPool.query.mock.calls[0];
    expect(params[0]).toBe(userId);
  });

  it('handles database errors gracefully', async () => {
    const errorPool = {
      query: vi.fn(async () => {
        throw new Error('Database connection failed');
      }),
    };
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      (req as any).user = { id: userId };
      next();
    });
    const router = createDeviceRouter(errorPool as any);
    app.use('/api/devices', router);

    const response = await request(app)
      .post('/api/devices/register')
      .send({ token: mockToken, platform: 'ios' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Failed to register device token');
  });
});

// ── Route Tests (DELETE /api/devices/deregister) ────────────────────────────

describe('DELETE /api/devices/deregister', () => {
  let app: Express;
  let mockPool: any;

  beforeEach(() => {
    mockPool = makePool([[]]);
    app = express();
    app.use(express.json());
    const router = createDeviceRouter(mockPool);
    app.use('/api/devices', router);
  });

  it('returns 400 for invalid token (too short)', async () => {
    const response = await request(app)
      .delete('/api/devices/deregister')
      .send({ token: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid payload');
  });

  it('returns 400 for invalid token (too long)', async () => {
    const longToken = 'a'.repeat(513);
    const response = await request(app)
      .delete('/api/devices/deregister')
      .send({ token: longToken });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid payload');
  });

  it('returns 400 when token is missing', async () => {
    const response = await request(app)
      .delete('/api/devices/deregister')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid payload');
  });

  it('returns 204 on successful deregistration', async () => {
    mockPool = makePool([{ rowCount: 1 }]);
    app = express();
    app.use(express.json());
    const router = createDeviceRouter(mockPool);
    app.use('/api/devices', router);

    const response = await request(app)
      .delete('/api/devices/deregister')
      .send({ token: mockToken });

    expect(response.status).toBe(204);
    expect(mockPool.query).toHaveBeenCalled();
  });

  it('is idempotent when token does not exist', async () => {
    mockPool = makePool([{ rowCount: 0 }]);
    app = express();
    app.use(express.json());
    const router = createDeviceRouter(mockPool);
    app.use('/api/devices', router);

    const response = await request(app)
      .delete('/api/devices/deregister')
      .send({ token: mockToken });

    expect(response.status).toBe(204);
  });

  it('handles database errors gracefully', async () => {
    const errorPool = {
      query: vi.fn(async () => {
        throw new Error('Database connection failed');
      }),
    };
    app = express();
    app.use(express.json());
    const router = createDeviceRouter(errorPool as any);
    app.use('/api/devices', router);

    const response = await request(app)
      .delete('/api/devices/deregister')
      .send({ token: mockToken });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Failed to deregister device token');
  });

  it('does not require authentication', async () => {
    const response = await request(app)
      .delete('/api/devices/deregister')
      .send({ token: mockToken });

    expect(response.status).toBe(204);
  });
});

// ── Security tests ──────────────────────────────────────────────────────────────

describe('Device Token Security', () => {
  let app: Express;
  let mockPool: any;

  beforeEach(() => {
    mockPool = makePool([[]]);
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const userId = req.headers['x-user-id'] as string;
      if (userId) {
        (req as any).user = { id: userId };
      }
      next();
    });
    const router = createDeviceRouter(mockPool);
    app.use('/api/devices', router);
  });

  it('prevents users from registering tokens under other users\' accounts', async () => {
    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .send({
        token: mockToken,
        platform: 'ios',
        userId: 'attacker_user_id', // Attempt to override userId
      });

    expect(response.status).toBe(204);
    const [query, params] = mockPool.query.mock.calls[0];
    expect(params[0]).toBe(userId);
    expect(params[0]).not.toBe('attacker_user_id');
  });

  it('does not allow registering extremely long tokens', async () => {
    const tooLongToken = 'a'.repeat(513);
    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .send({
        token: tooLongToken,
        platform: 'ios',
      });

    expect(response.status).toBe(400);
  });

  it('validates platform enum strictly', async () => {
    const response = await request(app)
      .post('/api/devices/register')
      .set('x-user-id', userId)
      .send({
        token: mockToken,
        platform: 'invalid_platform',
      });

    expect(response.status).toBe(400);
  });
});
