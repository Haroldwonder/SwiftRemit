/**
 * WebSocket connection manager with caps, backpressure, heartbeat reaping,
 * and event replay.
 *
 * SR-053
 */
import { WebSocket } from 'ws';

export interface ConnectionInfo {
  ws: WebSocket;
  userId: string;
  connectedAt: number;
  lastPong: number;
  sendQueue: string[];
  lastSequence: number;
}

export interface ConnectionManagerConfig {
  maxConnectionsPerUser: number;
  maxGlobalConnections: number;
  heartbeatIntervalMs: number;
  sendQueueLimit: number;
  eventBufferSize: number;
}

const DEFAULT_CONFIG: ConnectionManagerConfig = {
  maxConnectionsPerUser: 5,
  maxGlobalConnections: 1000,
  heartbeatIntervalMs: 30_000,
  sendQueueLimit: 100,
  eventBufferSize: 1000,
};

export class ConnectionManager {
  private connections: Map<string, ConnectionInfo> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();
  private eventBuffer: Array<{ sequence: number; channel: string; data: string }> = [];
  private sequenceCounter: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  public config: ConnectionManagerConfig;

  // Metrics
  public metrics = {
    totalConnections: 0,
    rejectedConnections: 0,
    reapedConnections: 0,
    droppedMessages: 0,
  };

  constructor(config: Partial<ConnectionManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a new connection. Returns false if caps are exceeded.
   */
  addConnection(connId: string, ws: WebSocket, userId: string): boolean {
    // Global cap
    if (this.connections.size >= this.config.maxGlobalConnections) {
      this.metrics.rejectedConnections++;
      return false;
    }

    // Per-user cap
    const userConns = this.userConnections.get(userId) || new Set();
    if (userConns.size >= this.config.maxConnectionsPerUser) {
      this.metrics.rejectedConnections++;
      return false;
    }

    const now = Date.now();
    this.connections.set(connId, {
      ws,
      userId,
      connectedAt: now,
      lastPong: now,
      sendQueue: [],
      lastSequence: 0,
    });

    userConns.add(connId);
    this.userConnections.set(userId, userConns);
    this.metrics.totalConnections++;

    ws.on('pong', () => {
      const conn = this.connections.get(connId);
      if (conn) conn.lastPong = Date.now();
    });

    ws.on('close', () => this.removeConnection(connId));
    ws.on('error', () => this.removeConnection(connId));

    return true;
  }

  /**
   * Remove a connection and clean up user tracking.
   */
  removeConnection(connId: string): void {
    const conn = this.connections.get(connId);
    if (!conn) return;

    this.connections.delete(connId);
    const userConns = this.userConnections.get(conn.userId);
    if (userConns) {
      userConns.delete(connId);
      if (userConns.size === 0) this.userConnections.delete(conn.userId);
    }
  }

  /**
   * Send a message with backpressure. If the queue exceeds the limit,
   * drop the message (or disconnect if critically behind).
   */
  sendWithBackpressure(connId: string, message: string): boolean {
    const conn = this.connections.get(connId);
    if (!conn) return false;

    if (conn.ws.readyState !== WebSocket.OPEN) return false;

    if (conn.sendQueue.length >= this.config.sendQueueLimit) {
      this.metrics.droppedMessages++;
      // If critically behind (2x limit), disconnect
      if (conn.sendQueue.length >= this.config.sendQueueLimit * 2) {
        conn.ws.close(1008, 'Send queue overflow');
        this.removeConnection(connId);
      }
      return false;
    }

    conn.sendQueue.push(message);
    this.flushQueue(connId);
    return true;
  }

  private flushQueue(connId: string): void {
    const conn = this.connections.get(connId);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return;

    while (conn.sendQueue.length > 0) {
      const msg = conn.sendQueue.shift()!;
      conn.ws.send(msg, (err) => {
        if (err) {
          this.removeConnection(connId);
        }
      });
    }
  }

  /**
   * Broadcast an event to all connections, storing it in the replay buffer.
   */
  broadcast(channel: string, data: any): number {
    const sequence = ++this.sequenceCounter;
    const message = JSON.stringify({ sequence, channel, data, timestamp: Date.now() });

    // Buffer for replay
    this.eventBuffer.push({ sequence, channel, data: message });
    if (this.eventBuffer.length > this.config.eventBufferSize) {
      this.eventBuffer.shift();
    }

    for (const [connId] of this.connections) {
      this.sendWithBackpressure(connId, message);
    }

    return sequence;
  }

  /**
   * Replay missed events to a reconnecting client from a given sequence.
   */
  replayFrom(connId: string, fromSequence: number): number {
    const missed = this.eventBuffer.filter(e => e.sequence > fromSequence);
    let replayed = 0;

    for (const event of missed) {
      if (this.sendWithBackpressure(connId, event.data)) {
        replayed++;
        const conn = this.connections.get(connId);
        if (conn) conn.lastSequence = event.sequence;
      }
    }

    return replayed;
  }

  /**
   * Start heartbeat pings. Reap connections that haven't ponged
   * within two heartbeat intervals.
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const deadline = now - this.config.heartbeatIntervalMs * 2;

      for (const [connId, conn] of this.connections) {
        if (conn.lastPong < deadline) {
          conn.ws.terminate();
          this.removeConnection(connId);
          this.metrics.reapedConnections++;
        } else if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.ping();
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  getConnectionCount(): number { return this.connections.size; }
  getUserConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size || 0;
  }
  getMetrics() { return { ...this.metrics, activeConnections: this.connections.size }; }
}
