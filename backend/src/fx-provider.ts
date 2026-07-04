import axios from 'axios';

export interface FxRateProvider {
  name: string;
  getRate(from: string, to: string): Promise<number>;
}

// ── Primary provider: exchangerate-api.com ────────────────────────────────────

export class PrimaryFxProvider implements FxRateProvider {
  readonly name = 'primary';
  private apiUrl: string;
  private apiKey: string;

  constructor(
    apiUrl = process.env.FX_API_URL || 'https://v6.exchangerate-api.com/v6',
    apiKey = process.env.FX_API_KEY || ''
  ) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async getRate(from: string, to: string): Promise<number> {
    const url = this.apiKey
      ? `${this.apiUrl}/${this.apiKey}/latest/${from}`
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
  private apiKey: string;

  constructor(
    apiUrl = process.env.FX_SECONDARY_API_URL || 'https://open.er-api.com/v6/latest',
    apiKey = process.env.FX_SECONDARY_API_KEY || ''
  ) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async getRate(from: string, to: string): Promise<number> {
    const url = this.apiKey
      ? `${this.apiUrl}/${from}?apikey=${this.apiKey}`
      : `${this.apiUrl}/${from}`;
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
    cb.open = false; // transition to half-open: allow one probe
    return false;
  }
  return true;
}

// ── Failover service ──────────────────────────────────────────────────────────

export class FailoverFxService {
  private primary: FxRateProvider;
  private secondary: FxRateProvider;
  private cb: CircuitBreaker;
  /** In-process stale cache keyed by "FROM_TO" */
  private staleCache = new Map<string, { rate: number; ts: number }>();

  constructor(
    primary: FxRateProvider = new PrimaryFxProvider(),
    secondary: FxRateProvider = new SecondaryFxProvider(),
    halfOpenAfterMs = 60_000
  ) {
    this.primary = primary;
    this.secondary = secondary;
    this.cb = { open: false, openedAt: 0, halfOpenAfterMs };
  }

  async getRate(from: string, to: string): Promise<number> {
    const key = `${from}_${to}`;

    if (!isCircuitOpen(this.cb)) {
      try {
        const rate = await this.primary.getRate(from, to);
        this.staleCache.set(key, { rate, ts: Date.now() });
        return rate;
      } catch (err) {
        this.openCircuit(from, to, err);
      }
    }

    // Primary unavailable — try secondary
    try {
      const rate = await this.secondary.getRate(from, to);
      this.staleCache.set(key, { rate, ts: Date.now() });
      return rate;
    } catch (err) {
      // Both failed — serve stale cache if available
      const stale = this.staleCache.get(key);
      if (stale) {
        console.warn(`[FailoverFxService] Both providers failed for ${from}/${to}; serving stale rate (${Math.floor((Date.now() - stale.ts) / 1000)}s old)`);
        return stale.rate;
      }
      throw new Error(`FailoverFxService: no rate available for ${from}/${to}`);
    }
  }

  private openCircuit(from: string, to: string, err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err);
    this.cb.open = true;
    this.cb.openedAt = Date.now();
    console.warn(JSON.stringify({
      event: 'fx_provider_switch',
      from: this.primary.name,
      to: this.secondary.name,
      pair: `${from}/${to}`,
      reason,
    }));
  }

  /** Expose circuit state for testing / health endpoints. */
  isCircuitOpen(): boolean {
    return isCircuitOpen(this.cb);
  }
}

// Singleton
let instance: FailoverFxService | null = null;
export function getFailoverFxService(): FailoverFxService {
  if (!instance) instance = new FailoverFxService();
  return instance;
}
export function resetFailoverFxService(): void { instance = null; }
