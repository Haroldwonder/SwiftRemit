import axios from 'axios';

export interface Sep24InitiateParams {
  assetCode: string;
  assetIssuer: string;
  account: string;
  amount?: string;
  memo?: string;
  memoType?: 'text' | 'hash' | 'id';
}

export interface Sep24Transaction {
  id: string;
  kind: 'deposit' | 'withdrawal';
  status: Sep24Status;
  statusEta?: number;
  moreInfoUrl?: string;
  amountIn?: string;
  amountOut?: string;
  amountFee?: string;
  startedAt: string;
  completedAt?: string;
  stellarTransactionId?: string;
  externalTransactionId?: string;
  message?: string;
  refunds?: {
    amountRefunded: string;
    amountFee: string;
    payments: Array<{ id: string; amountRefunded: string; amountFee: string }>;
  };
}

export type Sep24Status =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_external'
  | 'pending_user'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'error';

export interface Sep24InitiateResult {
  type: 'interactive_customer_info_needed';
  url: string;
  id: string;
}

export interface Sep24PollResult {
  transaction: Sep24Transaction;
}

export interface Sep24ClientConfig {
  anchorBaseUrl: string;
  jwtToken: string;
}

export class Sep24Client {
  private readonly baseUrl: string;
  private readonly jwtToken: string;

  constructor(config: Sep24ClientConfig) {
    this.baseUrl = config.anchorBaseUrl.replace(/\/$/, '');
    this.jwtToken = config.jwtToken;
  }

  private authHeaders() {
    return { Authorization: `Bearer ${this.jwtToken}` };
  }

  async initiateDeposit(params: Sep24InitiateParams): Promise<Sep24InitiateResult> {
    const body = new URLSearchParams({
      asset_code: params.assetCode,
      asset_issuer: params.assetIssuer,
      account: params.account,
      ...(params.amount && { amount: params.amount }),
      ...(params.memo && { memo: params.memo }),
      ...(params.memoType && { memo_type: params.memoType }),
    });

    const { data } = await axios.post<Sep24InitiateResult>(
      `${this.baseUrl}/sep24/transactions/deposit/interactive`,
      body.toString(),
      {
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    if (data.type !== 'interactive_customer_info_needed') {
      throw new Error(`Unexpected response type: ${data.type}`);
    }

    return data;
  }

  async getTransaction(txId: string): Promise<Sep24Transaction> {
    const { data } = await axios.get<Sep24PollResult>(
      `${this.baseUrl}/sep24/transaction`,
      {
        params: { id: txId },
        headers: this.authHeaders(),
      },
    );
    return data.transaction;
  }

  async pollUntilComplete(
    txId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<Sep24Transaction> {
    const { intervalMs = 3_000, timeoutMs = 60_000 } = options;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const tx = await this.getTransaction(txId);

      if (
        tx.status === 'completed' ||
        tx.status === 'refunded' ||
        tx.status === 'expired' ||
        tx.status === 'error'
      ) {
        return tx;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`SEP-24 poll timeout after ${timeoutMs}ms for tx ${txId}`);
  }
}
