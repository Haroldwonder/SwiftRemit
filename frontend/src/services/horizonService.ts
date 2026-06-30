import { rpc, xdr } from '@stellar/stellar-sdk';

export interface RemittanceCompletedEvent {
  remittanceId: string;
  sender: string;
  agent: string;
  timestamp: string;
  transactionHash: string;
  ledgerSequence: number;
}

export interface SettlementCompletedEvent extends RemittanceCompletedEvent {
  amount: string;
  fee: string;
  asset: string;
}

/**
 * Service for fetching Soroban contract events via Soroban RPC
 */
export class HorizonService {
  private server: rpc.Server;
  private contractId: string;
  /** Last successfully fetched fee per remittance ID (fallback cache) */
  private feeCache = new Map<number, string>();

  constructor(rpcUrl?: string, contractId?: string) {
    this.server = new rpc.Server(
      rpcUrl || import.meta.env.VITE_HORIZON_URL || 'https://soroban-testnet.stellar.org'
    );
    this.contractId = contractId || import.meta.env.VITE_CONTRACT_ID || '';
  }

  private parseScVal(val: xdr.ScVal): string {
    try {
      switch (val.switch().name) {
        case 'scvSymbol': return val.sym().toString();
        case 'scvString': return val.str().toString();
        case 'scvI64': return val.i64().toString();
        case 'scvU64': return val.u64().toString();
        case 'scvU32': return val.u32().toString();
        case 'scvI32': return val.i32().toString();
        default: return '';
      }
    } catch {
      return '';
    }
  }

  private async getStartLedger(): Promise<number> {
    const { sequence } = await this.server.getLatestLedger();
    return Math.max(1, sequence - 17280);
  }

  private async fetchContractEvents(): Promise<rpc.Api.EventResponse[]> {
    const startLedger = await this.getStartLedger();
    const response = await this.server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [this.contractId] }],
      limit: 200,
    });
    return response.events;
  }

  /**
   * Fetch the completed event for a given remittance ID
   */
  async fetchCompletedEvent(remittanceId: number): Promise<SettlementCompletedEvent | null> {
    if (!this.contractId) {
      throw new Error('Contract ID not configured. Set VITE_CONTRACT_ID in environment variables.');
    }

    try {
      const events = await this.fetchContractEvents();

      for (const event of events) {
        if (
          event.topic.length >= 2 &&
          this.parseScVal(event.topic[0]) === 'settle' &&
          this.parseScVal(event.topic[1]) === 'complete'
        ) {
          const vec = event.value.switch().name === 'scvVec' ? event.value.vec()! : [];
          if (vec.length < 8) continue;

          if (this.parseScVal(vec[3]) === remittanceId.toString()) {
            const fee = await this.fetchRemittanceFee(remittanceId);
            return {
              remittanceId: remittanceId.toString(),
              sender: this.parseScVal(vec[4]),
              agent: this.parseScVal(vec[5]),
              asset: this.parseScVal(vec[6]),
              amount: this.parseScVal(vec[7]),
              fee,
              timestamp: event.ledgerClosedAt,
              transactionHash: event.txHash,
              ledgerSequence: event.ledger,
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error fetching completed event from RPC:', error);
      throw new Error(`Failed to fetch completed event: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch the fee from the remittance_created event.
   * Retries up to 3 times with exponential backoff on 429 responses.
   * Falls back to the last cached value if all retries are exhausted.
   */
  private async fetchRemittanceFee(remittanceId: number): Promise<string> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 500;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const events = await this.fetchContractEvents();

        for (const event of events) {
          if (
            event.topic.length >= 2 &&
            this.parseScVal(event.topic[0]) === 'remit' &&
            this.parseScVal(event.topic[1]) === 'created'
          ) {
            const vec = event.value.switch().name === 'scvVec' ? event.value.vec()! : [];
            if (vec.length < 8) continue;

            if (this.parseScVal(vec[3]) === remittanceId.toString()) {
              const fee = this.parseScVal(vec[7]);
              this.feeCache.set(remittanceId, fee);
              return fee;
            }
          }
        }

        return this.feeCache.get(remittanceId) ?? '0';
      } catch (error: any) {
        const isRateLimit =
          error?.response?.status === 429 ||
          (error?.message && error.message.includes('429'));

        if (isRateLimit && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        console.error('Error fetching remittance fee:', error);
        return this.feeCache.get(remittanceId) ?? '0';
      }
    }

    return this.feeCache.get(remittanceId) ?? '0';
  }

  /**
   * Generate Stellar Expert link for a transaction
   */
  getStellarExpertLink(transactionHash: string, network: 'testnet' | 'public' = 'testnet'): string {
    return `https://stellar.expert/explorer/${network}/tx/${transactionHash}`;
  }
}

// Export singleton instance — reads VITE_HORIZON_URL from env, falls back to testnet
export const horizonService = new HorizonService(
  import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org'
);
