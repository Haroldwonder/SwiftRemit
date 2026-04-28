import cron from 'node-cron';
import { AssetVerifier } from './verifier';
import { getStaleAssets, saveAssetVerification, getPool } from './database';
import { storeVerificationOnChain } from './stellar';
import { KycService } from './kyc-service';
import { Sep24Service } from './sep24-service';
import { SorobanRpc, Keypair } from '@stellar/stellar-sdk';
import { SwiftRemitClient } from '../../sdk/src/client.js';
import { KycExpiryNotifier } from './kyc-expiry-notifier';
import { createWebhookStore } from './webhooks/store';

const verifier = new AssetVerifier();
const kycService = new KycService();
const pool = getPool();
const sep24Service = new Sep24Service(pool);

export async function startBackgroundJobs() {
  // Initialize KYC service
  await kycService.initialize();

  // Initialize SEP-24 service
  await sep24Service.initialize();

  // Run every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('Starting periodic asset revalidation...');
    await revalidateStaleAssets();
  });

  // Run KYC polling every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('Starting KYC status polling...');
    await pollKycStatuses();
  });

  // Run SEP-24 transaction polling every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    console.log('Starting SEP-24 transaction polling...');
    await pollSep24Transactions();
  });

  // Extend contract storage TTLs daily to prevent data loss
  cron.schedule('0 0 * * *', async () => {
    console.log('Starting contract storage TTL extension...');
    await extendContractStorageTtl();
  });

  // Send KYC expiry warnings daily at 08:00 UTC
  cron.schedule('0 8 * * *', async () => {
    console.log('Starting KYC expiry notification job...');
    await notifyKycExpiries();
  });

  console.log('Background jobs scheduled');
}

async function revalidateStaleAssets() {
  try {
    const hoursOld = parseInt(process.env.VERIFICATION_INTERVAL_HOURS || '24');
    const staleAssets = await getStaleAssets(hoursOld);

    console.log(`Found ${staleAssets.length} assets to revalidate`);

    for (const asset of staleAssets) {
      try {
        console.log(`Revalidating ${asset.asset_code}-${asset.issuer}`);

        const result = await verifier.verifyAsset(asset.asset_code, asset.issuer);

        const verification = {
          asset_code: result.asset_code,
          issuer: result.issuer,
          status: result.status,
          reputation_score: result.reputation_score,
          last_verified: new Date(),
          trustline_count: result.trustline_count,
          has_toml: result.has_toml,
          stellar_expert_verified: result.sources.find(s => s.name === 'Stellar Expert')?.verified,
          toml_data: result.sources.find(s => s.name === 'Stellar TOML')?.details,
          community_reports: asset.community_reports || 0,
        };

        await saveAssetVerification(verification);

        // Store on-chain
        try {
          await storeVerificationOnChain(verification);
        } catch (error) {
          console.error(`Failed to store on-chain for ${asset.asset_code}:`, error);
        }

        // Rate limiting - wait 1 second between verifications
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to revalidate ${asset.asset_code}:`, error);
      }
    }

    console.log('Periodic revalidation completed');
  } catch (error) {
    console.error('Error in revalidation job:', error);
  }
}

async function pollKycStatuses() {
  try {
    await kycService.pollAllAnchors();
    console.log('KYC polling completed');
  } catch (error) {
    console.error('Error in KYC polling job:', error);
  }
}

async function pollSep24Transactions() {
  try {
    await sep24Service.pollAllTransactions();
    console.log('SEP-24 polling completed');
  } catch (error) {
    console.error('Error in SEP-24 polling job:', error);
  }
}

/**
 * Extend contract storage TTLs to prevent data loss.
 * Calls `extend_storage_ttl` on the SwiftRemit contract using the admin keypair
 * configured via environment variables. Runs daily so TTLs never expire between
 * scheduled runs.
 *
 * Required env vars:
 *   CONTRACT_ID, SOROBAN_RPC_URL, NETWORK_PASSPHRASE, ADMIN_SECRET_KEY
 */
async function extendContractStorageTtl() {
  const contractId = process.env.CONTRACT_ID;
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  const networkPassphrase = process.env.NETWORK_PASSPHRASE;
  const adminSecretKey = process.env.ADMIN_SECRET_KEY;

  if (!contractId || !rpcUrl || !networkPassphrase || !adminSecretKey) {
    console.warn('extend_storage_ttl: missing env vars (CONTRACT_ID, SOROBAN_RPC_URL, NETWORK_PASSPHRASE, ADMIN_SECRET_KEY). Skipping.');
    return;
  }

  try {
    const client = new SwiftRemitClient({ contractId, rpcUrl, networkPassphrase });
    const keypair = Keypair.fromSecret(adminSecretKey);
    const adminAddress = keypair.publicKey();

    // Extend by ~30 days worth of ledgers (5-second ledger time)
    const extendByLedgers = 30 * 24 * 60 * 12; // 518_400 ledgers

    const tx = await (client as any).prepareTransaction(adminAddress, 'extend_storage_ttl', [
      // caller (Address) and extend_by_ledgers (u32) are encoded by the contract call
      // We use the raw prepareTransaction helper with pre-encoded args via the SDK
    ]);

    // Use the SDK's extendStorageTtl method
    const preparedTx = await (client as any).extendStorageTtl(adminAddress, extendByLedgers);
    await (client as any).submitTransaction(preparedTx, keypair);
    console.log(`Contract storage TTLs extended by ${extendByLedgers} ledgers`);
  } catch (error) {
    console.error('Failed to extend contract storage TTLs:', error);
  }
}

async function notifyKycExpiries() {
  try {
    const store = createWebhookStore(pool);
    const notifier = new KycExpiryNotifier(pool, store);
    await notifier.run();
  } catch (error) {
    console.error('Error in KYC expiry notification job:', error);
  }
}
