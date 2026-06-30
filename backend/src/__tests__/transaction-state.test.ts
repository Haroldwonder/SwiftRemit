import { describe, it, expect, beforeEach } from 'vitest';
import { TransactionStateManager } from '../transaction-state';

describe('TransactionStateManager', () => {
  let stateManager: TransactionStateManager;

  beforeEach(() => {
    // Mock pool for testing
    const mockPool = {} as any;
    stateManager = new TransactionStateManager(mockPool);
  });

  describe('validateTransition - Deposits', () => {
    it('should allow valid deposit transitions', () => {
      expect(stateManager.validateTransition(
        'pending_user_transfer_start',
        'pending_anchor',
        'deposit'
      )).toBe(true);

      expect(stateManager.validateTransition(
        'pending_anchor',
        'pending_stellar',
        'deposit'
      )).toBe(true);

      expect(stateManager.validateTransition(
        'pending_stellar',
        'completed',
        'deposit'
      )).toBe(true);
    });

    it('should reject invalid deposit transitions', () => {
      expect(stateManager.validateTransition(
        'completed',
        'pending_anchor',
        'deposit'
      )).toBe(false);

      expect(stateManager.validateTransition(
        'pending_user_transfer_start',
        'completed',
        'deposit'
      )).toBe(false);
    });

    it('should allow error recovery', () => {
      expect(stateManager.validateTransition(
        'error',
        'refunded',
        'deposit'
      )).toBe(true);
    });
  });

  describe('validateTransition - Withdrawals', () => {
    it('should allow valid withdrawal transitions', () => {
      expect(stateManager.validateTransition(
        'pending_user_transfer_start',
        'pending_anchor',
        'withdrawal'
      )).toBe(true);

      expect(stateManager.validateTransition(
        'pending_anchor',
        'pending_external',
        'withdrawal'
      )).toBe(true);

      expect(stateManager.validateTransition(
        'pending_external',
        'completed',
        'withdrawal'
      )).toBe(true);
    });

    it('should reject invalid withdrawal transitions', () => {
      expect(stateManager.validateTransition(
        'pending_anchor',
        'pending_trust',
        'withdrawal'
      )).toBe(false);

      expect(stateManager.validateTransition(
        'completed',
        'pending_external',
        'withdrawal'
      )).toBe(false);
    });
  });
});
