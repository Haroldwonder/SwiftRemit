import axios, { AxiosInstance } from 'axios';
import * as toml from 'toml';
import { VerificationStatus, VerificationResult, VerificationSource } from './types';

const STELLAR_EXPERT_API = 'https://api.stellar.expert/explorer/testnet';
const REQUEST_TIMEOUT = 5000;
const MAX_RETRIES = 3;
const POSITIVE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes for verified assets
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes for unverified/suspicious assets

interface CacheEntry {
  result: VerificationResult;
  expiresAt: number;
}

export class AssetVerifier {
  private httpClient: AxiosInstance;
  private cache = new Map<string, CacheEntry>();

  constructor() {
    this.httpClient = axios.create({
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'SwiftRemit-Verifier/1.0',
      },
    });
  }

  async verifyAsset(assetCode: string, issuer: string): Promise<VerificationResult> {
    const cacheKey = `${assetCode}:${issuer}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }
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

    const result: VerificationResult = {
      asset_code: assetCode,
      issuer,
      status,
      reputation_score: reputationScore,
      sources,
      trustline_count: trustlineResult.details?.count || 0,
      has_toml: tomlResult.verified,
    };

    const ttl = status === VerificationStatus.Verified ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    this.cache.set(cacheKey, { result, expiresAt: Date.now() + ttl });

    return result;
  }

  private async checkStellarExpert(
    assetCode: string,
    issuer: string
  ): Promise<VerificationSource> {
    try {
      const response = await this.retryRequest(async () => {
        return await this.httpClient.get(
          `${STELLAR_EXPERT_API}/asset/${assetCode}-${issuer}`
        );
      });

      if (response.data && response.data.rating) {
        const rating = response.data.rating;
        return {
          name: 'Stellar Expert',
          verified: rating >= 3,
          score: Math.min(rating * 20, 100),
          details: { rating, age: response.data.age },
        };
      }

      return {
        name: 'Stellar Expert',
        verified: false,
        score: 0,
      };
    } catch (error) {
      console.error('Stellar Expert check failed:', error);
      return {
        name: 'Stellar Expert',
        verified: false,
        score: 0,
      };
    }
  }

  private async checkStellarToml(issuer: string): Promise<VerificationSource> {
    try {
      // Get issuer's home domain
      const accountResponse = await this.retryRequest(async () => {
        return await this.httpClient.get(
          `${process.env.HORIZON_URL}/accounts/${issuer}`
        );
      });

      const homeDomain = accountResponse.data.home_domain;
      if (!homeDomain) {
        return {
          name: 'Stellar TOML',
          verified: false,
          score: 0,
        };
      }

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

      return {
        name: 'Stellar TOML',
        verified: false,
        score: 30,
      };
    } catch (error) {
      console.error('Stellar TOML check failed:', error);
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

        return {
          name: 'Trustline Analysis',
          verified: trustlineCount >= parseInt(process.env.MIN_TRUSTLINE_COUNT || '10'),
          score,
          details: { count: trustlineCount },
        };
      }

      return {
        name: 'Trustline Analysis',
        verified: false,
        score: 0,
        details: { count: 0 },
      };
    } catch (error) {
      console.error('Trustline check failed:', error);
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

      return {
        name: 'Transaction History',
        verified: hasRecentActivity && hasHistoricalActivity,
        score,
        details: {
          total_transactions: txCount,
          recent_transactions: recentTxs.length,
        },
      };
    } catch (error) {
      console.error('Transaction history check failed:', error);
      return {
        name: 'Transaction History',
        verified: false,
        score: 0,
      };
    }
  }

  private hasSuspiciousIndicators(sources: VerificationSource[]): boolean {
    // Check for red flags
    const hasNoToml = !sources.find(s => s.name === 'Stellar TOML')?.verified;
    const hasLowTrustlines = (sources.find(s => s.name === 'Trustline Analysis')?.details?.count || 0) < 5;
    const hasNoHistory = !sources.find(s => s.name === 'Transaction History')?.verified;

    return hasNoToml && hasLowTrustlines && hasNoHistory;
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
