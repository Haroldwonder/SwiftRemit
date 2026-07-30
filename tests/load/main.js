/**
 * SwiftRemit k6 load test suite — combined entry point (SR-105)
 *
 * Runs five scenarios:
 *   • remittance-create  – POST /api/remittance (backend)
 *   • remittance-list    – GET  /api/remittances (api)
 *   • websocket          – Socket.IO real-time connections (api)
 *   • soak               – 35-min sustained load (surface memory leaks)
 *   • spike              – burst to 3× VUs, verify graceful degradation
 *
 * Target: 500 RPS sustained for 5 minutes with p95 < 600ms, error rate < 1%.
 *
 * Usage (standard 3-scenario run):
 *   k6 run tests/load/main.js \
 *     -e API_URL=https://api.staging.swiftremit.io \
 *     -e BACKEND_URL=https://backend.staging.swiftremit.io
 *
 * Usage (soak only):
 *   k6 run tests/load/main.js -e RUN_SOAK=true \
 *     -e API_URL=... -e BACKEND_URL=...
 *
 * Usage (spike only):
 *   k6 run tests/load/main.js -e RUN_SPIKE=true \
 *     -e API_URL=... -e BACKEND_URL=...
 *
 * Override VU counts via environment variables:
 *   CREATE_VUS     (default: 150)
 *   LIST_VUS       (default: 300)
 *   WS_VUS         (default: 50)
 */

import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary }  from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

import createRemittance from './scenarios/remittance-create.js';
import listRemittances  from './scenarios/remittance-list.js';
import webSocketLoad    from './scenarios/websocket.js';
import { default as soakLoad } from './scenarios/soak.js';
import { default as spikeLoad } from './scenarios/spike.js';

const CREATE_VUS = parseInt(__ENV.CREATE_VUS || '150');
const LIST_VUS   = parseInt(__ENV.LIST_VUS   || '300');
const WS_VUS     = parseInt(__ENV.WS_VUS     || '50');

const RUN_SOAK  = __ENV.RUN_SOAK  === 'true';
const RUN_SPIKE = __ENV.RUN_SPIKE === 'true';

// Ramp profile for the standard suite
const RAMP_UP_SECS   = 60;
const SUSTAIN_SECS   = 300;
const RAMP_DOWN_SECS = 60;

// Build the scenarios object dynamically based on what we're running
const scenarios = {};

if (!RUN_SOAK && !RUN_SPIKE) {
  // Standard 3-scenario performance run
  scenarios.remittance_create = {
    executor: 'ramping-vus',
    exec:     'createRemittance',
    startVUs: 0,
    stages: [
      { duration: `${RAMP_UP_SECS}s`,   target: CREATE_VUS },
      { duration: `${SUSTAIN_SECS}s`,   target: CREATE_VUS },
      { duration: `${RAMP_DOWN_SECS}s`, target: 0 },
    ],
  };
  scenarios.remittance_list = {
    executor: 'ramping-vus',
    exec:     'listRemittances',
    startVUs: 0,
    stages: [
      { duration: `${RAMP_UP_SECS}s`,   target: LIST_VUS },
      { duration: `${SUSTAIN_SECS}s`,   target: LIST_VUS },
      { duration: `${RAMP_DOWN_SECS}s`, target: 0 },
    ],
  };
  scenarios.websocket_connections = {
    executor: 'ramping-vus',
    exec:     'webSocketLoad',
    startVUs: 0,
    stages: [
      { duration: `${RAMP_UP_SECS}s`,   target: WS_VUS },
      { duration: `${SUSTAIN_SECS}s`,   target: WS_VUS },
      { duration: `${RAMP_DOWN_SECS}s`, target: 0 },
    ],
  };
}

if (RUN_SOAK) {
  scenarios.soak = {
    executor: 'ramping-vus',
    exec:     'soakLoad',
    startVUs: 0,
    stages: [
      { duration: '3m',  target: 90 },
      { duration: '35m', target: 90 },
      { duration: '2m',  target: 0  },
    ],
  };
}

if (RUN_SPIKE) {
  scenarios.spike = {
    executor: 'ramping-vus',
    exec:     'spikeLoad',
    startVUs: 0,
    stages: [
      { duration: '1m',  target: 50  },
      { duration: '1m',  target: 50  },
      { duration: '10s', target: 500 },
      { duration: '90s', target: 500 },
      { duration: '30s', target: 50  },
      { duration: '2m',  target: 50  },
      { duration: '30s', target: 0   },
    ],
  };
}

export const options = {
  scenarios,

  thresholds: {
    // ── Standard run thresholds ────────────────────────────────────────────
    // Global HTTP latency gate
    http_req_duration: ['p(95)<600', 'p(99)<800'],

    // Per-scenario latency
    remittance_create_duration: ['p(95)<600', 'p(99)<800'],
    remittance_list_duration:   ['p(95)<400', 'p(99)<700'],
    ws_connect_duration:        ['p(95)<200'],

    // Error rates
    remittance_create_errors: ['rate<0.01'],
    remittance_list_errors:   ['rate<0.01'],
    ws_errors:                ['rate<0.05'],

    // Throughput floor: at least 450 RPS across HTTP endpoints
    http_reqs: ['rate>450'],

    // ── Soak thresholds ────────────────────────────────────────────────────
    soak_duration: ['p(95)<1000'],
    soak_errors:   ['rate<0.02'],

    // ── Spike thresholds ───────────────────────────────────────────────────
    spike_duration: ['p(95)<2000'],
    spike_errors:   ['rate<0.05'],
  },
};

// Re-export scenario functions so k6 can call them by name
export { createRemittance, listRemittances, webSocketLoad, soakLoad, spikeLoad };

export function handleSummary(data) {
  return {
    'tests/load/results/report.html': htmlReport(data),
    'tests/load/results/summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'tests/load/results/summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
