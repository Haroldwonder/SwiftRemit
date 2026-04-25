/**
 * Coverage gap tests for HorizonService — Issue #395
 * Covers: API timeout, parseScVal numeric/nested/empty paths,
 *         fetchRemittanceFee fallback (no matching event).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HorizonService } from '../horizonService';

vi.mock('@stellar/stellar-sdk', () => {
  return {
    Server: vi.fn().mockImplementation(() => ({
      events: vi.fn(),
    })),
    Horizon: {},
  };
});

function makeService() {
  return new HorizonService('https://soroban-testnet.stellar.org', 'test-contract-id');
}

function mockEvents(service: HorizonService, callImpl: () => Promise<any>) {
  const mockCall = vi.fn().mockImplementation(callImpl);
  (service as any).server.events = vi.fn().mockReturnValue({
    forContract: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({ call: mockCall }),
      }),
    }),
  });
  return mockCall;
}

// ── parseScVal branch coverage ────────────────────────────────────────────────

describe('HorizonService.parseScVal (via fetchCompletedEvent)', () => {
  let service: HorizonService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  it('returns empty string when value is null', async () => {
    // topic[0]._value is undefined → parseScVal returns ''
    // The event won't match 'settle'/'complete', so result is null
    mockEvents(service, async () => ({
      records: [
        {
          topic: [{ _value: undefined }, { _value: { _value: 'complete' } }],
          value: { _value: [] },
        },
      ],
    }));
    const result = await service.fetchCompletedEvent(1);
    expect(result).toBeNull();
  });

  it('handles numeric _value in ScVal', async () => {
    // topic[1]._value._value is a number — parseScVal should stringify it
    mockEvents(service, async () => ({
      records: [
        {
          topic: [
            { _value: { _value: 'settle' } },
            { _value: { _value: 42 } }, // number, not 'complete'
          ],
          value: { _value: [] },
        },
      ],
    }));
    const result = await service.fetchCompletedEvent(1);
    expect(result).toBeNull(); // '42' !== 'complete', so no match
  });

  it('handles nested object _value in ScVal', async () => {
    // _value._value is an object with its own _value
    mockEvents(service, async () => ({
      records: [
        {
          topic: [
            { _value: { _value: { _value: 'settle' } } },
            { _value: { _value: 'complete' } },
          ],
          value: { _value: [] },
        },
      ],
    }));
    const result = await service.fetchCompletedEvent(1);
    // 'settle' extracted from nested object, 'complete' matches — but value array
    // is empty so remittanceId won't match → null
    expect(result).toBeNull();
  });
});

// ── API timeout handling ──────────────────────────────────────────────────────

describe('HorizonService timeout / network error handling', () => {
  let service: HorizonService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  it('wraps timeout errors with a descriptive message', async () => {
    const timeoutError = new Error('Request timeout after 5000ms');
    mockEvents(service, async () => { throw timeoutError; });

    await expect(service.fetchCompletedEvent(1)).rejects.toThrow(
      'Failed to fetch completed event: Request timeout after 5000ms'
    );
  });

  it('wraps non-Error throws with Unknown error', async () => {
    mockEvents(service, async () => { throw 'string error'; });

    await expect(service.fetchCompletedEvent(1)).rejects.toThrow(
      'Failed to fetch completed event: Unknown error'
    );
  });

  it('wraps connection refused errors', async () => {
    mockEvents(service, async () => { throw new Error('ECONNREFUSED'); });

    await expect(service.fetchCompletedEvent(1)).rejects.toThrow('ECONNREFUSED');
  });
});

// ── fetchRemittanceFee fallback ───────────────────────────────────────────────

describe('HorizonService.fetchRemittanceFee fallback', () => {
  let service: HorizonService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  it('returns "0" when no matching created event exists', async () => {
    // First call: returns a matching settle/complete event
    // Second call (fetchRemittanceFee): returns no matching remit/created event
    let callCount = 0;
    const mockCall = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          records: [
            {
              topic: [
                { _value: { _value: 'settle' } },
                { _value: { _value: 'complete' } },
              ],
              value: {
                _value: [
                  null, null, null,
                  { _value: { _value: '7' } }, // remittanceId = 7
                  { _value: { _value: 'SENDER' } },
                  { _value: { _value: 'AGENT' } },
                  { _value: { _value: 'ASSET' } },
                  { _value: { _value: '5000' } },
                ],
              },
              txHash: 'hash1',
              ledger: 100,
              ledgerClosedAt: '2024-01-01T00:00:00Z',
            },
          ],
        };
      }
      // Second call: no remit/created events → fee fallback to '0'
      return { records: [] };
    });

    (service as any).server.events = vi.fn().mockReturnValue({
      forContract: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({ call: mockCall }),
        }),
      }),
    });

    const result = await service.fetchCompletedEvent(7);
    expect(result).not.toBeNull();
    expect(result?.fee).toBe('0');
  });

  it('returns "0" when fetchRemittanceFee itself throws', async () => {
    let callCount = 0;
    const mockCall = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          records: [
            {
              topic: [
                { _value: { _value: 'settle' } },
                { _value: { _value: 'complete' } },
              ],
              value: {
                _value: [
                  null, null, null,
                  { _value: { _value: '8' } },
                  { _value: { _value: 'S' } },
                  { _value: { _value: 'A' } },
                  { _value: { _value: 'ASSET' } },
                  { _value: { _value: '1000' } },
                ],
              },
              txHash: 'h2',
              ledger: 200,
              ledgerClosedAt: '2024-01-02T00:00:00Z',
            },
          ],
        };
      }
      throw new Error('fee lookup failed');
    });

    (service as any).server.events = vi.fn().mockReturnValue({
      forContract: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({ call: mockCall }),
        }),
      }),
    });

    const result = await service.fetchCompletedEvent(8);
    expect(result).not.toBeNull();
    expect(result?.fee).toBe('0');
  });
});
