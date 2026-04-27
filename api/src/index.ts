import { createServer } from 'http';
import dotenv from 'dotenv';
import { createApp } from './app';
import { initializeCurrencyConfig } from './config';
import { initWebSocket } from './websocket';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Initialize and validate currency configuration (fail fast)
    console.log('Initializing currency configuration...');
    initializeCurrencyConfig();

    // Create a bare HTTP server first so Socket.IO can attach to it.
    // We pass a temporary no-op handler; the real Express app is set below.
    const httpServer = createServer();

    // Attach WebSocket server before the Express app is wired up.
    // Socket.IO only needs the raw http.Server — it intercepts the upgrade
    // event, not the request event.
    const io = initWebSocket(httpServer);

    // Build the Express app with the io instance so /ws/health is mounted.
    const app = createApp({ io });

    // Wire the Express app as the HTTP request handler.
    httpServer.on('request', app);

    httpServer.listen(PORT, () => {
      console.log(`✓ SwiftRemit API server running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Health check: http://localhost:${PORT}/health`);
      console.log(`✓ Currencies API: http://localhost:${PORT}/api/currencies`);
      console.log(`✓ WebSocket: ws://localhost:${PORT}`);
      if (process.env.NODE_ENV === 'development') {
        console.log(`✓ WS health: http://localhost:${PORT}/ws/health`);
      }
    });
  } catch (error) {
    console.error('✗ Failed to start server:', error);
    console.error('✗ Server startup aborted due to configuration error');
    process.exit(1); // Fail fast
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

start();
