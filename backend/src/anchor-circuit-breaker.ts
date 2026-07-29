export type AnchorCircuitState = 'closed' | 'open' | 'half-open';

export interface AnchorCircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  failureThreshold?: number;
  /** How long the circuit stays open before allowing a half-open probe. */
  resetTimeoutMs?: number;
  onOpen?(anchorId: string): void;
  onClose?(anchorId: string): void;
}

interface AnchorCircuitEntry {
  state: AnchorCircuitState;
  consecutiveFailures: number;
  openedAt: number;
}

/**
 * Per-anchor circuit breaker (closed → open → half-open) gating anchor calls
 * (KYC polling, health checks) so a persistently failing anchor stops being
 * retried until a half-open probe succeeds.
 */
export class AnchorCircuitBreaker {
  private entries = new Map<string, AnchorCircuitEntry>();
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private onOpen?: (anchorId: string) => void;
  private onClose?: (anchorId: string) => void;

  constructor(options: AnchorCircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
  }

  private getEntry(anchorId: string): AnchorCircuitEntry {
    let entry = this.entries.get(anchorId);
    if (!entry) {
      entry = { state: 'closed', consecutiveFailures: 0, openedAt: 0 };
      this.entries.set(anchorId, entry);
    }
    return entry;
  }

  /**
   * Whether the anchor should be skipped right now (circuit open and not yet
   * due for a half-open probe). Calling this transitions an expired open
   * circuit into 'half-open' so the caller knows to attempt exactly one probe.
   */
  shouldSkip(anchorId: string): boolean {
    const entry = this.getEntry(anchorId);
    if (entry.state === 'closed') return false;

    if (entry.state === 'open') {
      if (Date.now() - entry.openedAt >= this.resetTimeoutMs) {
        entry.state = 'half-open';
        return false;
      }
      return true;
    }

    // half-open: a probe is already in flight conceptually; allow it through.
    return false;
  }

  recordSuccess(anchorId: string): void {
    const entry = this.getEntry(anchorId);
    const wasOpen = entry.state !== 'closed';
    entry.state = 'closed';
    entry.consecutiveFailures = 0;
    entry.openedAt = 0;
    if (wasOpen) this.onClose?.(anchorId);
  }

  recordFailure(anchorId: string): void {
    const entry = this.getEntry(anchorId);

    if (entry.state === 'half-open') {
      // Half-open probe failed — re-open and restart the reset timer.
      entry.state = 'open';
      entry.openedAt = Date.now();
      this.onOpen?.(anchorId);
      return;
    }

    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= this.failureThreshold) {
      const wasClosed = entry.state === 'closed';
      entry.state = 'open';
      entry.openedAt = Date.now();
      if (wasClosed) this.onOpen?.(anchorId);
    }
  }

  getState(anchorId: string): AnchorCircuitState {
    return this.getEntry(anchorId).state;
  }

  isOpen(anchorId: string): boolean {
    return this.getEntry(anchorId).state === 'open';
  }

  reset(anchorId: string): void {
    this.entries.delete(anchorId);
  }
}

let instance: AnchorCircuitBreaker | null = null;
export function getAnchorCircuitBreaker(): AnchorCircuitBreaker {
  if (!instance) {
    instance = new AnchorCircuitBreaker({
      onOpen: anchorId => {
        console.warn(JSON.stringify({ event: 'anchor_circuit_open', anchor_id: anchorId }));
      },
      onClose: anchorId => {
        console.warn(JSON.stringify({ event: 'anchor_circuit_close', anchor_id: anchorId }));
      },
    });
  }
  return instance;
}
export function resetAnchorCircuitBreaker(): void {
  instance = null;
}
