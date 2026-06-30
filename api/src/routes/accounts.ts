/**
 * GET /api/accounts/:address/stellar-fees
 *
 * Returns the current Stellar base fee, the account's native XLM balance,
 * and the estimated XLM required for the next N operations (Issue #949).
 *
 * Query parameters:
 *   operations  {number}  - Number of operations to estimate fees for (default: 1, max: 100)
 */

import { Router, Request, Response } from 'express';
import { ErrorResponse } from '../types';

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{54}$/;
const XLM_STROOPS_PER_XLM = 10_000_000;
const DEFAULT_BASE_FEE_STROOPS = 100;
const LOW_XLM_THRESHOLD = 2;

function timestamp(): string {
  return new Date().toISOString();
}

function sendError(res: Response, status: number, message: string, code: string): Response<ErrorResponse> {
  return res.status(status).json({ success: false, error: { message, code }, timestamp: timestamp() });
}

function getHorizonUrl(): string {
  if (process.env.HORIZON_URL) return process.env.HORIZON_URL;
  const network = (process.env.STELLAR_NETWORK ?? 'testnet').toLowerCase();
  return network === 'mainnet' || network === 'public'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
}

function getTopUpLink(): string {
  const network = (process.env.STELLAR_NETWORK ?? 'testnet').toLowerCase();
  if (network === 'mainnet' || network === 'public') {
    return 'https://www.stellarterm.com/exchange/XLM-native/USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  }
  return 'https://laboratory.stellar.org/#account-creator?network=testnet';
}

export function createAccountsRouter(): Router {
  const router = Router();

  /**
   * @openapi
   * /api/accounts/{address}/stellar-fees:
   *   get:
   *     summary: Get Stellar network fee info and XLM balance for an account
   *     tags:
   *       - Accounts
   *     parameters:
   *       - name: address
   *         in: path
   *         required: true
   *         description: Stellar account address (G...)
   *         schema:
   *           type: string
   *       - name: operations
   *         in: query
   *         required: false
   *         description: Number of operations to estimate fees for (default 1, max 100)
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 1
   *     responses:
   *       200:
   *         description: Stellar fee and balance information
   *       400:
   *         description: Invalid address or parameters
   *       404:
   *         description: Account not found on the network
   */
  router.get('/:address/stellar-fees', async (req: Request, res: Response) => {
    const { address } = req.params;
    const operationsStr = (req.query.operations as string | undefined) ?? '1';

    if (!STELLAR_ADDRESS_RE.test(address)) {
      return sendError(res, 400, 'Invalid Stellar address format', 'INVALID_ADDRESS');
    }

    const operationCount = parseInt(operationsStr, 10);
    if (isNaN(operationCount) || operationCount < 1 || operationCount > 100) {
      return sendError(res, 400, '`operations` must be between 1 and 100', 'INVALID_OPERATIONS');
    }

    const horizonUrl = getHorizonUrl();

    // Fetch fee stats and account in parallel
    const [feeStatsRes, accountRes] = await Promise.allSettled([
      fetch(`${horizonUrl}/fee_stats`),
      fetch(`${horizonUrl}/accounts/${address}`),
    ]);

    // Parse base fee
    let baseFeeStroops = DEFAULT_BASE_FEE_STROOPS;
    if (feeStatsRes.status === 'fulfilled' && feeStatsRes.value.ok) {
      try {
        const feeData = await feeStatsRes.value.json() as { fee_charged?: { mode?: string } };
        const mode = feeData?.fee_charged?.mode;
        if (mode) baseFeeStroops = parseInt(mode, 10) || DEFAULT_BASE_FEE_STROOPS;
      } catch {
        // fall back to default
      }
    }

    // Parse XLM balance
    let xlmBalance: number | null = null;
    let accountFound = true;

    if (accountRes.status === 'fulfilled') {
      if (accountRes.value.status === 404) {
        accountFound = false;
      } else if (accountRes.value.ok) {
        try {
          const accountData = await accountRes.value.json() as {
            balances?: Array<{ asset_type: string; balance: string }>;
          };
          const nativeBalance = accountData?.balances?.find(b => b.asset_type === 'native');
          if (nativeBalance) xlmBalance = parseFloat(nativeBalance.balance);
        } catch {
          // account data unavailable
        }
      }
    }

    if (!accountFound) {
      return sendError(res, 404, 'Account not found on the Stellar network', 'ACCOUNT_NOT_FOUND');
    }

    const estimatedFeeStroops = baseFeeStroops * operationCount;
    const estimatedFeeXlm = estimatedFeeStroops / XLM_STROOPS_PER_XLM;
    const lowBalance = xlmBalance !== null && xlmBalance < LOW_XLM_THRESHOLD;

    return res.json({
      success: true,
      data: {
        address,
        base_fee_stroops: baseFeeStroops,
        base_fee_xlm: baseFeeStroops / XLM_STROOPS_PER_XLM,
        xlm_balance: xlmBalance,
        estimated_fee_stroops: estimatedFeeStroops,
        estimated_fee_xlm: estimatedFeeXlm,
        operation_count: operationCount,
        low_balance: lowBalance,
        ...(lowBalance && { top_up_link: getTopUpLink() }),
        horizon_url: horizonUrl,
      },
      timestamp: timestamp(),
    });
  });

  return router;
}
