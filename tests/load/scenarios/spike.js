/**
 * k6 spike scenario — SR-105
 *
 * Verifies autoscaling and rate-limiting behave under burst traffic.
 * Pattern: baseline → sudden spike → recovery.
 *
 * Thresholds:
 *   error rate < 5 % during spike  — graceful degradation, not failure
 *   p95 < 2 000 ms                 — latency may climb but service stays up
 *
 * Usage (standalone):
 *   k6 run tests/load/scenarios/spike.js \
 *     -e API_URL=https://api.staging.swiftremit.io \
 *     -e BACKEND_URL=https://backend.staging.swiftremit.io
 */

import http  from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { randomIntBetween, randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Custom metrics ────────────────────────────────────────────────────────────
export const spikeDuration = new Trend('spike_duration', true);
export const spikeErrors   = new Rate('spike_errors');
export const spikeRequests = new Counter('spike_requests');

// ── Thresholds ─────────────────────────────────────────────────────────────────
export const options = {
  thresholds: {
    // During the burst the service may slow, but p95 must stay under 2 s
    spike_duration: ['p(95)<2000'],
    // < 5 % errors — rate limiting returning 429 is acceptable (counted as ok below)
    spike_errors:   ['rate<0.05'],
  },
  scenarios: {
    spike: {
      executor:  'ramping-vus',
      exec:      'spikeLoad',
      startVUs:  0,
      stages: [
        // 2 min baseline at 50 VUs
        { duration: '1m',    target: 50  },
        { duration: '1m',    target: 50  },
        // 10-second ramp to 500 VUs (the spike)
        { duration: '10s',   target: 500 },
        // Hold spike for 90 seconds
        { duration: '90s',   target: 500 },
        // Drop back to baseline over 30 seconds
        { duration: '30s',   target: 50  },
        // Confirm recovery: 2 min back at baseline
        { duration: '2m',    target: 50  },
        { duration: '30s',   target: 0   },
      ],
    },
  },
};

const AGENT_ADDRESSES = [
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBWE4Q86HFOR',
];

export default function spikeLoad() {
  const backendUrl = __ENV.BACKEND_URL || 'http://localhost:3001';
  const apiUrl     = __ENV.API_URL     || 'http://localhost:3000';

  const useCreate = (__ITER % 3 !== 0); // 2/3 writes, 1/3 reads during spike

  let res;
  if (useCreate) {
    const payload = JSON.stringify({
      sender: AGENT_ADDRESSES[0],
      agent:  AGENT_ADDRESSES[1],
      amount: String(randomIntBetween(10_000_000, 500_000_000)),
      memo:   `spike-${randomString(6)}`,
    });
    res = http.post(`${backendUrl}/api/remittance`, payload, {
      headers: { 'Content-Type': 'application/json' },
      tags:    { scenario: 'spike_create' },
    });
  } else {
    res = http.get(`${apiUrl}/api/remittances?limit=10`, {
      tags: { scenario: 'spike_list' },
    });
  }

  spikeDuration.add(res.timings.duration);
  spikeRequests.add(1);

  // 429 (rate-limited) is ACCEPTABLE during spike — it means the system is
  // degrading gracefully rather than crashing. Only 5xx counts as an error.
  const ok = check(res, {
    'not a 5xx':    (r) => r.status < 500,
    'p95 < 2000ms': (r) => r.timings.duration < 2000,
  });

  if (!ok) spikeErrors.add(1);

  sleep(0.05); // minimal think-time to maximise spike pressure
}
