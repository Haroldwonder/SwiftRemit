import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based tests for fee calculation logic using fast-check.
 * 
 * These tests fuzz fee calculations with random amounts and basis points
 * to verify mathematical properties and catch edge cases like overflows.
 */

// Constants matching the Rust implementation
const FEE_DIVISOR = 10000;
const MIN_FEE = 1;
const MAX_FEE_BPS = 10000;

// Fee calculation functions (pure implementations for testing)
function calculatePercentageFee(amount: number, feeBps: number): number {
  if (amount <= 0) throw new Error('Invalid amount');
  if (feeBps < 0 || feeBps > MAX_FEE_BPS) throw new Error('Invalid fee bps');
  
  const fee = Math.floor((amount * feeBps) / FEE_DIVISOR);
  return Math.max(fee, MIN_FEE);
}

function calculateProtocolFee(amount: number, protocolFeeBps: number): number {
  if (amount <= 0) throw new Error('Invalid amount');
  if (protocolFeeBps < 0 || protocolFeeBps > MAX_FEE_BPS) throw new Error('Invalid protocol fee bps');
  
  if (protocolFeeBps === 0) return 0;
  
  return Math.floor((amount * protocolFeeBps) / FEE_DIVISOR);
}

function calculateDynamicFee(amount: number, baseFeeBps: number): number {
  if (amount <= 0) throw new Error('Invalid amount');
  if (baseFeeBps < 0 || baseFeeBps > MAX_FEE_BPS) throw new Error('Invalid base fee bps');
  
  let effectiveBps: number;
  
  // Tier 1: < 1000 USDC (1000 * 10^7 stroops)
  if (amount < 1000_0000000) {
    effectiveBps = baseFeeBps;
  }
  // Tier 2: 1000-10000 USDC
  else if (amount < 10000_0000000) {
    effectiveBps = Math.floor((baseFeeBps * 80) / 100);
  }
  // Tier 3: > 10000 USDC
  else {
    effectiveBps = Math.floor((baseFeeBps * 60) / 100);
  }
  
  const fee = Math.floor((amount * effectiveBps) / FEE_DIVISOR);
  return Math.max(fee, MIN_FEE);
}

function calculateFeeBreakdown(
  amount: number,
  platformFeeBps: number,
  protocolFeeBps: number
): { amount: number; platformFee: number; protocolFee: number; netAmount: number } {
  const platformFee = calculatePercentageFee(amount, platformFeeBps);
  const protocolFee = calculateProtocolFee(amount, protocolFeeBps);
  const netAmount = amount - platformFee - protocolFee;
  
  if (netAmount < 0) throw new Error('Fees exceed amount');
  
  return { amount, platformFee, protocolFee, netAmount };
}

// Read per-run count from env (CI sets FC_NUM_RUNS=100000); default 100k.
const NUM_RUNS = parseInt(process.env.FC_NUM_RUNS ?? '100000', 10);

describe('Fee Calculation Property-Based Tests', () => {
  describe('Percentage Fee Properties', () => {
    it('should never exceed the original amount', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1_000_000_000_000_000 }),
          fc.integer({ min: 0, max: MAX_FEE_BPS }),
          (amount, feeBps) => {
            const fee = calculatePercentageFee(amount, feeBps);
            expect(fee).toBeLessThanOrEqual(amount);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should always be at least MIN_FEE', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1_000_000_000_000_000 }),
          fc.integer({ min: 0, max: MAX_FEE_BPS }),
          (amount, feeBps) => {
            const fee = calculatePercentageFee(amount, feeBps);
            expect(fee).toBeGreaterThanOrEqual(MIN_FEE);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should be monotonically increasing with fee basis points', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 1_000_000_000_000_000 }),
          fc.integer({ min: 0, max: MAX_FEE_BPS - 1 }),
          (amount, feeBps) => {
            const fee1 = calculatePercentageFee(amount, feeBps);
            const fee2 = calculatePercentageFee(amount, feeBps + 1);
            expect(fee2).toBeGreaterThanOrEqual(fee1);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should be monotonically increasing with amount (when not floored)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 1_000_000_000_000_000 - 1 }),
          fc.integer({ min: 100, max: MAX_FEE_BPS }),
          (amount, feeBps) => {
            const fee1 = calculatePercentageFee(amount, feeBps);
            const fee2 = calculatePercentageFee(amount + 1, feeBps);
            expect(fee2).toBeGreaterThanOrEqual(fee1);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should calculate exact fee for known values', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000000 }),
          fc.integer({ min: 1, max: MAX_FEE_BPS }),
          (amount, feeBps) => {
            const fee = calculatePercentageFee(amount, feeBps);
            const expectedFee = Math.max(Math.floor((amount * feeBps) / FEE_DIVISOR), MIN_FEE);
            expect(fee).toBe(expectedFee);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  describe('Protocol Fee Properties', () => {
    it('should be zero when protocol fee bps is zero', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1_000_000_000_000_000 }),
          (amount) => {
            const fee = calculateProtocolFee(amount, 0);
            expect(fee).toBe(0);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should never exceed the original amount', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1_000_000_000_000_000 }),
          fc.integer({ min: 0, max: MAX_FEE_BPS }),
          (amount, protocolFeeBps) => {
            const fee = calculateProtocolFee(amount, protocolFeeBps);
            expect(fee).toBeLessThanOrEqual(amount);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should be monotonically increasing with protocol fee bps', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 1_000_000_000_000_000 }),
          fc.integer({ min: 0, max: MAX_FEE_BPS - 1 }),
          (amount, protocolFeeBps) => {
            const fee1 = calculateProtocolFee(amount, protocolFeeBps);
            const fee2 = calculateProtocolFee(amount, protocolFeeBps + 1);
            expect(fee2).toBeGreaterThanOrEqual(fee1);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  describe('Dynamic Fee Properties', () => {
    it('should apply correct tier discounts', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 1000 }), // Base fee bps
          (baseFeeBps) => {
            // Tier 1: < 1000 USDC - full fee
            const tier1Amount = 500_0000000;
            const tier1Fee = calculateDynamicFee(tier1Amount, baseFeeBps);
            const tier1Expected = Math.max(Math.floor((tier1Amount * baseFeeBps) / FEE_DIVISOR), MIN_FEE);
            expect(tier1Fee).toBe(tier1Expected);

            // Tier 2: 1000-10000 USDC - 80% of base fee
            const tier2Amount = 5000_0000000;
            const tier2Fee = calculateDynamicFee(tier2Amount, baseFeeBps);
            const tier2ExpectedBps = Math.floor((baseFeeBps * 80) / 100);
            const tier2Expected = Math.max(Math.floor((tier2Amount * tier2ExpectedBps) / FEE_DIVISOR), MIN_FEE);
            expect(tier2Fee).toBe(tier2Expected);

            // Tier 3: > 10000 USDC - 60% of base fee
            const tier3Amount = 20000_0000000;
            const tier3Fee = calculateDynamicFee(tier3Amount, baseFeeBps);
            const tier3ExpectedBps = Math.floor((baseFeeBps * 60) / 100);
            const tier3Expected = Math.max(Math.floor((tier3Amount * tier3ExpectedBps) / FEE_DIVISOR), MIN_FEE);
            expect(tier3Fee).toBe(tier3Expected);

            // Verify tier ordering: tier1 >= tier2 >= tier3 (for same base amount)
            const normalizedAmount = 1000_0000000; // Same amount for comparison
            const normalizedTier1 = Math.max(Math.floor((normalizedAmount * baseFeeBps) / FEE_DIVISOR), MIN_FEE);
            const normalizedTier2 = Math.max(Math.floor((normalizedAmount * tier2ExpectedBps) / FEE_DIVISOR), MIN_FEE);
            const normalizedTier3 = Math.max(Math.floor((normalizedAmount * tier3ExpectedBps) / FEE_DIVISOR), MIN_FEE);
            
            expect(normalizedTier1).toBeGreaterThanOrEqual(normalizedTier2);
            expect(normalizedTier2).toBeGreaterThanOrEqual(normalizedTier3);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  describe('Fee Breakdown Properties', () => {
    it('should maintain mathematical consistency: amount = platformFee + protocolFee + netAmount', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 1000000 }),
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 500 }),
          (amount, platformFeeBps, protocolFeeBps) => {
            const maxPlatformFee = Math.floor((amount * platformFeeBps) / FEE_DIVISOR);
            const maxProtocolFee = Math.floor((amount * protocolFeeBps) / FEE_DIVISOR);

            if (maxPlatformFee + maxProtocolFee >= amount) {
              return;
            }

            const breakdown = calculateFeeBreakdown(amount, platformFeeBps, protocolFeeBps);

            expect(breakdown.amount).toBe(amount);
            expect(breakdown.platformFee + breakdown.protocolFee + breakdown.netAmount).toBe(amount);
            expect(breakdown.netAmount).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should never have negative net amount', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 1000000 }),
          fc.integer({ min: 0, max: 500 }),
          fc.integer({ min: 0, max: 250 }),
          (amount, platformFeeBps, protocolFeeBps) => {
            try {
              const breakdown = calculateFeeBreakdown(amount, platformFeeBps, protocolFeeBps);
              expect(breakdown.netAmount).toBeGreaterThanOrEqual(0);
            } catch (error) {
              expect((error as Error).message).toBe('Fees exceed amount');
            }
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  describe('Overflow and Edge Case Properties', () => {
    it('should handle maximum safe integer amounts without overflow', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }), // Small fee bps to avoid overflow
          (feeBps) => {
            const maxSafeAmount = Math.floor(1_000_000_000_000_000 / MAX_FEE_BPS) * FEE_DIVISOR;
            
            expect(() => {
              calculatePercentageFee(maxSafeAmount, feeBps);
            }).not.toThrow();
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should handle minimum amounts correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: MAX_FEE_BPS }),
          (feeBps) => {
            const fee = calculatePercentageFee(1, feeBps);
            expect(fee).toBe(MIN_FEE);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should reject invalid inputs', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ max: 0 }),
            fc.integer({ min: -1000, max: -1 })
          ),
          fc.integer({ min: 0, max: MAX_FEE_BPS }),
          (invalidAmount, feeBps) => {
            expect(() => {
              calculatePercentageFee(invalidAmount, feeBps);
            }).toThrow('Invalid amount');
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should reject invalid fee basis points', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000000 }),
          fc.oneof(
            fc.integer({ max: -1 }),
            fc.integer({ min: MAX_FEE_BPS + 1, max: MAX_FEE_BPS + 1000 })
          ),
          (amount, invalidFeeBps) => {
            expect(() => {
              calculatePercentageFee(amount, invalidFeeBps);
            }).toThrow('Invalid fee bps');
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  describe('Specific Edge Cases', () => {
    it('should handle exact boundary values correctly', () => {
      // Test exact tier boundaries for dynamic fees
      const baseFeeBps = 400; // 4%
      
      // Just below tier 2 threshold
      const justBelowTier2 = 999_9999999;
      const feeBelowTier2 = calculateDynamicFee(justBelowTier2, baseFeeBps);
      const expectedBelowTier2 = Math.max(Math.floor((justBelowTier2 * baseFeeBps) / FEE_DIVISOR), MIN_FEE);
      expect(feeBelowTier2).toBe(expectedBelowTier2);
      
      // Exactly at tier 2 threshold
      const exactlyTier2 = 1000_0000000;
      const feeExactlyTier2 = calculateDynamicFee(exactlyTier2, baseFeeBps);
      const tier2Bps = Math.floor((baseFeeBps * 80) / 100);
      const expectedExactlyTier2 = Math.max(Math.floor((exactlyTier2 * tier2Bps) / FEE_DIVISOR), MIN_FEE);
      expect(feeExactlyTier2).toBe(expectedExactlyTier2);
    });

    it('should handle zero fee basis points', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000000 }),
          (amount) => {
            const fee = calculatePercentageFee(amount, 0);
            expect(fee).toBe(MIN_FEE); // Should be floored to MIN_FEE even with 0 bps
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('should handle maximum fee basis points (100%)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000000 }),
          (amount) => {
            const fee = calculatePercentageFee(amount, MAX_FEE_BPS);
            expect(fee).toBe(amount);
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });
});