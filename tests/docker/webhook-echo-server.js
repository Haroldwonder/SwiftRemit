// Minimal HTTP echo server used as the webhook target in chaos tests.
// Responds 200 to POST /webhook and 200 to GET /health.
import http from 'http';

const PORT = process.env.PORT ?? 3001;

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      console.log('[echo] received webhook:', body.slice(0, 200));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[echo] webhook echo server listening on :${PORT}`);
});
