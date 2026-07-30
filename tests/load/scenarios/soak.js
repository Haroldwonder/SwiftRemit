/**
 * k6 soak scenario — SR-105
 *
 * Sustained load at 60 % of peak RPS for 35 minutes.
 * Goal: surface memory leaks, connection-pool exhaustion, and slow cache
 * warm-up issues that only appear under prolonged steady-state load.
 *
 * Thresholds:
 *   p95 < 1 000 ms   — latency stays acceptable throughout
 *   error rate < 2 %  — minor blips tolerated but no sustained degradation
 *
 * Usage (standalone):
 *   k6 run tests/load/scenarios/soak.js \
 *     -e API_URL=https://api.staging.swiftremit.io \
 *     -e BACKEND_URL=https://backend.staging.swiftremit.io
 */

import http  from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { randomIntBetween, randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Custom metrics ────────────────────────────────────────────────────────────
export const soakDuration = new Trend('soak_duration', true);
export const soakErrors   = new Rate('soak_errors');
export const soakRequests = new Counter('soak_requests');

// ── Thresholds ─────────────────────────────────────────────────────────────────
export const options = {
  thresholds: {
    // p95 latency must stay under 1 000 ms for the entire 35-minute run
    soak_duration: ['p(95)<1000'],
    // Error rate must stay below 2 %
    soak_errors:   ['rate<0.02'],
  },
  scenarios: {
    soak: {
      executor:  'ramping-vus',
      exec:      'soakLoad',
      startVUs:  0,
      stages: [
        // Ramp up to ~60 % of 500 RPS target (≈300 VUs) over 3 minutes
        { duration: '3m',  target: 90  },
        // Sustain for 35 minutes (the soak window)
        { duration: '35m', target: 90  },
        // Cool down
        { duration: '2m',  target: 0   },
      ],
    },
  },
};

const AGENT_ADDRESSES = [
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBWE4Q86HFOR',
];

export default function soakLoad() {
  const backendUrl = __ENV.BACKEND_URL || 'http://localhost:3001';
  const apiUrl     = __ENV.API_URL     || 'http://localhost:3000';

  // Alternate between create and list to mix read/write traffic
  const useCreate = (__ITER % 2 === 0);

  let res;
  if (useCreate) {
    const payload = JSON.stringify({
      sender: AGENT_ADDRESSES[0],
      agent:  AGENT_ADDRESSES[1],
      amount: String(randomIntBetween(10_000_000, 1_000_000_000)),
      memo:   `soak-${randomString(6)}`,
    });
    res = http.post(`${backendUrl}/api/remittance`, payload, {
      headers: { 'Content-Type': 'application/json' },
      tags:    { scenario: 'soak_create' },
    });
  } else {
    res = http.get(`${apiUrl}/api/remittances?limit=20`, {
      tags: { scenario: 'soak_list' },
    });
  }

  soakDuration.add(res.timings.duration);
  soakRequests.add(1);

  const ok = check(res, {
    'status 2xx or 4xx': (r) => r.status >= 200 && r.status < 500,
    'p95 < 1000ms':      (r) => r.timings.duration < 1000,
  });

  if (!ok) soakErrors.add(1);

  sleep(0.1); // ~10 RPS per VU; 90 VUs ≈ 300 RPS (60 % of 500)
}
