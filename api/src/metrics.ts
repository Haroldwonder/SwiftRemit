/**
 * SR-104 — Prometheus metrics for the API service.
 *
 * The backend already exposes a rich /metrics endpoint; the API service had
 * none, so its latency, error rate and WebSocket fan-out were invisible. This
 * module is deliberately dependency-free (no prom-client) to match how
 * backend/src/metrics.ts renders the text exposition format.
 */

import type { Server } from 'socket.io';

/** Upper bounds, in seconds, of the request-duration histogram. */
export const HTTP_DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class ApiMetrics {
  private requestsTotal = new Map<string, number>();
  private durationBuckets = new Map<string, number[]>();
  private durationSum = new Map<string, number>();
  private durationCount = new Map<string, number>();
  private websocketConnectedClients = 0;
  private startedAt = Date.now();

  /** Escape a Prometheus label value so it cannot break the exposition format. */
  private sanitize(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  /**
   * Record one served HTTP request. `route` should be the Express route pattern
   * rather than the concrete path, so label cardinality stays bounded.
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const key = `${method.toUpperCase()}|${route}|${statusCode}`;
    this.requestsTotal.set(key, (this.requestsTotal.get(key) ?? 0) + 1);

    const durationKey = `${method.toUpperCase()}|${route}`;
    const buckets =
      this.durationBuckets.get(durationKey) ?? new Array(HTTP_DURATION_BUCKETS.length).fill(0);

    HTTP_DURATION_BUCKETS.forEach((bound, index) => {
      if (durationSeconds <= bound) buckets[index] += 1;
    });

    this.durationBuckets.set(durationKey, buckets);
    this.durationSum.set(durationKey, (this.durationSum.get(durationKey) ?? 0) + durationSeconds);
    this.durationCount.set(durationKey, (this.durationCount.get(durationKey) ?? 0) + 1);
  }

  setWebsocketConnectedClients(count: number): void {
    this.websocketConnectedClients = count;
  }

  /** Refresh the WebSocket gauge from the Socket.IO server, if one is attached. */
  async refresh(io?: Server): Promise<void> {
    if (!io) return;
    try {
      const sockets = await io.fetchSockets();
      this.setWebsocketConnectedClients(sockets.length);
    } catch {
      // A transport error must not take the metrics endpoint down.
    }
  }

  generatePrometheusText(): string {
    const lines: string[] = [];

    lines.push('# HELP swiftremit_api_uptime_seconds Seconds since the API process started');
    lines.push('# TYPE swiftremit_api_uptime_seconds gauge');
    lines.push(`swiftremit_api_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`);

    lines.push(
      '# HELP swiftremit_api_websocket_connected_clients Currently connected WebSocket clients',
    );
    lines.push('# TYPE swiftremit_api_websocket_connected_clients gauge');
    lines.push(`swiftremit_api_websocket_connected_clients ${this.websocketConnectedClients}`);

    lines.push(
      '# HELP swiftremit_api_http_requests_total Total HTTP requests served by the API service',
    );
    lines.push('# TYPE swiftremit_api_http_requests_total counter');
    this.requestsTotal.forEach((count, key) => {
      const [method, route, status] = key.split('|');
      lines.push(
        `swiftremit_api_http_requests_total{method="${this.sanitize(method)}",` +
          `route="${this.sanitize(route)}",status="${this.sanitize(status)}"} ${count}`,
      );
    });

    lines.push(
      '# HELP swiftremit_api_http_request_duration_seconds API request duration in seconds',
    );
    lines.push('# TYPE swiftremit_api_http_request_duration_seconds histogram');
    this.durationBuckets.forEach((buckets, key) => {
      const [method, route] = key.split('|');
      const labels = `method="${this.sanitize(method)}",route="${this.sanitize(route)}"`;
      HTTP_DURATION_BUCKETS.forEach((bound, index) => {
        lines.push(
          `swiftremit_api_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${buckets[index]}`,
        );
      });
      const count = this.durationCount.get(key) ?? 0;
      const sum = this.durationSum.get(key) ?? 0;
      lines.push(`swiftremit_api_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${count}`);
      lines.push(`swiftremit_api_http_request_duration_seconds_sum{${labels}} ${sum}`);
      lines.push(`swiftremit_api_http_request_duration_seconds_count{${labels}} ${count}`);
    });

    return lines.join('\n') + '\n';
  }
}

let instance: ApiMetrics | null = null;

export function getApiMetrics(): ApiMetrics {
  if (!instance) instance = new ApiMetrics();
  return instance;
}

/** Test helper — drop the singleton so each test starts from zero. */
export function resetApiMetrics(): void {
  instance = null;
}
