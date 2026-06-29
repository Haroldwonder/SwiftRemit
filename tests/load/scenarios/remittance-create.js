/**
 * k6 scenario: Create Remittance
 *
 * Exercises POST /api/remittance on the backend service at sustained load.
 * Acceptance: p99 < 500 ms at 500 RPS for 5 minutes.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { randomString, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Custom metrics
export const remittanceCreateDuration = new Trend('remittance_create_duration', true);
export const remittanceCreateErrors  = new Rate('remittance_create_errors');
export const remittanceCreateCount   = new Counter('remittance_create_count');

// Stellar testnet addresses used as realistic fixtures
const AGENT_ADDRESSES = [
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBWE4Q86HFOR',
  'GDRXE2BQUC3AZNPVFSCEZ76NJ3BJP335ZIPHENQ4QQVOA2FZY3LKIKR',
  'GB5OSGVMOFR6F5MZ7M3XMXQYARQHZBBNRXXVDEHHJAKME4RQCQWKIIG7',
];

function randomStellarAddress() {
  return AGENT_ADDRESSES[randomIntBetween(0, AGENT_ADDRESSES.length - 1)];
}

function randomAmount() {
  // Amounts in stroops (1 XLM = 10_000_000 stroops); range: $1–$1000 equivalent
  return String(randomIntBetween(10_000_000, 10_000_000_000));
}

export default function createRemittance() {
  const backendUrl = __ENV.BACKEND_URL || 'http://localhost:3001';
  const userId     = `load-test-user-${__VU}`;

  const payload = JSON.stringify({
    sender: randomStellarAddress(),
    agent:  randomStellarAddress(),
    amount: randomAmount(),
    memo:   `load-test-${randomString(8)}`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-user-id':    userId,
    },
    tags: { scenario: 'remittance_create' },
  };

  const res = http.post(`${backendUrl}/api/remittance`, payload, params);

  remittanceCreateDuration.add(res.timings.duration);
  remittanceCreateCount.add(1);

  const ok = check(res, {
    'status is 201': (r) => r.status === 201,
    'has remittance_id': (r) => {
      try {
        return JSON.parse(r.body).remittance?.remittance_id !== undefined;
      } catch {
        return false;
      }
    },
    'p99 < 500 ms': (r) => r.timings.duration < 500,
  });

  if (!ok) {
    remittanceCreateErrors.add(1);
  }

  sleep(0.001); // minimal sleep to prevent tight spin-loops
}
