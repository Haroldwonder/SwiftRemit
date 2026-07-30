import axios from 'axios';
import { getSecretsManager } from './secrets-manager';

export interface FxRateProvider {
  name: string;
  getRate(from: string, to: string): Promise<number>;
}

// ── Primary provider: exchangerate-api.com ────────────────────────────────────

export class PrimaryFxProvider implements FxRateProvider {
  readonly name = 'primary';
  private apiUrl: string;

  constructor(
    apiUrl = process.env.FX_API_URL || 'https://v6.exchangerate-api.com/v6'
  ) {
    this.apiUrl = apiUrl;
  }

  async getRate(from: string, to: string): Promise<number> {
    const sm = getSecretsManager();
    const apiKey = await sm.getSecret({ secretId: 'FX_API_KEY', required: false });

    const url = apiKey
      ? `${this.apiUrl}/${apiKey}/latest/${from}`
      : `${this.apiUrl}/latest/${from}`;
    const { data } = await axios.get(url, { timeout: 5000 });
    const rate = data?.conversion_rates?.[to] ?? data?.rates?.[to];
    if (!rate) throw new Error(`Primary: rate not found for ${from}/${to}`);
    return parseFloat(rate);
  }
}

// ── Secondary provider: open.er-api.com (no key required) ────────────────────

export class SecondaryFxProvider implements FxRateProvider {
  readonly name = 'secondary';
  private apiUrl: string;

  constructor(
    apiUrl = process.env.FX_SECONDARY_API_URL || 'https://open.er-api.com/v6/latest'
  ) {
    this.apiUrl = apiUrl;
  }

  async getRate(from: string, to: string): Promise<number> {
    const url = `${this.apiUrl}/${from}`;
    const { data } = await axios.get(url, { timeout: 5000 });
    const rate = data?.rates?.[to];
    if (!rate) throw new Error(`Secondary: rate not found for ${from}/${to}`);
    return parseFloat(rate);
  }
}

// ── Circuit breaker state ─────────────────────────────────────────────────────

interface CircuitBreaker {
  open: boolean;
  openedAt: number;
  halfOpenAfterMs: number;
}

function isCircuitOpen(cb: CircuitBreaker): boolean {
  if (!cb.open) return false;
  if (Date.now() - cb.openedAt >= cb.halfOpenAfterMs) {
    cb.open = false;
    return false;
  }
  return true;
}

// ── Failover service ──────────────────────────────────────────────────────────

export interface FxMetricsObserver {
  onProviderFailure?(provider: string, pair: string): void;
  onFailover?(fromProvider: string, toProvider: string, pair: string): void;
  onStaleServed?(pair: string, stalenessSeconds: number): void;
  onRateRejected?(pair: string, reason: 'stale' | 'sanity'): void;
}

export class FailoverFxService {
  private primary: FxRateProvider;
  private secondary: FxRateProvider;
  private cb: CircuitBreaker;
  private staleCache = new Map<string, { rate: number; ts: number }>();
  private maxStalenessSeconds: number;
  private maxDeviationPercent: number;
  private metricsObserver?: FxMetricsObserver;

  constructor(
    primary: FxRateProvider = new PrimaryFxProvider(),
    secondary: FxRateProvider = new SecondaryFxProvider(),
    halfOpenAfterMs = 60_000,
    maxStalenessSeconds = 300,
    maxDeviationPercent = 20
  ) {
    this.primary = primary;
    this.secondary = secondary;
    this.cb = { open: false, openedAt: 0, halfOpenAfterMs };
    this.maxStalenessSeconds = maxStalenessSeconds;
    this.maxDeviationPercent = maxDeviationPercent;
  }

  setMetricsObserver(observer: FxMetricsObserver): void {
    this.metricsObserver = observer;
  }

  async getRate(from: string, to: string): Promise<number> {
    const key = `${from}_${to}`;
    const pair = `${from}/${to}`;

    if (!isCircuitOpen(this.cb)) {
      try {
        const rate = await this.primary.getRate(from, to);
        return this.acceptRate(key, pair, rate);
      } catch (err) {
        this.metricsObserver?.onProviderFailure?.(this.primary.name, pair);
        this.openCircuit(from, to, err);
      }
    }

    try {
      const rate = await this.secondary.getRate(from, to);
      return this.acceptRate(key, pair, rate);
    } catch (err) {
      this.metricsObserver?.onProviderFailure?.(this.secondary.name, pair);
      const stale = this.staleCache.get(key);
      if (stale) {
        const stalenessSeconds = Math.floor((Date.now() - stale.ts) / 1000);
        if (stalenessSeconds > this.maxStalenessSeconds) {
          this.metricsObserver?.onRateRejected?.(pair, 'stale');
          throw new Error(`FailoverFxService: cached rate for ${pair} exceeds max staleness (${stalenessSeconds}s > ${this.maxStalenessSeconds}s)`);
        }
        console.warn(`[FailoverFxService] Both providers failed for ${pair}; serving stale rate (${stalenessSeconds}s old)`);
        this.metricsObserver?.onStaleServed?.(pair, stalenessSeconds);
        return stale.rate;
      }
      throw new Error(`FailoverFxService: no rate available for ${pair}`);
    }
  }

  /**
   * Validate a freshly fetched rate against the last known good value before
   * trusting it — a corrupted/malformed provider response can still parse to
   * a finite number that is wildly wrong (e.g. off by 100x).
   */
  private acceptRate(key: string, pair: string, rate: number): number {
    if (!Number.isFinite(rate) || rate <= 0) {
      this.metricsObserver?.onRateRejected?.(pair, 'sanity');
      throw new Error(`FailoverFxService: invalid rate for ${pair}`);
    }

    const lastGood = this.staleCache.get(key);
    if (lastGood) {
      const deviationPercent = (Math.abs(rate - lastGood.rate) / lastGood.rate) * 100;
      if (deviationPercent > this.maxDeviationPercent) {
        this.metricsObserver?.onRateRejected?.(pair, 'sanity');
        throw new Error(`FailoverFxService: rate for ${pair} deviates ${deviationPercent.toFixed(1)}% from last known good value (max ${this.maxDeviationPercent}%)`);
      }
    }

    this.staleCache.set(key, { rate, ts: Date.now() });
    return rate;
  }

  private openCircuit(from: string, to: string, err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err);
    this.cb.open = true;
    this.cb.openedAt = Date.now();
    this.metricsObserver?.onFailover?.(this.primary.name, this.secondary.name, `${from}/${to}`);
    console.warn(JSON.stringify({
      event: 'fx_provider_switch',
      from: this.primary.name,
      to: this.secondary.name,
      pair: `${from}/${to}`,
      reason,
    }));
  }

  isCircuitOpen(): boolean {
    return isCircuitOpen(this.cb);
  }
}

let instance: FailoverFxService | null = null;
export function getFailoverFxService(): FailoverFxService {
  if (!instance) instance = new FailoverFxService();
  return instance;
}
export function resetFailoverFxService(): void { instance = null; }