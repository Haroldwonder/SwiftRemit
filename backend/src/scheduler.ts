import cron from 'node-cron';
import { AssetVerifier } from './verifier';
import { getStaleAssets, saveAssetVerification, getPool, retireExpiredWebhookSecrets, getWebhookSubscriberById } from './database';
import { storeVerificationOnChain } from './stellar';
import { KycService } from './kyc-service';
import { Sep24Service } from './sep24-service';
import { Keypair } from '@stellar/stellar-sdk';
import { SwiftRemitClient } from '@swiftremit/sdk';
import { KycExpiryNotifier } from './kyc-expiry-notifier';
import { createWebhookStore } from './webhooks/store';
import { withAdvisoryLock } from './distributed-lock';
import { AnchorHealthChecker } from './anchor-health-checker';
import { getMetricsService } from './metrics';
import { runTracked } from './job-tracker';
import { tracedJob } from './tracing/job-tracer';
import { WebhookDlqProcessor } from './webhook-dlq-processor';
import { AdminAuditLogService } from './admin-audit-log';
import { SanctionsScreeningService } from './aml/sanctions-screening';
import { TravelRuleService } from './aml/travel-rule';
import { RetentionService } from './aml/retention';
import { createLogger } from './correlation-id';
import crypto from 'crypto';

const logger = createLogger('scheduler');

const verifier = new AssetVerifier();
const kycService = new KycService();
const pool = getPool();
const sep24Service = new Sep24Service(pool);
const metricsService = getMetricsService(pool);
const anchorHealthChecker = new AnchorHealthChecker(pool, metricsService);
const dlqProcessor = new WebhookDlqProcessor(pool);

export async function startBackgroundJobs() {
  // Initialize KYC service
  await kycService.initialize();

  // Initialize SEP-24 service
  await sep24Service.initialize();

  // Run every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'revalidate-stale-assets', async () => {
      await tracedJob('revalidate-stale-assets', () =>
        runTracked(pool, 'revalidate-stale-assets', revalidateStaleAssets)
      );
    });
    if (!ran) logger.info('revalidate-stale-assets: skipped (another instance holds the lock)');
  });

  // Run KYC polling every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'poll-kyc-statuses', async () => {
      await tracedJob('poll-kyc-statuses', () =>
        runTracked(pool, 'poll-kyc-statuses', pollKycStatuses)
      );
    });
    if (!ran) logger.info('poll-kyc-statuses: skipped (another instance holds the lock)');
  });

  // Run SEP-24 transaction polling every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'poll-sep24-transactions', async () => {
      await tracedJob('poll-sep24-transactions', () =>
        runTracked(pool, 'poll-sep24-transactions', pollSep24Transactions)
      );
    });
    if (!ran) logger.info('poll-sep24-transactions: skipped (another instance holds the lock)');
  });

  // Extend contract storage TTLs daily to prevent data loss
  cron.schedule('0 0 * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'extend-contract-storage-ttl', async () => {
      await tracedJob('extend-contract-storage-ttl', () =>
        runTracked(pool, 'extend-contract-storage-ttl', extendContractStorageTtl)
      );
    });
    if (!ran) logger.info('extend-contract-storage-ttl: skipped (another instance holds the lock)');
  });

  // Send KYC expiry warnings daily at 08:00 UTC
  cron.schedule('0 8 * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'notify-kyc-expiries', async () => {
      await tracedJob('notify-kyc-expiries', () =>
        runTracked(pool, 'notify-kyc-expiries', notifyKycExpiries)
      );
    });
    if (!ran) logger.info('notify-kyc-expiries: skipped (another instance holds the lock)');
  });

  // Run anchor health checks every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'check-anchor-health', async () => {
      await tracedJob('check-anchor-health', () =>
        runTracked(pool, 'check-anchor-health', checkAnchorHealth)
      );
    });
    if (!ran) logger.info('check-anchor-health: skipped (another instance holds the lock)');
  });

  // Retire expired webhook secrets hourly
  cron.schedule('0 * * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'retire-webhook-secrets', async () => {
      await tracedJob('retire-webhook-secrets', () =>
        runTracked(pool, 'retire-webhook-secrets', retireWebhookSecrets)
      );
    });
    if (!ran) console.log('retire-webhook-secrets: skipped (another instance holds the lock)');
  });

  // ── AML/CTF jobs (SR-112) ──────────────────────────────────────────────

  // Rescreen subjects whose periodic sanctions/PEP screening is due — hourly,
  // so a newly published list designation is picked up the same day.
  cron.schedule('15 * * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'aml-periodic-rescreening', async () => {
      await tracedJob('aml-periodic-rescreening', () =>
        runTracked(pool, 'aml-periodic-rescreening', runPeriodicRescreening)
      );
    });
    if (!ran) console.log('aml-periodic-rescreening: skipped (another instance holds the lock)');
  });

  // Retry pending / failed travel-rule transmissions every 10 minutes.
  cron.schedule('*/10 * * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'aml-travel-rule-transmit', async () => {
      await tracedJob('aml-travel-rule-transmit', () =>
        runTracked(pool, 'aml-travel-rule-transmit', transmitTravelRulePending)
      );
    });
    if (!ran) console.log('aml-travel-rule-transmit: skipped (another instance holds the lock)');
  });

  // Enforce the data-retention schedule nightly at 03:30 UTC.
  cron.schedule('30 3 * * *', async () => {
    const ran = await withAdvisoryLock(pool, 'aml-data-retention', async () => {
      await tracedJob('aml-data-retention', () =>
        runTracked(pool, 'aml-data-retention', enforceDataRetention)
      );
    });
    if (!ran) console.log('aml-data-retention: skipped (another instance holds the lock)');
  });

  console.log('Background jobs scheduled');
}

// ─── AML/CTF job bodies (SR-112) ────────────────────────────────────────────

async function runPeriodicRescreening() {
  const service = new SanctionsScreeningService(pool);
  const summary = await service.runPeriodicRescreening(
    parseInt(process.env.AML_RESCREEN_BATCH_SIZE || '200', 10),
  );
  console.log(
    `aml-periodic-rescreening: screened=${summary.screened} hits=${summary.hits} errors=${summary.errors}`,
  );
}

async function transmitTravelRulePending() {
  const service = new TravelRuleService(pool);
  const summary = await service.transmitPending(
    parseInt(process.env.TRAVEL_RULE_BATCH_SIZE || '100', 10),
  );
  console.log(
    `aml-travel-rule-transmit: transmitted=${summary.transmitted} failed=${summary.failed}`,
  );
}

async function enforceDataRetention() {
  const service = new RetentionService(pool);
  const results = await service.enforceAll();
  for (const result of results) {
    if (!result.succeeded) {
      console.error(`aml-data-retention: ${result.entity} FAILED — ${result.error}`);
    } else if (result.skippedReason) {
      console.log(`aml-data-retention: ${result.entity} skipped (${result.skippedReason})`);
    } else {
      console.log(
        `aml-data-retention: ${result.entity} ${result.action} ${result.rowsAffected} row(s) older than ${result.cutoff.toISOString()}`,
      );
    }
  }
}

async function revalidateStaleAssets() {
  try {
    const hoursOld = parseInt(process.env.VERIFICATION_INTERVAL_HOURS || '24');
    const staleAssets = await getStaleAssets(hoursOld);

    logger.info(`Found ${staleAssets.length} assets to revalidate`);

    for (const asset of staleAssets) {
      try {
        logger.info(`Revalidating ${asset.asset_code}-${asset.issuer}`);

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
          logger.error(`Failed to store on-chain for ${asset.asset_code}`, error as Error);
        }

        // Rate limiting - wait 1 second between verifications
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Failed to revalidate ${asset.asset_code}`, error as Error);
      }
    }

    logger.info('Periodic revalidation completed');
  } catch (error) {
    logger.error('Error in revalidation job', error as Error);
  }
}

async function pollKycStatuses() {
  try {
    await kycService.pollAllAnchors();
    logger.info('KYC polling completed');
  } catch (error) {
    logger.error('Error in KYC polling job', error as Error);
  }
}

async function pollSep24Transactions() {
  try {
    await sep24Service.pollAllTransactions();
    logger.info('SEP-24 polling completed');
  } catch (error) {
    logger.error('Error in SEP-24 polling job', error as Error);
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
    logger.warn('extend_storage_ttl: missing env vars (CONTRACT_ID, SOROBAN_RPC_URL, NETWORK_PASSPHRASE, ADMIN_SECRET_KEY). Skipping.');
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
    logger.info(`Contract storage TTLs extended by ${extendByLedgers} ledgers`);
  } catch (error) {
    logger.error('Failed to extend contract storage TTLs', error as Error);
  }
}

async function notifyKycExpiries() {
  try {
    const store = createWebhookStore(pool);
    const notifier = new KycExpiryNotifier(pool, store);
    await notifier.run();
  } catch (error) {
    logger.error('Error in KYC expiry notification job', error as Error);
  }
}

async function checkAnchorHealth() {
  try {
    const results = await anchorHealthChecker.checkAllAnchors();
    logger.info(`Anchor health check completed: ${results.length} anchors checked`);
    for (const result of results) {
      logger.info(`Anchor health result`, { anchor_id: result.anchor_id, status: result.status, response_time_ms: result.response_time_ms });
    }
  } catch (error) {
    logger.error('Error in anchor health check job', error as Error);
  }
}

async function retireWebhookSecrets() {
  try {
    const retiredIds = await retireExpiredWebhookSecrets();
    if (retiredIds.length === 0) return;

    logger.info(`Retired expired webhook secrets for ${retiredIds.length} subscribers`);
    const auditService = new AdminAuditLogService(pool);

    for (const id of retiredIds) {
      await auditService.log({
        admin_address: 'system',
        action: 'retire_webhook_secret',
        target: id,
        params_json: null,
        tx_hash: null,
        ip_address: '127.0.0.1',
      });

      // Notify subscriber via a signed webhook delivery (best-effort)
      const subscriber = await getWebhookSubscriberById(id);
      if (subscriber?.url && subscriber.secret) {
        try {
          const timestamp = Date.now().toString();
          const notificationBody = JSON.stringify({
            event: 'webhook.secret_retired',
            subscriber_id: id,
            retired_at: new Date().toISOString(),
          });
          const signature = crypto
            .createHmac('sha256', subscriber.secret)
            .update(`${timestamp}.${notificationBody}`)
            .digest('hex');

          await fetch(subscriber.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-event-type': 'webhook.secret_retired',
              'x-webhook-timestamp': timestamp,
              'x-webhook-signature': signature,
            },
            body: notificationBody,
          }).catch(() => {});
        } catch (e) {
          logger.warn('Failed to notify subscriber of secret retirement', { id, error: e });
        }
      }
    }
  } catch (error) {
    logger.error('Error in retire webhook secrets job', error as Error);
  }
}

// SR-027: DLQ retry / expiry / auto-disable
async function processDlq() {
  try {
    await dlqProcessor.run();
    console.log('DLQ processing completed');
  } catch (error) {
    console.error('Error in DLQ processing job:', error);
  }
}
