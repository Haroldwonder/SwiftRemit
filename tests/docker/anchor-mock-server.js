/**
 * Anchor mock server for chaos testing (SR-061).
 * Serves:
 *   GET  /health          — liveness probe
 *   GET  /api/quote       — SEP-24 style quote response
 *   GET  /.well-known/stellar.toml — valid TOML with SIGNING_KEY + NETWORK_PASSPHRASE
 */
'use strict';

const http = require('http');
const url  = require('url');

const PORT = parseInt(process.env.PORT || '3003', 10);

const STELLAR_TOML = `
SIGNING_KEY="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
WEB_AUTH_ENDPOINT="https://anchor-mock.local/auth"

[[CURRENCIES]]
code="USDC"
issuer="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
`;

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === 'GET' && parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && parsed.pathname === '/.well-known/stellar.toml') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(STELLAR_TOML.trim());
    return;
  }

  if (req.method === 'GET' && parsed.pathname === '/api/quote') {
    const amount   = parseFloat(parsed.query.amount) || 100;
    const response = {
      fee:            amount * 0.025,
      estimated_time: '1-3 minutes',
      exchange_rate:  1620.5,
      expires_at:     new Date(Date.now() + 60_000).toISOString(),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[anchor-mock] listening on port ${PORT}`);
});
