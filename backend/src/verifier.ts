import axios, { AxiosInstance } from 'axios';
import * as toml from 'toml';
import { VerificationStatus, VerificationResult, VerificationSource } from './types';
import { getCorrelationId } from './correlation-id';

const STELLAR_EXPERT_API = 'https://api.stellar.expert/explorer/testnet';
const REQUEST_TIMEOUT = 5000;
const MAX_RETRIES = 3;

export class AssetVerifier {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'SwiftRemit-Verifier/1.0',
      },
    });
  }

  /**
   * Get correlation ID for logging
   */
  private getLogContext(): { correlation_id?: string } {
    const correlationId = getCorrelationId();
    return correlationId ? { correlation_id: correlationId } : {};
  }

  async verifyAsset(assetCode: string, issuer: string): Promise<VerificationResult> {
    const logContext = this.getLogContext();
    console.log('Starting asset verification', { assetCode, issuer, ...logContext });

    const sources: VerificationSource[] = [];
    let totalScore = 0;
    let sourceCount = 0;

    // Check Stellar Expert
    const expertResult = await this.checkStellarExpert(assetCode, issuer);
    sources.push(expertResult);
    if (expertResult.verified) {
      totalScore += expertResult.score;
      sourceCount++;
    }

    // Check stellar.toml
    const tomlResult = await this.checkStellarToml(issuer);
    sources.push(tomlResult);
    if (tomlResult.verified) {
      totalScore += tomlResult.score;
      sourceCount++;
    }

    // Check trustline count
    const trustlineResult = await this.checkTrustlines(assetCode, issuer);
    sources.push(trustlineResult);
    if (trustlineResult.verified) {
      totalScore += trustlineResult.score;
      sourceCount++;
    }

    // Check transaction history
    const txHistoryResult = await this.checkTransactionHistory(assetCode, issuer);
    sources.push(txHistoryResult);
    if (txHistoryResult.verified) {
      totalScore += txHistoryResult.score;
      sourceCount++;
    }

    // Calculate reputation score
    const reputationScore = sourceCount > 0 ? Math.round(totalScore / sourceCount) : 0;

    // Determine status
    let status: VerificationStatus;
    if (reputationScore >= 70 && sourceCount >= 3) {
      status = VerificationStatus.Verified;
    } else if (reputationScore < 30 || this.hasSuspiciousIndicators(sources)) {
      status = VerificationStatus.Suspicious;
    } else {
      status = VerificationStatus.Unverified;
    }

    console.log('Asset verification completed', { 
      assetCode, 
      issuer, 
      status, 
      reputationScore, 
      sourceCount,
      ...logContext 
    });

    return {
      asset_code: assetCode,
      issuer,
      status,
      reputation_score: reputationScore,
      sources,
      trustline_count: trustlineResult.details?.count || 0,
      has_toml: tomlResult.verified,
    };
  }

  private async checkStellarExpert(
    assetCode: string,
    issuer: string
  ): Promise<VerificationSource> {
    const logContext = this.getLogContext();
    console.log('Checking Stellar Expert', { assetCode, issuer, ...logContext });

    try {
      const response = await this.retryRequest(async () => {
        return await this.httpClient.get(
          `${STELLAR_EXPERT_API}/asset/${assetCode}-${issuer}`
        );
      });

      if (response.data && response.data.rating) {
        const rating = response.data.rating;
        const verified = rating >= 3;
        const score = Math.min(rating * 20, 100);
        
        console.log('Stellar Expert check completed', { 
          assetCode, 
          issuer, 
          rating, 
          verified, 
          score,
          ...logContext 
        });

        return {
          name: 'Stellar Expert',
          verified,
          score,
          details: { rating, age: response.data.age },
        };
      }

      console.log('Stellar Expert check failed - no rating data', { assetCode, issuer, ...logContext });
      return {
        name: 'Stellar Expert',
        verified: false,
        score: 0,
      };
    } catch (error) {
      console.error('Stellar Expert check failed:', error, { assetCode, issuer, ...logContext });
      return {
        name: 'Stellar Expert',
        verified: false,
        score: 0,
      };
    }
  }

  private async checkStellarToml(issuer: string): Promise<VerificationSource> {
    const logContext = this.getLogContext();
    console.log('Checking Stellar TOML', { issuer, ...logContext });

    try {
      // Get issuer's home domain
      const accountResponse = await this.retryRequest(async () => {
        return await this.httpClient.get(
          `${process.env.HORIZON_URL}/accounts/${issuer}`
        );
      });

      const homeDomain = accountResponse.data.home_domain;
      if (!homeDomain) {
        console.log('No home domain found for issuer', { issuer, ...logContext });
        return {
          name: 'Stellar TOML',
          verified: false,
          score: 0,
        };
      }

      console.log('Found home domain', { issuer, homeDomain, ...logContext });

      // Fetch stellar.toml
      const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
      const tomlResponse = await this.retryRequest(async () => {
        return await this.httpClient.get(tomlUrl);
      });

      const tomlData = toml.parse(tomlResponse.data);

      // Validate TOML structure
      const hasValidStructure =
        tomlData.DOCUMENTATION ||
        tomlData.CURRENCIES ||
        tomlData.PRINCIPALS;

      if (hasValidStructure) {
        console.log('Stellar TOML validation successful', { 
          issuer, 
          homeDomain, 
          hasValidStructure,
          ...logContext 
        });

        return {
          name: 'Stellar TOML',
          verified: true,
          score: 80,
          details: {
            domain: homeDomain,
            has_documentation: !!tomlData.DOCUMENTATION,
            has_currencies: !!tomlData.CURRENCIES,
          },
        };
      }

      console.log('Stellar TOML validation failed - invalid structure', { issuer, homeDomain, ...logContext });
      return {
        name: 'Stellar TOML',
        verified: false,
        score: 30,
      };
    } catch (error) {
      console.error('Stellar TOML check failed:', error, { issuer, ...logContext });
      return {
        name: 'Stellar TOML',
        verified: false,
        score: 0,
      };
    }
  }

  private async checkTrustlines(
    assetCode: string,
    issuer: string
  ): Promise<VerificationSource> {
    const logContext = this.getLogContext();
    console.log('Checking trustlines', { assetCode, issuer, ...logContext });

    try {
      const response = await this.retryRequest(async () => {
        return await this.httpClient.get(
          `${process.env.HORIZON_URL}/assets`,
          {
            params: {
              asset_code: assetCode,
              asset_issuer: issuer,
            },
          }
        );
      });

      if (response.data._embedded?.records?.length > 0) {
        const asset = response.data._embedded.records[0];
        const trustlineCount = parseInt(asset.num_accounts || '0');

        let score = 0;
        if (trustlineCount >= 10000) score = 100;
        else if (trustlineCount >= 1000) score = 80;
        else if (trustlineCount >= 100) score = 60;
        else if (trustlineCount >= 10) score = 40;
        else score = 20;

        const verified = trustlineCount >= parseInt(process.env.MIN_TRUSTLINE_COUNT || '10');
        
        console.log('Trustline check completed', { 
          assetCode, 
          issuer, 
          trustlineCount, 
          score, 
          verified,
          ...logContext 
        });

        return {
          name: 'Trustline Analysis',
          verified,
          score,
          details: { count: trustlineCount },
        };
      }

      console.log('No trustlines found', { assetCode, issuer, ...logContext });
      return {
        name: 'Trustline Analysis',
        verified: false,
        score: 0,
        details: { count: 0 },
      };
    } catch (error) {
      console.error('Trustline check failed:', error, { assetCode, issuer, ...logContext });
      return {
        name: 'Trustline Analysis',
        verified: false,
        score: 0,
        details: { count: 0 },
      };
    }
  }

  private async checkTransactionHistory(
    assetCode: string,
    issuer: string
  ): Promise<VerificationSource> {
    const logContext = this.getLogContext();
    console.log('Checking transaction history', { assetCode, issuer, ...logContext });

    try {
      const response = await this.retryRequest(async () => {
        return await this.httpClient.get(
          `${process.env.HORIZON_URL}/accounts/${issuer}/transactions`,
          {
            params: { limit: 200 },
          }
        );
      });

      const transactions = response.data._embedded?.records || [];
      const txCount = transactions.length;

      console.log('Transaction history fetched', { 
        assetCode, 
        issuer, 
        totalTransactions: txCount,
        ...logContext 
      });

      // Check for suspicious patterns
      const recentTxs = transactions.filter((tx: any) => {
        const txDate = new Date(tx.created_at);
        const daysSince = (Date.now() - txDate.getTime()) / (1000 * 60 * 60 * 24);
        return daysSince <= 30;
      });

      const hasRecentActivity = recentTxs.length > 0;
      const hasHistoricalActivity = txCount > 10;

      let score = 0;
      if (hasRecentActivity && hasHistoricalActivity) score = 70;
      else if (hasHistoricalActivity) score = 50;
      else if (hasRecentActivity) score = 30;

      const verified = hasRecentActivity && hasHistoricalActivity;
      
      console.log('Transaction history check completed', { 
        assetCode, 
        issuer, 
        totalTransactions: txCount,
        recentTransactions: recentTxs.length,
        hasRecentActivity,
        hasHistoricalActivity,
        verified,
        score,
        ...logContext 
      });

      return {
        name: 'Transaction History',
        verified,
        score,
        details: {
          total_transactions: txCount,
          recent_transactions: recentTxs.length,
        },
      };
    } catch (error) {
      console.error('Transaction history check failed:', error, { assetCode, issuer, ...logContext });
      return {
        name: 'Transaction History',
        verified: false,
        score: 0,
      };
    }
  }

  private hasSuspiciousIndicators(sources: VerificationSource[]): boolean {
    const logContext = this.getLogContext();
    
    // Check for red flags
    const hasNoToml = !sources.find(s => s.name === 'Stellar TOML')?.verified;
    const hasLowTrustlines = (sources.find(s => s.name === 'Trustline Analysis')?.details?.count || 0) < 5;
    const hasNoHistory = !sources.find(s => s.name === 'Transaction History')?.verified;

    const hasSuspiciousIndicators = hasNoToml && hasLowTrustlines && hasNoHistory;
    
    if (hasSuspiciousIndicators) {
      console.log('Suspicious indicators detected', { 
        hasNoToml, 
        hasLowTrustlines, 
        hasNoHistory,
        ...logContext 
      });
    }

    return hasSuspiciousIndicators;
  }

  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    retries: number = MAX_RETRIES
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await requestFn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await this.delay(1000 * (i + 1)); // Exponential backoff
      }
    }
    throw new Error('Max retries exceeded');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
