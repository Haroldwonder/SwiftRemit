/**
 * k6 scenario: WebSocket connections
 *
 * Exercises the Socket.IO WebSocket endpoint on the API service.
 * Each VU opens a connection, subscribes to events for 30 seconds,
 * then disconnects.
 *
 * Thresholds (enforced — test fails if breached):
 *   ws_connect_duration p(95) < 200ms
 *   ws_errors           rate  < 0.05
 */

export const options = {
  thresholds: {
    ws_connect_duration: ['p(95)<200'],
    ws_errors: ['rate<0.05'],
    ws_connections_total: ['count>0'],
  },
};

import ws   from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

export const wsConnectDuration  = new Trend('ws_connect_duration', true);
export const wsMessageCount     = new Counter('ws_messages_received');
export const wsErrors           = new Rate('ws_errors');
export const wsConnectionsTotal = new Counter('ws_connections_total');

const SESSION_SECONDS = 30; // how long each VU holds its connection open

export default function webSocketLoad() {
  const apiUrl    = __ENV.API_URL || 'http://localhost:3000';
  const wsBaseUrl = apiUrl.replace(/^http/, 'ws');

  // Step 1: Socket.IO HTTP handshake to obtain the session ID (sid)
  const pollRes = http.get(
    `${apiUrl}/socket.io/?EIO=4&transport=polling`,
    { tags: { scenario: 'ws_handshake' } }
  );

  const handshakeOk = check(pollRes, {
    'Socket.IO handshake 200': (r) => r.status === 200,
  });

  if (!handshakeOk) {
    wsErrors.add(1);
    return;
  }

  // Parse the session id from the Socket.IO handshake payload
  // Payload looks like: 0{"sid":"...","upgrades":["websocket"],...}
  let sid = '';
  try {
    const body  = pollRes.body.toString();
    const match = body.match(/"sid":"([^"]+)"/);
    sid = match ? match[1] : '';
  } catch {
    wsErrors.add(1);
    return;
  }

  if (!sid) {
    wsErrors.add(1);
    return;
  }

  // Step 2: Upgrade to WebSocket
  const wsUrl = `${wsBaseUrl}/socket.io/?EIO=4&transport=websocket&sid=${sid}`;

  const startTs = Date.now();
  let connected = false;

  const response = ws.connect(wsUrl, {}, function (socket) {
    connected = true;
    wsConnectDuration.add(Date.now() - startTs);
    wsConnectionsTotal.add(1);

    socket.on('open', () => {
      // Send Socket.IO upgrade probe packet ("2probe")
      socket.send('2probe');
    });

    socket.on('message', (data) => {
      wsMessageCount.add(1);

      // Respond to Socket.IO ping (opcode "2") with pong ("3")
      if (data === '2') {
        socket.send('3');
      }
    });

    socket.on('error', () => {
      wsErrors.add(1);
    });

    // Hold the connection open for the session duration
    socket.setTimeout(() => {
      socket.close();
    }, SESSION_SECONDS * 1000);
  });

  check(response, {
    'WebSocket status 101': (r) => r && r.status === 101,
    'connection established': () => connected,
  });

  if (!connected) {
    wsErrors.add(1);
  }

  sleep(1);
}
