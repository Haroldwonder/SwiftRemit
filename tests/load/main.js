/**
 * SwiftRemit k6 load test suite — combined entry point
 *
 * Runs three scenarios in parallel:
 *   • remittance-create  – POST /api/remittance (backend)
 *   • remittance-list    – GET  /api/remittances (api)
 *   • websocket          – Socket.IO real-time connections (api)
 *
 * Target: 500 RPS sustained for 5 minutes with p99 < 500 ms.
 *
 * Usage:
 *   k6 run tests/load/main.js \
 *     -e API_URL=https://api.staging.swiftremit.io \
 *     -e BACKEND_URL=https://backend.staging.swiftremit.io
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

const CREATE_VUS = parseInt(__ENV.CREATE_VUS || '150');
const LIST_VUS   = parseInt(__ENV.LIST_VUS   || '300');
const WS_VUS     = parseInt(__ENV.WS_VUS     || '50');

// Ramp profile: 1 min warm-up → 5 min sustained → 1 min cool-down
const RAMP_UP_SECS   = 60;
const SUSTAIN_SECS   = 300;
const RAMP_DOWN_SECS = 60;

export const options = {
  scenarios: {
    remittance_create: {
      executor:          'ramping-vus',
      exec:              'createRemittance',
      startVUs:          0,
      stages: [
        { duration: `${RAMP_UP_SECS}s`,   target: CREATE_VUS },
        { duration: `${SUSTAIN_SECS}s`,   target: CREATE_VUS },
        { duration: `${RAMP_DOWN_SECS}s`, target: 0 },
      ],
    },
    remittance_list: {
      executor:          'ramping-vus',
      exec:              'listRemittances',
      startVUs:          0,
      stages: [
        { duration: `${RAMP_UP_SECS}s`,   target: LIST_VUS },
        { duration: `${SUSTAIN_SECS}s`,   target: LIST_VUS },
        { duration: `${RAMP_DOWN_SECS}s`, target: 0 },
      ],
    },
    websocket_connections: {
      executor:          'ramping-vus',
      exec:              'webSocketLoad',
      startVUs:          0,
      stages: [
        { duration: `${RAMP_UP_SECS}s`,   target: WS_VUS },
        { duration: `${SUSTAIN_SECS}s`,   target: WS_VUS },
        { duration: `${RAMP_DOWN_SECS}s`, target: 0 },
      ],
    },
  },

  thresholds: {
    // Overall latency gate: p99 across all HTTP requests < 500 ms
    http_req_duration: ['p(99)<500'],

    // Per-scenario latency tracking
    remittance_create_duration: ['p(99)<500'],
    remittance_list_duration:   ['p(99)<500'],
    ws_connect_duration:        ['p(95)<200'],

    // Error rate gates
    remittance_create_errors: ['rate<0.01'],   // < 1 % errors
    remittance_list_errors:   ['rate<0.01'],
    ws_errors:                ['rate<0.05'],   // < 5 % WebSocket errors (handshake + upgrade)

    // Minimum throughput gate: at least 450 RPS on HTTP endpoints
    http_reqs: [`rate>450`],
  },
};

// Re-export scenario functions so k6 can call them by name
export { createRemittance, listRemittances, webSocketLoad };

export function handleSummary(data) {
  return {
    'tests/load/results/report.html': htmlReport(data),
    'tests/load/results/summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
