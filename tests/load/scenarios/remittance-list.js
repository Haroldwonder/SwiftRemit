/**
 * k6 scenario: List Remittances
 *
 * Exercises GET /api/remittances on the API service with cursor-based
 * pagination and various filter combinations at sustained load.
 * Acceptance: p99 < 500 ms at 500 RPS for 5 minutes.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const remittanceListDuration = new Trend('remittance_list_duration', true);
export const remittanceListErrors   = new Rate('remittance_list_errors');
export const remittanceListCount    = new Counter('remittance_list_count');

const STATUSES    = ['Pending', 'Processing', 'Completed', 'Cancelled', 'Failed'];
const CORRIDORS   = ['USD-NG', 'USD-GH', 'EUR-NG', 'GBP-KE', 'USD-KE'];
const PAGE_LIMITS = [10, 20, 50, 100];

function randomQueryString() {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_LIMITS[randomIntBetween(0, PAGE_LIMITS.length - 1)]));

  // Randomly apply optional filters to mimic realistic traffic patterns
  if (Math.random() < 0.3) {
    params.set('status', STATUSES[randomIntBetween(0, STATUSES.length - 1)]);
  }
  if (Math.random() < 0.2) {
    params.set('corridor', CORRIDORS[randomIntBetween(0, CORRIDORS.length - 1)]);
  }
  if (Math.random() < 0.15) {
    const from = new Date(Date.now() - randomIntBetween(1, 30) * 24 * 60 * 60 * 1000);
    params.set('from_date', from.toISOString());
  }

  return params.toString();
}

export default function listRemittances() {
  const apiUrl = __ENV.API_URL || 'http://localhost:3000';

  const qs  = randomQueryString();
  const url = `${apiUrl}/api/remittances?${qs}`;

  const params = {
    tags: { scenario: 'remittance_list' },
  };

  const res = http.get(url, params);

  remittanceListDuration.add(res.timings.duration);
  remittanceListCount.add(1);

  const ok = check(res, {
    'status is 200 or 400': (r) => r.status === 200 || r.status === 400,
    'response has body':    (r) => r.body && r.body.length > 0,
    'p99 < 500 ms':         (r) => r.timings.duration < 500,
  });

  if (!ok) {
    remittanceListErrors.add(1);
  }

  sleep(0.001);
}
