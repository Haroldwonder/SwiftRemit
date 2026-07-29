import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from './connectionManager';
import { EventEmitter } from 'events';

class MockWS extends EventEmitter {
  readyState = 1;
  static OPEN = 1;
  send = vi.fn((_msg: string, cb?: (err?: Error) => void) => cb?.());
  ping = vi.fn();
  close = vi.fn();
  terminate = vi.fn();
}

describe('ConnectionManager', () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager({
      maxConnectionsPerUser: 2,
      maxGlobalConnections: 5,
      heartbeatIntervalMs: 100,
      sendQueueLimit: 3,
      eventBufferSize: 10,
    });
  });

  afterEach(() => manager.stopHeartbeat());

  it('adds and tracks connections', () => {
    const ws = new MockWS() as any;
    expect(manager.addConnection('c1', ws, 'user1')).toBe(true);
    expect(manager.getConnectionCount()).toBe(1);
    expect(manager.getUserConnectionCount('user1')).toBe(1);
  });

  it('enforces per-user connection cap', () => {
    manager.addConnection('c1', new MockWS() as any, 'user1');
    manager.addConnection('c2', new MockWS() as any, 'user1');
    expect(manager.addConnection('c3', new MockWS() as any, 'user1')).toBe(false);
    expect(manager.metrics.rejectedConnections).toBe(1);
  });

  it('enforces global connection cap', () => {
    for (let i = 0; i < 5; i++) {
      manager.addConnection(`c${i}`, new MockWS() as any, `user${i}`);
    }
    expect(manager.addConnection('c5', new MockWS() as any, 'user5')).toBe(false);
  });

  it('removes connections on close', () => {
    const ws = new MockWS() as any;
    manager.addConnection('c1', ws, 'user1');
    ws.emit('close');
    expect(manager.getConnectionCount()).toBe(0);
  });

  it('broadcasts and replays events', () => {
    const ws = new MockWS() as any;
    manager.addConnection('c1', ws, 'user1');
    const seq1 = manager.broadcast('remittance', { status: 'completed' });
    const seq2 = manager.broadcast('remittance', { status: 'failed' });
    expect(seq1).toBe(1);
    expect(seq2).toBe(2);

    const ws2 = new MockWS() as any;
    manager.addConnection('c2', ws2, 'user1');
    const replayed = manager.replayFrom('c2', 1);
    expect(replayed).toBe(1);
  });

  it('reaps dead connections after missed heartbeats', async () => {
    const ws = new MockWS() as any;
    manager.addConnection('c1', ws, 'user1');
    const conn = (manager as any).connections.get('c1');
    conn.lastPong = Date.now() - 300;

    manager.startHeartbeat();
    await new Promise(r => setTimeout(r, 150));
    expect(ws.terminate).toHaveBeenCalled();
    expect(manager.metrics.reapedConnections).toBeGreaterThanOrEqual(1);
  });

  it('drops messages when queue overflows', () => {
    const ws = new MockWS() as any;
    ws.send = vi.fn(() => {});
    manager.addConnection('c1', ws, 'user1');
    const conn = (manager as any).connections.get('c1');
    for (let i = 0; i < 5; i++) {
      conn.sendQueue.push('queued' + i);
    }
    manager.sendWithBackpressure('c1', 'overflow');
    expect(manager.metrics.droppedMessages).toBeGreaterThan(0);
  });

  it('exposes metrics', () => {
    const m = manager.getMetrics();
    expect(m).toHaveProperty('activeConnections');
    expect(m).toHaveProperty('totalConnections');
    expect(m).toHaveProperty('rejectedConnections');
    expect(m).toHaveProperty('reapedConnections');
    expect(m).toHaveProperty('droppedMessages');
  });
});
