"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const transaction_state_1 = require("../transaction-state");
(0, vitest_1.describe)('TransactionStateManager', () => {
    let stateManager;
    (0, vitest_1.beforeEach)(() => {
        // Mock pool for testing
        const mockPool = {};
        stateManager = new transaction_state_1.TransactionStateManager(mockPool);
    });
    (0, vitest_1.describe)('validateTransition - Deposits', () => {
        (0, vitest_1.it)('should allow valid deposit transitions', () => {
            (0, vitest_1.expect)(stateManager.validateTransition('pending_user_transfer_start', 'pending_anchor', 'deposit')).toBe(true);
            (0, vitest_1.expect)(stateManager.validateTransition('pending_anchor', 'pending_stellar', 'deposit')).toBe(true);
            (0, vitest_1.expect)(stateManager.validateTransition('pending_stellar', 'completed', 'deposit')).toBe(true);
        });
        (0, vitest_1.it)('should reject invalid deposit transitions', () => {
            (0, vitest_1.expect)(stateManager.validateTransition('completed', 'pending_anchor', 'deposit')).toBe(false);
            (0, vitest_1.expect)(stateManager.validateTransition('pending_user_transfer_start', 'completed', 'deposit')).toBe(false);
        });
        (0, vitest_1.it)('should allow error recovery', () => {
            (0, vitest_1.expect)(stateManager.validateTransition('error', 'refunded', 'deposit')).toBe(true);
        });
    });
    (0, vitest_1.describe)('validateTransition - Withdrawals', () => {
        (0, vitest_1.it)('should allow valid withdrawal transitions', () => {
            (0, vitest_1.expect)(stateManager.validateTransition('pending_user_transfer_start', 'pending_anchor', 'withdrawal')).toBe(true);
            (0, vitest_1.expect)(stateManager.validateTransition('pending_anchor', 'pending_external', 'withdrawal')).toBe(true);
            (0, vitest_1.expect)(stateManager.validateTransition('pending_external', 'completed', 'withdrawal')).toBe(true);
        });
        (0, vitest_1.it)('should reject invalid withdrawal transitions', () => {
            (0, vitest_1.expect)(stateManager.validateTransition('pending_anchor', 'pending_trust', 'withdrawal')).toBe(false);
            (0, vitest_1.expect)(stateManager.validateTransition('completed', 'pending_external', 'withdrawal')).toBe(false);
        });
    });
});
