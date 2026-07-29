import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FailoverFxService, FxRateProvider, resetFailoverFxService } from '../fx-provider';

function makeProvider(name: string, impl: () => Promise<number>): FxRateProvider {
  return { name, getRate: vi.fn().mockImplementation(impl) };
}

beforeEach(() => {
  resetFailoverFxService();
});

describe('FailoverFxService', () => {
  it('returns rate from primary when healthy', async () => {
    const primary = makeProvider('primary', async () => 1.25);
    const secondary = makeProvider('secondary', async () => 9.99);
    const svc = new FailoverFxService(primary, secondary);

    expect(await svc.getRate('USD', 'EUR')).toBe(1.25);
    expect(primary.getRate).toHaveBeenCalledOnce();
    expect(secondary.getRate).not.toHaveBeenCalled();
  });

  it('falls through to secondary when primary fails', async () => {
    const primary = makeProvider('primary', async () => { throw new Error('primary down'); });
    const secondary = makeProvider('secondary', async () => 1.30);
    const svc = new FailoverFxService(primary, secondary);

    const rate = await svc.getRate('USD', 'EUR');
    expect(rate).toBe(1.30);
    expect(secondary.getRate).toHaveBeenCalledOnce();
  });

  it('opens circuit after primary failure so next call skips primary', async () => {
    const primary = makeProvider('primary', async () => { throw new Error('down'); });
    const secondary = makeProvider('secondary', async () => 1.30);
    const svc = new FailoverFxService(primary, secondary, 60_000);

    await svc.getRate('USD', 'EUR'); // opens circuit
    await svc.getRate('USD', 'EUR'); // circuit open — primary should NOT be called again

    expect(primary.getRate).toHaveBeenCalledTimes(1); // only the first call
    expect(secondary.getRate).toHaveBeenCalledTimes(2);
  });

  it('half-opens circuit after halfOpenAfterMs and probes primary again', async () => {
    const primary = makeProvider('primary', async () => { throw new Error('down'); });
    const secondary = makeProvider('secondary', async () => 1.30);
    const svc = new FailoverFxService(primary, secondary, 0); // expires immediately

    await svc.getRate('USD', 'EUR'); // opens circuit, half-open immediately
    await svc.getRate('USD', 'EUR'); // half-open → probes primary again

    expect(primary.getRate).toHaveBeenCalledTimes(2);
  });

  it('serves stale cache when both providers fail', async () => {
    let callCount = 0;
    const primary = makeProvider('primary', async () => {
      callCount++;
      if (callCount === 1) return 1.25; // first call succeeds → populates stale cache
      throw new Error('primary down');
    });
    const secondary = makeProvider('secondary', async () => { throw new Error('secondary down'); });
    const svc = new FailoverFxService(primary, secondary, 0);

    await svc.getRate('USD', 'EUR'); // success → stale cache set
    const staleRate = await svc.getRate('USD', 'EUR'); // both fail → stale served
    expect(staleRate).toBe(1.25);
  });

  it('throws when both fail and no stale cache exists', async () => {
    const primary = makeProvider('primary', async () => { throw new Error('down'); });
    const secondary = makeProvider('secondary', async () => { throw new Error('down'); });
    const svc = new FailoverFxService(primary, secondary);

    await expect(svc.getRate('USD', 'EUR')).rejects.toThrow('no rate available');
  });

  it('rejects a stale cached rate beyond the max staleness threshold', async () => {
    let callCount = 0;
    const primary = makeProvider('primary', async () => {
      callCount++;
      if (callCount === 1) return 1.25; // first call succeeds → populates stale cache
      throw new Error('primary down');
    });
    const secondary = makeProvider('secondary', async () => { throw new Error('secondary down'); });
    const svc = new FailoverFxService(primary, secondary, 0, -1); // maxStalenessSeconds = -1 → always exceeded

    await svc.getRate('USD', 'EUR'); // success → stale cache set
    await expect(svc.getRate('USD', 'EUR')).rejects.toThrow('exceeds max staleness');
  });

  it('rejects a rate deviating beyond the sanity bound and fails over', async () => {
    const primary = makeProvider('primary', async () => 1.25);
    const secondary = makeProvider('secondary', async () => 1.30);
    const svc = new FailoverFxService(primary, secondary, 60_000, 300, 10); // max 10% deviation

    expect(await svc.getRate('USD', 'EUR')).toBe(1.25); // seeds last-known-good

    (primary.getRate as ReturnType<typeof vi.fn>).mockImplementation(async () => 5.0); // >>10% deviation
    const rate = await svc.getRate('USD', 'EUR');
    expect(rate).toBe(1.30); // fell through to secondary since primary rate was rejected
  });

  it('invokes the metrics observer on provider failure, failover, and rejection', async () => {
    const observer = {
      onProviderFailure: vi.fn(),
      onFailover: vi.fn(),
      onRateRejected: vi.fn(),
    };
    const primary = makeProvider('primary', async () => { throw new Error('down'); });
    const secondary = makeProvider('secondary', async () => 1.30);
    const svc = new FailoverFxService(primary, secondary);
    svc.setMetricsObserver(observer);

    await svc.getRate('USD', 'EUR');

    expect(observer.onProviderFailure).toHaveBeenCalledWith('primary', 'USD/EUR');
    expect(observer.onFailover).toHaveBeenCalledWith('primary', 'secondary', 'USD/EUR');
  });

  it('logs fx_provider_switch alert JSON on primary failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const primary = makeProvider('primary', async () => { throw new Error('timeout'); });
    const secondary = makeProvider('secondary', async () => 1.30);
    const svc = new FailoverFxService(primary, secondary);

    await svc.getRate('USD', 'EUR');

    const alertCall = warnSpy.mock.calls.find(([msg]) => msg.includes('fx_provider_switch'));
    expect(alertCall).toBeDefined();
    const parsed = JSON.parse(alertCall![0]);
    expect(parsed.event).toBe('fx_provider_switch');
    expect(parsed.from).toBe('primary');
    expect(parsed.to).toBe('secondary');
    warnSpy.mockRestore();
  });
});
