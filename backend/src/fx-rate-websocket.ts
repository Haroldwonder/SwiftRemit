import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket, Namespace } from 'socket.io';
import { FxRateCache, FxRateResponse, getFxRateCache, setFxRateEventBus } from './fx-rate-cache';
import { EventEmitter } from 'events';

export const fxRateEvents = new EventEmitter();
fxRateEvents.setMaxListeners(50);

export interface FxRateUpdate {
  pair: string;
  from: string;
  to: string;
  rate: number;
  timestamp: string;
  provider: string;
}

export interface SubscribeMessage {
  pairs: string[];
}

export interface UnsubscribeMessage {
  pairs: string[];
}

function pairKey(from: string, to: string): string {
  return `${from.toUpperCase()}/${to.toUpperCase()}`;
}

export class FxRateWebSocketServer {
  private io: SocketIOServer;
  private ns: Namespace;
  private cache: FxRateCache;

  constructor(httpServer: HttpServer) {
    this.cache = getFxRateCache();
    setFxRateEventBus(fxRateEvents);

    this.io = new SocketIOServer(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
      path: '/ws',
    });

    this.ns = this.io.of('/fx-rates');
    this.setupNamespace();
    this.listenForCacheRefreshes();
  }

  private setupNamespace(): void {
    this.ns.on('connection', (socket: Socket) => {
      const subscribedPairs = new Set<string>();

      socket.on('subscribe', async (msg: SubscribeMessage) => {
        const pairs: string[] = Array.isArray(msg?.pairs) ? msg.pairs : [];

        for (const raw of pairs) {
          const [from, to] = raw.toUpperCase().split('/');
          if (!from || !to) continue;
          const key = pairKey(from, to);
          if (subscribedPairs.has(key)) continue;
          subscribedPairs.add(key);
          socket.join(`pair:${key}`);

          // Rate-replay: send last known rate immediately on subscribe
          try {
            const rate = await this.cache.getCurrentRate(from, to);
            const update = this.toUpdate(rate);
            socket.emit('fx_rate', update);
          } catch {
            // silently skip if rate unavailable
          }
        }
      });

      socket.on('unsubscribe', (msg: UnsubscribeMessage) => {
        const pairs: string[] = Array.isArray(msg?.pairs) ? msg.pairs : [];
        for (const raw of pairs) {
          const [from, to] = raw.toUpperCase().split('/');
          if (!from || !to) continue;
          const key = pairKey(from, to);
          subscribedPairs.delete(key);
          socket.leave(`pair:${key}`);
        }
      });

      socket.on('disconnect', () => {
        subscribedPairs.clear();
      });
    });
  }

  private listenForCacheRefreshes(): void {
    fxRateEvents.on('rate_updated', (rate: FxRateResponse) => {
      const key = pairKey(rate.from, rate.to);
      const update = this.toUpdate(rate);
      this.ns.to(`pair:${key}`).emit('fx_rate', update);
    });
  }

  private toUpdate(rate: FxRateResponse): FxRateUpdate {
    return {
      pair: pairKey(rate.from, rate.to),
      from: rate.from.toUpperCase(),
      to: rate.to.toUpperCase(),
      rate: rate.rate,
      timestamp: new Date(rate.timestamp).toISOString(),
      provider: rate.provider,
    };
  }

  close(): void {
    this.io.close();
  }
}
