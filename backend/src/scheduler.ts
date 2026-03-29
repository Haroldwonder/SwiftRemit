import cron from 'node-cron';
import { AssetVerifier } from './verifier';
import { getStaleAssets, saveAssetVerification, getPool } from './database';
import { storeVerificationOnChain } from './stellar';
import { KycService } from './kyc-service';
import { Sep24Service } from './sep24-service';

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
