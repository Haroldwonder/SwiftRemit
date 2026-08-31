/**
 * Pact provider verification — SwiftRemit API (SR-062)
 *
 * Verifies the real API against contracts from ALL three consumers:
 *   1. SwiftRemitFrontend   pacts/SwiftRemitFrontend-SwiftRemitAPI.json
 *   2. SwiftRemitSDK        pacts/SwiftRemitSDK-SwiftRemitAPI.json
 *   3. SwiftRemitMobile     pacts/SwiftRemitMobile-SwiftRemitAPI.json
 *
 * Any breaking API change will fail this job before it reaches main.
 *
 * Consumer tests:
 *   frontend/src/pact/swiftremit-api.consumer.pact.test.ts
 *   sdk/src/pact/swiftremit-api.sdk.consumer.pact.test.ts
 *   mobile/src/pact/swiftremit-api.mobile.consumer.pact.test.ts
 */

import { Verifier } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../app';
import { initializeCurrencyConfig } from '../../config';
import http from 'http';
import { newDb } from 'pg-mem';
import { PostgresAnchorStore } from '../../db/anchorStore';
import { DEFAULT_ANCHORS } from '../../data/defaultAnchors';

// ── Start the real API ────────────────────────────────────────────────────────

let server: http.Server;
let serverPort: number;

async function startProvider(): Promise<number> {
  process.env.CURRENCY_CONFIG_PATH = './config/currencies.json';
  process.env.JWT_SECRET = 'pact-provider-verification-secret-ci';
  process.env.ADMIN_API_KEY = 'pact-admin-key';
  process.env.ANCHOR_TOML_VALIDATION_DISABLED = 'true';

  initializeCurrencyConfig();

  // Build an in-memory anchor store and pre-seed it so anchor-related
  // pact states pass without a real database.
  const db = newDb();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  const anchorStore = new PostgresAnchorStore(pool);
  await anchorStore.initializeSchema();
  await anchorStore.seed(DEFAULT_ANCHORS);

  const app = createApp({
    anchorStore,
    anchorAdminApiKey: process.env.ADMIN_API_KEY,
  });

  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

// ── State handlers ────────────────────────────────────────────────────────────

const stateHandlers: Record<string, () => Promise<void>> = {
  // ── Shared ──────────────────────────────────────────────────────────────
  'currencies exist':              async () => { /* seeded via config file */ },
  'USD currency exists':           async () => { /* always in bundled config */ },
  'XYZ currency does not exist':   async () => { /* not in bundled config */ },
  'admin user exists':             async () => { /* JWT is stateless */ },
  'valid refresh token exists':    async () => { /* stateless; any cookie accepted in test */ },
  'no auth token provided':        async () => { /* nothing to set up */ },
  'mobile login missing walletAddress': async () => { /* validation is always active */ },
  'mobile user exists':            async () => { /* JWT is stateless */ },
  'mobile user authenticated':     async () => { /* JWT is stateless */ },

  // ── Anchors ──────────────────────────────────────────────────────────────
  'anchors exist':                        async () => { /* pre-seeded in beforeAll */ },
  'anchor anchor-1 exists':               async () => { /* pre-seeded */ },
  'anchor unknown-anchor does not exist': async () => { /* not in seed data */ },

  // ── Remittances ──────────────────────────────────────────────────────────
  'user has remittances':              async () => { /* route returns 200 for any token */ },
  'mobile user has remittances':       async () => { /* same */ },
  'mobile user has no remittances':    async () => { /* empty store */ },
  'remittance rem-001 exists':         async () => { /* test uses in-memory response */ },
  'remittance rem-unknown does not exist': async () => { /* returns 404 */ },

  // ── Agents ───────────────────────────────────────────────────────────────
  'agent exists':                      async () => { /* agent routes are DB-optional */ },

  // ── KYC ──────────────────────────────────────────────────────────────────
  'KYC record exists for user user-1 at anchor anchor-1': async () => { /* stub response */ },
  'KYC registration is open':          async () => { /* always open in test */ },

  // ── FX ───────────────────────────────────────────────────────────────────
  'FX rates are available':            async () => { /* in-memory stub */ },
  'FX rates exist but XYZ is unsupported': async () => { /* route validates pair */ },

  // ── Misc ─────────────────────────────────────────────────────────────────
  'service is running':          async () => { /* health endpoint needs no setup */ },
  'limits are configured':       async () => { /* limits route has default config */ },
  'settlements data exists':     async () => { /* read-only settlement stub */ },
  'Stellar account exists':      async () => { /* accounts route uses RPC stub */ },
};

// ── Pact source: broker when configured, local files otherwise ────────────────
//
// SR-216: when PACT_BROKER_BASE_URL is set (CI with a Pact Broker / PactFlow),
// pacts are pulled from the broker by consumer-version selector and the
// verification result is published back, keyed by the provider commit SHA. That
// is what the `can-i-deploy` gate in deploy-staging.yml / deploy-mainnet.yml
// queries. With no broker configured the job falls back to the local pact files
// downloaded from the consumer CI artifacts, preserving the pre-broker flow.

const PACT_DIR = path.resolve(__dirname, '../../../../../pacts');

const BROKER_URL = process.env.PACT_BROKER_BASE_URL;
const BROKER_TOKEN = process.env.PACT_BROKER_TOKEN;
const PROVIDER_VERSION =
  process.env.PACT_PROVIDER_VERSION || process.env.GITHUB_SHA || 'dev';
const PROVIDER_BRANCH =
  process.env.PACT_PROVIDER_BRANCH || process.env.GITHUB_REF_NAME || undefined;

function pactFile(consumer: string): string {
  return path.join(PACT_DIR, `${consumer}-SwiftRemitAPI.json`);
}

type VerifierOptions = ConstructorParameters<typeof Verifier>[0];

function verifierOptions(consumer: string, providerBaseUrl: string): VerifierOptions {
  const base = {
    provider: 'SwiftRemitAPI',
    providerBaseUrl,
    stateHandlers,
    logLevel: 'warn' as const,
  };

  if (BROKER_URL) {
    return {
      ...base,
      pactBrokerUrl: BROKER_URL,
      ...(BROKER_TOKEN ? { pactBrokerToken: BROKER_TOKEN } : {}),
      consumerVersionSelectors: [
        { consumer, mainBranch: true },
        { consumer, matchingBranch: true },
        { consumer, deployedOrReleased: true },
      ],
      providerVersion: PROVIDER_VERSION,
      ...(PROVIDER_BRANCH ? { providerVersionBranch: PROVIDER_BRANCH } : {}),
      publishVerificationResult: process.env.CI === 'true',
      failIfNoPactsFound: false,
    };
  }

  return {
    ...base,
    pactUrls: [pactFile(consumer)],
    failIfNoPactsFound: true,
    publishVerificationResult: false,
  };
}

// ── Verification ──────────────────────────────────────────────────────────────

describe('SwiftRemit API — Pact provider verification (all consumers)', () => {
  beforeAll(async () => {
    serverPort = await startProvider();
  });

  afterAll(() => {
    if (server) server.close();
  });

  // Verify the Frontend pact — original contract from issue #934.
  it('satisfies the SwiftRemitFrontend contract', async () => {
    const verifier = new Verifier(
      verifierOptions('SwiftRemitFrontend', `http://localhost:${serverPort}`),
    );
    await verifier.verifyProvider();
  });

  // Verify the SDK pact (SR-062).
  it('satisfies the SwiftRemitSDK contract', async () => {
    const verifier = new Verifier(
      verifierOptions('SwiftRemitSDK', `http://localhost:${serverPort}`),
    );
    await verifier.verifyProvider();
  });

  // Verify the Mobile pact (SR-062).
  it('satisfies the SwiftRemitMobile contract', async () => {
    const verifier = new Verifier(
      verifierOptions('SwiftRemitMobile', `http://localhost:${serverPort}`),
    );
    await verifier.verifyProvider();
  });
});
