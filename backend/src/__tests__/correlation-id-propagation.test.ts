import { describe, it, expect, vi } from 'vitest';

// Mock uuid and express so correlation-id.ts can be imported in isolation
vi.mock('uuid', () => ({ v4: () => 'mocked-uuid' }));
vi.mock('express', () => ({ default: {} }));

describe('correlationFetch', () => {
  it('injects X-Correlation-ID when a correlation ID is active', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', mockFetch);

    const { setCorrelationId } = await import('../correlation-id');
    const { correlationFetch } = await import('../stellar-fetch');

    setCorrelationId('test-cid-123');
    await correlationFetch('https://example.com/test');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get('X-Correlation-ID')).toBe('test-cid-123');
  });

  it('omits X-Correlation-ID when no correlation ID is active', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', mockFetch);

    const { correlationFetch } = await import('../stellar-fetch');

    // Run outside any ALS context so getCorrelationId() returns undefined
    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        await correlationFetch('https://example.com/no-cid');
        resolve();
      }, 0);
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    // fetch should be called with no extra init (falls through to plain fetch)
    expect(init).toBeUndefined();
  });
});
