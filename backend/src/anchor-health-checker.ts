import { Pool } from 'pg';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { getEnabledAnchors, saveAnchorHealthCheck, getLatestAnchorHealth } from './database';
import { createLogger } from './correlation-id';
import { MetricsService } from './metrics';

const logger = createLogger('AnchorHealthChecker');

export type AnchorHealthStatus = 'online' | 'degraded' | 'offline';

export interface AnchorHealthResult {
  anchor_id: string;
  domain: string;
  status: AnchorHealthStatus;
  response_time_ms: number;
  error_message?: string;
  checked_at: Date;
}

function probeUrl(urlString: string, timeoutMs = 10000): Promise<{ ok: boolean; status: number; durationMs: number; message?: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlString);
      const client = parsed.protocol === 'https:' ? https : http;

      const request = client.request(
        parsed,
        { method: 'GET', timeout: timeoutMs },
        (response) => {
          let body = '';
          response.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          response.on('end', () => {
            const durationMs = Date.now() - start;
            const ok = response.statusCode !== undefined && response.statusCode < 500;
            resolve({
              ok,
              status: response.statusCode ?? 0,
              durationMs,
              message: ok ? undefined : `HTTP ${response.statusCode}`,
            });
          });
        },
      );

      request.on('error', (error) => {
        const durationMs = Date.now() - start;
        resolve({ ok: false, status: 0, durationMs, message: error.message });
      });

      request.on('timeout', () => {
        request.destroy(new Error('Request timed out'));
        const durationMs = Date.now() - start;
        resolve({ ok: false, status: 0, durationMs, message: 'Request timed out' });
      });

      request.end();
    } catch (error) {
      const durationMs = Date.now() - start;
      resolve({
        ok: false,
        status: 0,
        durationMs,
        message: error instanceof Error ? error.message : 'Invalid URL',
      });
    }
  });
}

function classifyHealth(probeResult: { ok: boolean; status: number; durationMs: number }): AnchorHealthStatus {
  if (!probeResult.ok) return 'offline';
  if (probeResult.durationMs > 5000) return 'degraded';
  return 'online';
}

export class AnchorHealthChecker {
  private pool: Pool;
  private metricsService?: MetricsService;

  constructor(pool: Pool, metricsService?: MetricsService) {
    this.pool = pool;
    this.metricsService = metricsService;
  }

  async checkAllAnchors(): Promise<AnchorHealthResult[]> {
    try {
      const anchors = await getEnabledAnchors();
      logger.info(`Checking health for ${anchors.length} anchors`);

      const results: AnchorHealthResult[] = [];

      for (const anchor of anchors) {
        try {
          const result = await this.checkSingleAnchor(anchor.id, anchor.domain);
          results.push(result);

          await saveAnchorHealthCheck({
            anchor_id: result.anchor_id,
            status: result.status,
            response_time_ms: result.response_time_ms,
            error_message: result.error_message,
            checked_at: result.checked_at,
          });

          if (this.metricsService) {
            this.metricsService.recordAnchorAvailability(result.anchor_id, result.status);
          }

          logger.info(`Anchor ${anchor.id} health: ${result.status} (${result.response_time_ms}ms)`);
        } catch (error) {
          logger.error(`Failed to check anchor ${anchor.id}`, error);
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to check all anchors', error);
      return [];
    }
  }

  async checkSingleAnchor(anchorId: string, domain: string): Promise<AnchorHealthResult> {
    const stellarTomlUrl = `https://${domain}/.well-known/stellar.toml`;
    const probed = await probeUrl(stellarTomlUrl);
    const status = classifyHealth(probed);

    return {
      anchor_id: anchorId,
      domain,
      status,
      response_time_ms: probed.durationMs,
      error_message: probed.message,
      checked_at: new Date(),
    };
  }

  async getAnchorHealth(anchorId: string) {
    const latest = await getLatestAnchorHealth(anchorId);
    return latest;
  }
}
