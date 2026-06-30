/**
 * Pact provider verification for the SwiftRemit API.
 *
 * Verifies that the real API implementation satisfies the contracts generated
 * by the SwiftRemitFrontend consumer test suite.
 *
 * Consumer tests live at:  frontend/src/pact/swiftremit-api.consumer.pact.test.ts
 * Generated pact files at: pacts/SwiftRemitFrontend-SwiftRemitAPI.json
 *
 * Issue #934: Add API endpoint contract tests with Pact.
 */

import { Verifier } from '@pact-foundation/pact';
import path from 'path';
import { describe, it, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../app';
import { initializeCurrencyConfig } from '../../config';
import http from 'http';

// ── Start the real API on an ephemeral port ──────────────────────────────────

let server: http.Server;
let serverPort: number;

async function startProvider(): Promise<number> {
  process.env.CURRENCY_CONFIG_PATH = './config/currencies.json';
  process.env.JWT_SECRET = 'test-secret-for-pact-provider-verification';
  initializeCurrencyConfig();

  const app = createApp();
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(port);
    });
  });
}

// ── State handlers ────────────────────────────────────────────────────────────
// These set up the preconditions that each consumer interaction requires.
// In a real deployment these would seed a test database; here we rely on the
// API's in-memory / config-file state.

const stateHandlers: Record<string, () => Promise<void>> = {
  'currencies exist': async () => {
    // The currency config is loaded from file in beforeAll; no extra setup needed.
  },
  'USD currency exists': async () => {
    // USD is always in the bundled currencies config.
  },
  'XYZ currency does not exist': async () => {
    // The bundled config has no XYZ entry; nothing to set up.
  },
  'admin user exists': async () => {
    // Auth is stateless JWT — any userId is accepted when JWT_SECRET is set.
  },
  'anchors exist': async () => {
    // The in-memory anchor store is pre-seeded when createApp() is called.
  },
  'user has remittances': async () => {
    // The test uses a mock bearer token; the route either returns data or 200.
  },
  'no auth token provided': async () => {
    // No setup needed; the route checks for Authorization header absence.
  },
};

// ── Provider verification ─────────────────────────────────────────────────────

describe('SwiftRemit API — Pact provider verification', () => {
  beforeAll(async () => {
    serverPort = await startProvider();
  });

  afterAll(() => {
    if (server) server.close();
  });

  it('satisfies all contracts from SwiftRemitFrontend', async () => {
    const pactDir = path.resolve(__dirname, '../../../../../pacts');

    const verifier = new Verifier({
      provider: 'SwiftRemitAPI',
      providerBaseUrl: `http://localhost:${serverPort}`,
      pactUrls: [
        path.join(pactDir, 'SwiftRemitFrontend-SwiftRemitAPI.json'),
      ],
      stateHandlers,
      // Fail the CI job if the pact file is missing, which means the consumer
      // tests were not run first in the pipeline.
      failIfNoPactsFound: true,
      publishVerificationResult: false,
      logLevel: 'warn',
    });

    await verifier.verifyProvider();
  });
});
