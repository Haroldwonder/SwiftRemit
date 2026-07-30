import { describe, it, expect, vi } from 'vitest';
import { AnchorCircuitBreaker } from '../anchor-circuit-breaker';

describe('AnchorCircuitBreaker', () => {
  it('stays closed below the failure threshold', () => {
    const cb = new AnchorCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure('anchor-1');
    cb.recordFailure('anchor-1');
    expect(cb.getState('anchor-1')).toBe('closed');
    expect(cb.shouldSkip('anchor-1')).toBe(false);
  });

  it('opens the circuit after the configured threshold and skips further calls', () => {
    const onOpen = vi.fn();
    const cb = new AnchorCircuitBreaker({ failureThreshold: 3, onOpen });
    cb.recordFailure('anchor-1');
    cb.recordFailure('anchor-1');
    cb.recordFailure('anchor-1');

    expect(cb.getState('anchor-1')).toBe('open');
    expect(cb.shouldSkip('anchor-1')).toBe(true);
    expect(onOpen).toHaveBeenCalledWith('anchor-1');
    expect(onOpen).toHaveBeenCalledOnce(); // only fires on the closed→open transition
  });

  it('moves to half-open once the reset timeout elapses, and closes on a successful probe', () => {
    const onClose = vi.fn();
    const cb = new AnchorCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50, onClose });
    cb.recordFailure('anchor-1'); // opens immediately (threshold 1)
    expect(cb.getState('anchor-1')).toBe('open');
    expect(cb.shouldSkip('anchor-1')).toBe(true); // still within reset window

    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(cb.shouldSkip('anchor-1')).toBe(false); // half-open probe allowed through
        expect(cb.getState('anchor-1')).toBe('half-open');

        cb.recordSuccess('anchor-1');
        expect(cb.getState('anchor-1')).toBe('closed');
        expect(onClose).toHaveBeenCalledWith('anchor-1');
        resolve();
      }, 60);
    });
  });

  it('re-opens the circuit when the half-open probe fails', () => {
    const onOpen = vi.fn();
    const cb = new AnchorCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50, onOpen });
    cb.recordFailure('anchor-1'); // opens

    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(cb.shouldSkip('anchor-1')).toBe(false); // half-open
        cb.recordFailure('anchor-1'); // probe fails
        expect(cb.getState('anchor-1')).toBe('open');
        expect(cb.shouldSkip('anchor-1')).toBe(true); // reset timer restarted
        resolve();
      }, 60);
    });
  });

  it('tracks circuit state independently per anchor', () => {
    const cb = new AnchorCircuitBreaker({ failureThreshold: 1 });
    cb.recordFailure('anchor-1');
    expect(cb.getState('anchor-1')).toBe('open');
    expect(cb.getState('anchor-2')).toBe('closed');
  });
});
