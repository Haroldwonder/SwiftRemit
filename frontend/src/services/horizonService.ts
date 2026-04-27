import { Server, Horizon } from '@stellar/stellar-sdk';

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

interface ContractEventValue {
  _value?: {
    _value?: string | number | { _value?: string };
  };
}

/**
 * Service for fetching Soroban contract events from Horizon
 */
export class HorizonService {
  private server: Server;
  private contractId: string;

  constructor(horizonUrl?: string, contractId?: string) {
    this.server = new Server(
      horizonUrl || import.meta.env.VITE_HORIZON_URL || 'https://soroban-testnet.stellar.org'
    );
    this.contractId = contractId || import.meta.env.VITE_CONTRACT_ID || '';
  }

  /**
   * Parse ScVal from contract event data
   */
  private parseScVal(value: ContractEventValue): string {
    if (!value || !value._value) return '';
    
    const innerValue = value._value._value;
    if (typeof innerValue === 'string') return innerValue;
    if (typeof innerValue === 'number') return innerValue.toString();
    if (innerValue && typeof innerValue === 'object' && '_value' in innerValue) {
      return innerValue._value || '';
    }
    return '';
  }

  /**
   * Fetch the completed event for a given remittance ID
   */
  async fetchCompletedEvent(remittanceId: number): Promise<SettlementCompletedEvent | null> {
    if (!this.contractId) {
      throw new Error('Contract ID not configured. Set VITE_CONTRACT_ID in environment variables.');
    }

    try {
      // Fetch contract events for the settlement completion
      const eventsPage = await this.server
        .events()
        .forContract(this.contractId)
        .limit(200)
        .order('desc')
        .call();

      // Find the settlement completed event for this remittance ID
      for (const event of eventsPage.records) {
        const eventData = event as any;
        
        // Check if this is a settlement completed event
        if (
          eventData.topic &&
          eventData.topic.length >= 2 &&
          this.parseScVal(eventData.topic[0]) === 'settle' &&
          this.parseScVal(eventData.topic[1]) === 'complete'
        ) {
          // Parse event data
          const eventRemittanceId = eventData.value?._value?.[3];
          const parsedRemittanceId = this.parseScVal(eventRemittanceId);

          if (parsedRemittanceId === remittanceId.toString()) {
            // Extract event details
            const sender = this.parseScVal(eventData.value._value[4]);
            const agent = this.parseScVal(eventData.value._value[5]);
            const asset = this.parseScVal(eventData.value._value[6]);
            const amount = this.parseScVal(eventData.value._value[7]);

            // Get transaction details
            const txHash = eventData.txHash || '';
            const ledgerSequence = eventData.ledger || 0;
            const timestamp = eventData.ledgerClosedAt || new Date().toISOString();

            // Calculate fee (this would need to come from the remittance_created event)
            const fee = await this.fetchRemittanceFee(remittanceId);

            return {
              remittanceId: remittanceId.toString(),
              sender,
              agent,
              amount,
              fee,
              asset,
              timestamp,
              transactionHash: txHash,
              ledgerSequence,
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error fetching completed event from Horizon:', error);
      throw new Error(`Failed to fetch completed event: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch the fee from the remittance_created event
   */
  private async fetchRemittanceFee(remittanceId: number): Promise<string> {
    try {
      const eventsPage = await this.server
        .events()
        .forContract(this.contractId)
        .limit(200)
        .order('desc')
        .call();

      for (const event of eventsPage.records) {
        const eventData = event as any;
        
        if (
          eventData.topic &&
          eventData.topic.length >= 2 &&
          this.parseScVal(eventData.topic[0]) === 'remit' &&
          this.parseScVal(eventData.topic[1]) === 'created'
        ) {
          const eventRemittanceId = this.parseScVal(eventData.value?._value?.[3]);
          
          if (eventRemittanceId === remittanceId.toString()) {
            // Fee is at index 7 in the created event
            return this.parseScVal(eventData.value._value[7]);
          }
        }
      }

      return '0';
    } catch (error) {
      console.error('Error fetching remittance fee:', error);
      return '0';
    }
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
