/**
 * POST /api/settlements/simulate
 *
 * Read-only endpoint that previews net settlement amounts for a set of
 * remittances without committing any state changes (Issue #420).
 *
 * Request body:
 * {
 *   remittances: Array<{
 *     id: number;
 *     sender: string;
 *     agent: string;
 *     amount: number;       // in stroops
 *     fee: number;          // in stroops
 *     status: "Pending" | "Processing" | "Completed" | "Cancelled";
 *   }>
 * }
 *
 * Response:
 * {
 *   success: true;
 *   data: {
 *     net_transfers: Array<{
 *       party_a: string;
 *       party_b: string;
 *       net_amount: number;   // positive = party_a → party_b
 *       total_fees: number;
 *     }>;
 *     summary: {
 *       input_count: number;
 *       net_transfer_count: number;
 *       total_gross_amount: number;
 *       total_fees: number;
 *     };
 *   };
 *   timestamp: string;
 * }
 */

import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';

export interface SimulateRemittanceInput {
  id: number;
  sender: string;
  agent: string;
  amount: number;
  fee: number;
  status: 'Pending' | 'Processing' | 'Completed' | 'Cancelled' | 'Failed' | 'Disputed';
}

export interface NetTransferResult {
  party_a: string;
  party_b: string;
  /** Positive = party_a → party_b, negative = party_b → party_a */
  net_amount: number;
  total_fees: number;
}

export interface SimulateSettlementResponse {
  success: true;
  data: {
    net_transfers: NetTransferResult[];
    summary: {
      input_count: number;
      net_transfer_count: number;
      total_gross_amount: number;
      total_fees: number;
    };
  };
  timestamp: string;
}

/**
 * Deterministically normalise a pair of addresses so the lexicographically
 * smaller one is always party_a. Returns the direction multiplier (+1 or -1).
 */
function normalisePair(
  from: string,
  to: string,
): { partyA: string; partyB: string; direction: 1 | -1 } {
  if (from < to) {
    return { partyA: from, partyB: to, direction: 1 };
  }
  return { partyA: to, partyB: from, direction: -1 };
}

/**
 * Pure function: compute net settlements from a list of remittances.
 * Mirrors the on-chain `compute_net_settlements` logic in netting.rs.
 */
export function computeNetSettlements(
  remittances: SimulateRemittanceInput[],
): NetTransferResult[] {
  // Only process Pending remittances (mirrors on-chain behaviour)
  const pending = remittances.filter((r) => r.status === 'Pending');

  const netMap = new Map<string, { partyA: string; partyB: string; net: number; fees: number }>();

  for (const r of pending) {
    const { partyA, partyB, direction } = normalisePair(r.sender, r.agent);
    const key = `${partyA}::${partyB}`;

    const existing = netMap.get(key) ?? { partyA, partyB, net: 0, fees: 0 };
    existing.net += r.amount * direction;
    existing.fees += r.fee;
    netMap.set(key, existing);
  }

  const results: NetTransferResult[] = [];
  for (const entry of netMap.values()) {
    // Skip zero-value net positions (Issue #421 fix mirrored here)
    if (entry.net !== 0) {
      results.push({
        party_a: entry.partyA,
        party_b: entry.partyB,
        net_amount: entry.net,
        total_fees: entry.fees,
      });
    }
  }

  return results;
}

const router = Router();

router.post('/simulate', (req: Request, res: Response) => {
  const { remittances } = req.body as { remittances?: unknown };

  if (!Array.isArray(remittances)) {
    const err: ErrorResponse = {
      success: false,
      error: { message: '`remittances` must be an array', code: 'INVALID_INPUT' },
      timestamp: new Date().toISOString(),
    };
    return res.status(400).json(err);
  }

  // Basic input validation
  for (const r of remittances) {
    if (
      typeof r !== 'object' ||
      r === null ||
      typeof (r as SimulateRemittanceInput).sender !== 'string' ||
      typeof (r as SimulateRemittanceInput).agent !== 'string' ||
      typeof (r as SimulateRemittanceInput).amount !== 'number' ||
      typeof (r as SimulateRemittanceInput).fee !== 'number'
    ) {
      const err: ErrorResponse = {
        success: false,
        error: {
          message: 'Each remittance must have sender, agent (strings) and amount, fee (numbers)',
          code: 'INVALID_INPUT',
        },
        timestamp: new Date().toISOString(),
      };
      return res.status(400).json(err);
    }
  }

  const inputs = remittances as SimulateRemittanceInput[];
  const netTransfers = computeNetSettlements(inputs);

  const pending = inputs.filter((r) => r.status === 'Pending');
  const totalGross = pending.reduce((sum, r) => sum + r.amount, 0);
  const totalFees = netTransfers.reduce((sum, t) => sum + t.total_fees, 0);

  const response: SimulateSettlementResponse = {
    success: true,
    data: {
      net_transfers: netTransfers,
      summary: {
        input_count: inputs.length,
        net_transfer_count: netTransfers.length,
        total_gross_amount: totalGross,
        total_fees: totalFees,
      },
    },
    timestamp: new Date().toISOString(),
  };

  return res.status(200).json(response);
});

export default router;
