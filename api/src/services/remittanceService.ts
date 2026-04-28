/**
 * Remittance service layer.
 *
 * All business logic that mutates remittance state lives here.
 * This is the single place that calls `emitStatusChange()` — always
 * immediately after a successful DB persist, never before, never in a
 * finally block.
 *
 * Canonical state machine (mirrors src/types.rs):
 *
 *   Pending → Processing → Completed
 *           ↘            ↘
 *             Cancelled    Cancelled
 *   Pending / Processing → Failed → Disputed
 */

import { RemittanceStore, Remittance } from '../db/remittanceStore';
import { RemittanceStatus } from '../websocket/types';
import { emitStatusChange } from '../websocket';

// ── Valid transitions (mirrors Rust can_transition_to) ─────────────────────

const VALID_TRANSITIONS: Partial<Record<RemittanceStatus, RemittanceStatus[]>> = {
  Pending:    ['Processing', 'Cancelled', 'Failed'],
  Processing: ['Completed', 'Cancelled', 'Failed'],
  Failed:     ['Disputed'],
};

export class InvalidTransitionError extends Error {
  constructor(from: RemittanceStatus, to: RemittanceStatus) {
    super(`Invalid status transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class RemittanceNotFoundError extends Error {
  constructor(id: string) {
    super(`Remittance not found: ${id}`);
    this.name = 'RemittanceNotFoundError';
  }
}

// ── Service ────────────────────────────────────────────────────────────────

export class RemittanceService {
  constructor(private readonly store: RemittanceStore) {}

  /**
   * Transitions a remittance to a new status.
   *
   * 1. Loads the current record (404 if missing)
   * 2. Validates the transition against the state machine
   * 3. Persists the new status to the DB
   * 4. Emits `status:updated` over WebSocket — synchronously, in the same
   *    event-loop tick, only on success
   *
   * @throws RemittanceNotFoundError  if the remittance does not exist
   * @throws InvalidTransitionError   if the transition is not allowed
   */
  async updateStatus(id: string, newStatus: RemittanceStatus): Promise<Remittance> {
    // 1. Load current record
    const current = await this.store.getById(id);
    if (!current) {
      throw new RemittanceNotFoundError(id);
    }

    // 2. Idempotent: same-state is a no-op (safe for retries)
    if (current.status === newStatus) {
      return current;
    }

    // 3. Validate transition
    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new InvalidTransitionError(current.status, newStatus);
    }

    // 4. Persist — if this throws, emitStatusChange is never called
    const updated = await this.store.updateStatus(id, newStatus);
    if (!updated) {
      // Row disappeared between getById and updateStatus (race condition)
      throw new RemittanceNotFoundError(id);
    }

    // 5. Emit WebSocket event — synchronous, same event-loop tick as the
    //    DB update returning. Never in a finally block.
    emitStatusChange(id, newStatus);

    return updated;
  }

  /** Convenience passthrough for reads */
  async getById(id: string): Promise<Remittance | null> {
    return this.store.getById(id);
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

let defaultService: RemittanceService | null = null;

export function getDefaultRemittanceService(): RemittanceService {
  if (!defaultService) {
    const { getDefaultRemittanceStore } = require('../db/remittanceStore');
    defaultService = new RemittanceService(getDefaultRemittanceStore());
  }
  return defaultService;
}
