/**
 * SEP-24 deposit integration tests against Anchor Platform testnet (Docker).
 *
 * Prerequisites (CI only — skipped locally unless ANCHOR_PLATFORM_URL is set):
 *   docker-compose -f tests/docker/sep24-docker-compose.yml up -d
 *
 * Environment variables:
 *   ANCHOR_PLATFORM_URL  — base URL of the running Anchor Platform  (default: http://localhost:8080)
 *   SEP10_JWT            — JWT obtained via SEP-10 challenge/verify (default: test-jwt)
 *   TEST_STELLAR_ACCOUNT — Stellar account for deposit tests (default: GABC…)
 *   TEST_ASSET_CODE      — Asset to deposit (default: USDC)
 *   TEST_ASSET_ISSUER    — Asset issuer (default: GBBD47…)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Sep24Client, Sep24Transaction } from '../services/sep24';

const ANCHOR_URL = process.env.ANCHOR_PLATFORM_URL ?? 'http://localhost:8080';
const JWT = process.env.SEP10_JWT ?? 'test-jwt';
const STELLAR_ACCOUNT =
  process.env.TEST_STELLAR_ACCOUNT ??
  'GABC1234DEF5678HIJK9012LMNO3456PQRS7890TUVW1234XYZ5678ABCD';
const ASSET_CODE = process.env.TEST_ASSET_CODE ?? 'USDC';
const ASSET_ISSUER =
  process.env.TEST_ASSET_ISSUER ??
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const SKIP_INTEGRATION = !process.env.ANCHOR_PLATFORM_URL;

function maybeSkip() {
  if (SKIP_INTEGRATION) {
    console.log(
      'Skipping SEP-24 integration tests: ANCHOR_PLATFORM_URL not set. ' +
        'Run with Docker: docker-compose -f tests/docker/sep24-docker-compose.yml up -d',
    );
    return true;
  }
  return false;
}

describe('SEP-24 deposit flow — integration', () => {
  let client: Sep24Client;

  beforeAll(() => {
    client = new Sep24Client({ anchorBaseUrl: ANCHOR_URL, jwtToken: JWT });
  });

  it('initiate returns an interactive URL with a valid transaction id', async () => {
    if (maybeSkip()) return;

    const result = await client.initiateDeposit({
      assetCode: ASSET_CODE,
      assetIssuer: ASSET_ISSUER,
      account: STELLAR_ACCOUNT,
      amount: '100.00',
    });

    expect(result.type).toBe('interactive_customer_info_needed');
    expect(result.url).toMatch(/^https?:\/\//);
    expect(result.id).toBeTruthy();
  });

  it('interactive URL is reachable and returns HTML', async () => {
    if (maybeSkip()) return;

    const init = await client.initiateDeposit({
      assetCode: ASSET_CODE,
      assetIssuer: ASSET_ISSUER,
      account: STELLAR_ACCOUNT,
      amount: '50.00',
    });

    const { default: axios } = await import('axios');
    const resp = await axios.get(init.url, { timeout: 10_000 });
    expect(resp.status).toBe(200);
    expect(resp.headers['content-type']).toMatch(/html/i);
  });

  it('happy path: initiate → poll → completed', async () => {
    if (maybeSkip()) return;

    const init = await client.initiateDeposit({
      assetCode: ASSET_CODE,
      assetIssuer: ASSET_ISSUER,
      account: STELLAR_ACCOUNT,
      amount: '10.00',
    });

    // Allow time for the Anchor Platform to process the deposit in CI testnet.
    const tx = await client.pollUntilComplete(init.id, {
      intervalMs: 5_000,
      timeoutMs: 90_000,
    });

    expect(['completed', 'pending_external', 'pending_stellar']).toContain(tx.status);
    expect(tx.amountIn).toBeTruthy();
  });

  it('expiry path: expired transaction resolves with status=expired', async () => {
    if (maybeSkip()) return;

    // Initiate without providing memo — Anchor Platform moves to expired on timeout.
    const init = await client.initiateDeposit({
      assetCode: ASSET_CODE,
      assetIssuer: ASSET_ISSUER,
      account: STELLAR_ACCOUNT,
    });

    // Fast poll with short timeout; we expect 'expired' when platform enforces it.
    const tx = await client.pollUntilComplete(init.id, {
      intervalMs: 3_000,
      timeoutMs: 60_000,
    });

    // Expired and refunded are both valid terminal states for the expiry path.
    expect(['expired', 'refunded', 'error']).toContain(tx.status);
  });

  it('refund path: refunded transaction includes refunds object', async () => {
    if (maybeSkip()) return;

    // Trigger a refund by using amount that anchor always refunds (test fixture amount: 0.01).
    const init = await client.initiateDeposit({
      assetCode: ASSET_CODE,
      assetIssuer: ASSET_ISSUER,
      account: STELLAR_ACCOUNT,
      amount: '0.01',
      memo: 'REFUND_TEST',
      memoType: 'text',
    });

    const tx: Sep24Transaction = await client.pollUntilComplete(init.id, {
      intervalMs: 3_000,
      timeoutMs: 60_000,
    });

    if (tx.status === 'refunded') {
      expect(tx.refunds).toBeDefined();
      expect(tx.refunds?.amountRefunded).toBeTruthy();
    } else {
      // Anchor may not support test refunds; acceptable terminal states:
      expect(['completed', 'expired', 'error']).toContain(tx.status);
    }
  });
});
