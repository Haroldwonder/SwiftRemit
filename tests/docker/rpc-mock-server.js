/**
 * Soroban RPC mock server for chaos testing (SR-061).
 * Responds to JSON-RPC POST /rpc with a deterministic success result.
 * GET /health returns 200.
 */
'use strict';

const http = require('http');

const PORT = parseInt(process.env.PORT || '3002', 10);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/rpc') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }

      const response = {
        jsonrpc: '2.0',
        id: parsed.id ?? 1,
        result: {
          status: 'SUCCESS',
          txHash: `mock-tx-${Date.now()}`,
          latestLedger: 1000000,
        },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[rpc-mock] listening on port ${PORT}`);
});
