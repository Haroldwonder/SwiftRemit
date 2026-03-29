import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { Pool } from 'pg';
import {
  getAnchorKycConfigs,
  saveSep24Transaction,
  getSep24Transaction,
  getPendingSep24Transactions,
  updateSep24TransactionStatus,
  getSep24TransactionById,
} from './database';
import { AnchorKycConfig } from './types';

/**
 * SEP-24 transaction types
 */
export type Sep24Direction = 'deposit' | 'withdrawal';

export type Sep24TransactionStatus =
  | 'pending_user_transfer_start'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_external'
  | 'pending_trust'
  | 'pending_user'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'error';

/**
 * SEP-24 interactive flow response
 */
export interface Sep24InteractiveResponse {
  transaction_id: string;
  url: string;
  message?: string;
}

/**
 * SEP-24 transaction data for database storage
 */
export interface Sep24TransactionRecord {
  id?: number;
  transaction_id: string;
  anchor_id: string;
  direction: Sep24Direction;
  status: Sep24TransactionStatus;
  asset_code: string;
  amount?: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  user_id: string;
  interactive_url?: string;
  instructions_url?: string;
  kyc_status?: 'pending' | 'approved' | 'rejected' | 'not_required';
  kyc_web_url?: string;
  status_eta?: number;
  last_polled?: Date;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * SEP-24 initiate request
 */
export interface Sep24InitiateRequest {
  user_id: string;
  anchor_id: string;
  direction: Sep24Direction;
  asset_code: string;
  amount: string;
  user_address?: string;
  user_email?: string;
}

/**
 * Configuration for SEP-24 interactive flow
 */
export interface AnchorSep24Config {
  anchor_id: string;
  sep_server_url: string;
  sep24_enabled: boolean;
  webauth_domain: string;
  webhook_url?: string;
  polling_interval_minutes: number;
  timeout_minutes: number;
}

/**
 * Response from anchor's /deposit or /withdraw endpoint
 */
interface Sep24InteractiveFlowResponse {
  transaction_id: string;
  url: string;
  interactive_url?: string;
  instructions_url?: string;
  kyc_web_url?: string;
  type?: string;
  fields?: Record<string, any>;
}

/**
 * Transaction status response from anchor
 */
interface Sep24TransactionStatusResponse {
  transaction: {
    id: string;
    status: string;
    status_eta?: number;
    amount_in?: string;
    amount_out?: string;
    amount_fee?: string;
    stellar_transaction_id?: string;
    external_transaction_id?: string;
    message?: string;
    kyc?: string;
  };
}

/**
 * Configuration error
 */
export class Sep24ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Sep24ConfigError';
  }
}

/**
 * Anchor timeout error
 */
export class Sep24TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Sep24TimeoutError';
  }
}

/**
 * Anchor communication error
 */
export class Sep24AnchorError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'Sep24AnchorError';
  }
}

/**
 * SEP-24 Service for handling deposit/withdrawal flows
 */
export class Sep24Service {
  private pool: Pool;
  private anchorConfigs: Map<string, AnchorSep24Config> = new Map();
  private httpClient: AxiosInstance;

  constructor(pool: Pool) {
    this.pool = pool;
    this.httpClient = axios.create({
      timeout: 30000, // 30 second timeout for SEP-24 requests
    });
  }

  /**
   * Initialize the SEP-24 service with anchor configurations
   */
  async initialize(): Promise<void> {
    const kycConfigs = await getAnchorKycConfigs();
    
    // Load SEP-24 configurations from environment
    for (const config of kycConfigs) {
      const sep24Enabled = process.env[`SEP24_ENABLED_${config.anchor_id.toUpperCase()}`] === 'true';
      const sepServerUrl = process.env[`SEP24_SERVER_${config.anchor_id.toUpperCase()}`] || config.kyc_server_url;
      
      if (sep24Enabled && sepServerUrl) {
        const anchorConfig: AnchorSep24Config = {
          anchor_id: config.anchor_id,
          sep_server_url: sepServerUrl,
          sep24_enabled: true,
          webauth_domain: new URL(sepServerUrl).host,
          webhook_url: process.env[`SEP24_WEBHOOK_${config.anchor_id.toUpperCase()}`],
          polling_interval_minutes: parseInt(process.env[`SEP24_POLL_INTERVAL_${config.anchor_id.toUpperCase()}`] || '5'),
          timeout_minutes: parseInt(process.env[`SEP24_TIMEOUT_${config.anchor_id.toUpperCase()}`] || '30'),
        };
        
        this.anchorConfigs.set(config.anchor_id, anchorConfig);
      }
    }
    
    console.log(`Initialized SEP-24 service with ${this.anchorConfigs.size} enabled anchors`);
  }

  /**
   * Initiate a SEP-24 deposit or withdrawal flow
   */
  async initiateFlow(request: Sep24InitiateRequest): Promise<Sep24InteractiveResponse> {
    const { user_id, anchor_id, direction, asset_code, amount, user_address, user_email } = request;

    // Get anchor configuration
    const anchorConfig = this.anchorConfigs.get(anchor_id);
    if (!anchorConfig) {
      throw new Sep24ConfigError(`Anchor ${anchor_id} is not configured for SEP-24`);
    }

    if (!anchorConfig.sep24_enabled) {
      throw new Sep24ConfigError(`SEP-24 is not enabled for anchor ${anchor_id}`);
    }

    // Generate transaction ID
    const transactionId = `${anchor_id}-${direction}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Call anchor's SEP-24 deposit or withdraw endpoint
      const endpoint = direction === 'deposit' ? 'deposit' : 'withdraw';
      const url = `${anchorConfig.sep_server_url}/${endpoint}`;
      
      const requestBody: Record<string, any> = {
        asset_code: asset_code,
        amount: amount,
        transaction_id: transactionId,
        lang: 'en',
      };

      // Add user identification
      if (user_address) {
        requestBody.account = user_address;
      }
      
      if (user_email) {
        requestBody.email = user_email;
      }

      // Add callback for webhook (if configured)
      if (anchorConfig.webhook_url) {
        requestBody.callback_url = `${anchorConfig.webhook_url}?transaction_id=${transactionId}`;
      }

      console.log(`Initiating SEP-24 ${direction} for anchor ${anchor_id}, transaction ${transactionId}`);

      const response: AxiosResponse<Sep24InteractiveFlowResponse> = await this.httpClient.post(
        url,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          // Allow 302 redirect to capture interactive URL
          maxRedirects: 5,
        }
      );

      const data = response.data;

      // Store transaction in database
      const transactionRecord: Sep24TransactionRecord = {
        transaction_id: data.transaction_id || transactionId,
        anchor_id: anchor_id,
        direction: direction,
        status: 'pending_anchor',
        asset_code: asset_code,
        amount: amount,
        user_id: user_id,
        interactive_url: data.interactive_url || data.url,
        instructions_url: data.instructions_url,
        kyc_status: data.kyc_web_url ? 'pending' : 'not_required',
        kyc_web_url: data.kyc_web_url,
      };

      await saveSep24Transaction(transactionRecord);

      return {
        transaction_id: data.transaction_id || transactionId,
        url: data.interactive_url || data.url,
        message: data.instructions_url || 'Follow the link to complete the transaction',
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const errorMessage = error.response?.data?.error || error.message;
        
        // Store failed transaction for tracking
        await saveSep24Transaction({
          transaction_id: transactionId,
          anchor_id: anchor_id,
          direction: direction,
          status: 'error',
          asset_code: asset_code,
          amount: amount,
          user_id: user_id,
        });

        throw new Sep24AnchorError(
          `Failed to initiate ${direction}: ${errorMessage}`,
          statusCode
        );
      }
      
      throw error;
    }
  }

  /**
   * Poll all pending SEP-24 transactions for status updates
   */
  async pollAllTransactions(): Promise<void> {
    for (const [anchorId, config] of this.anchorConfigs) {
      try {
        await this.pollAnchorTransactions(anchorId, config);
      } catch (error) {
        console.error(`Failed to poll transactions for anchor ${anchorId}:`, error);
      }
    }
  }

  /**
   * Poll transactions for a specific anchor
   */
  private async pollAnchorTransactions(
    anchorId: string,
    config: AnchorSep24Config
  ): Promise<void> {
    // Get pending transactions for this anchor
    const pendingTransactions = await getPendingSep24Transactions(
      anchorId,
      config.polling_interval_minutes
    );

    console.log(`Polling ${pendingTransactions.length} transactions for anchor ${anchorId}`);

    for (const transaction of pendingTransactions) {
      try {
        // Check for timeout
        const createdAt = transaction.created_at || new Date();
        const timeSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60);
        
        if (timeSinceCreation > config.timeout_minutes) {
          // Mark as expired
          await updateSep24TransactionStatus(transaction.transaction_id, 'expired');
          console.log(`Transaction ${transaction.transaction_id} marked as expired`);
          continue;
        }

        // Query anchor for status
        const statusResponse = await this.queryTransactionStatus(
          config.sep_server_url,
          transaction.transaction_id
        );

        if (statusResponse) {
          const { transaction: txn } = statusResponse;
          
          // Map anchor status to our status
          const newStatus = this.mapAnchorStatusToInternal(txn.status);
          
          // Update if status changed
          if (newStatus !== transaction.status) {
            await updateSep24TransactionStatus(
              transaction.transaction_id,
              newStatus,
              txn.amount_in,
              txn.amount_out,
              txn.amount_fee,
              txn.stellar_transaction_id,
              txn.external_transaction_id,
              txn.message
            );
            
            console.log(`Transaction ${transaction.transaction_id} updated to ${newStatus}`);
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Failed to poll transaction ${transaction.transaction_id}:`, error);
      }
    }
  }

  /**
   * Query transaction status from anchor
   */
  private async queryTransactionStatus(
    sepServerUrl: string,
    transactionId: string
  ): Promise<Sep24TransactionStatusResponse | null> {
    try {
      const url = `${sepServerUrl}/transaction?id=${transactionId}`;
      
      const response: AxiosResponse<Sep24TransactionStatusResponse> = await this.httpClient.get(url, {
        headers: {
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          return null;
        }
        console.error(`HTTP error querying transaction status: ${error.response?.status}`);
      }
      return null;
    }
  }

  /**
   * Map anchor status to our internal status
   */
  private mapAnchorStatusToInternal(anchorStatus: string): Sep24TransactionStatus {
    // SEP-24 status mapping
    const statusMap: Record<string, Sep24TransactionStatus> = {
      'pending_user_transfer_start': 'pending_user_transfer_start',
      'pending_anchor': 'pending_anchor',
      'pending_stellar': 'pending_stellar',
      'pending_external': 'pending_external',
      'pending_trust': 'pending_trust',
      'pending_user': 'pending_user',
      'completed': 'completed',
      'refunded': 'refunded',
      'expired': 'expired',
      'error': 'error',
    };

    return statusMap[anchorStatus] || 'error';
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(transactionId: string): Promise<Sep24TransactionRecord | null> {
    const record = await getSep24TransactionById(transactionId);
    if (!record) return null;
    
    // Transform database record to proper types
    return {
      transaction_id: record.transaction_id,
      anchor_id: record.anchor_id,
      direction: record.direction as Sep24Direction,
      status: record.status as Sep24TransactionStatus,
      asset_code: record.asset_code,
      amount: record.amount,
      amount_in: record.amount_in,
      amount_out: record.amount_out,
      amount_fee: record.amount_fee,
      stellar_transaction_id: record.stellar_transaction_id,
      external_transaction_id: record.external_transaction_id,
      user_id: record.user_id,
      interactive_url: record.interactive_url,
      instructions_url: record.instructions_url,
      kyc_status: record.kyc_status as 'pending' | 'approved' | 'rejected' | 'not_required' | undefined,
      kyc_web_url: record.kyc_web_url,
      status_eta: record.status_eta,
      last_polled: record.last_polled,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }

  /**
   * Handle webhook notification for transaction completion
   */
  async handleWebhookNotification(payload: {
    transaction_id: string;
    status: string;
    amount_in?: string;
    amount_out?: string;
    amount_fee?: string;
    stellar_transaction_id?: string;
    external_transaction_id?: string;
    message?: string;
  }): Promise<void> {
    const { transaction_id, status } = payload;
    const newStatus = this.mapAnchorStatusToInternal(status);

    await updateSep24TransactionStatus(
      transaction_id,
      newStatus,
      payload.amount_in,
      payload.amount_out,
      payload.amount_fee,
      payload.stellar_transaction_id,
      payload.external_transaction_id,
      payload.message
    );

    console.log(`Transaction ${transaction_id} updated via webhook to ${newStatus}`);
  }
}

/**
 * Create a new SEP-24 service instance
 */
export function createSep24Service(pool: Pool): Sep24Service {
  return new Sep24Service(pool);
}