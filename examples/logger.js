const pino = require('pino');

/**
 * SwiftRemit Structured Logger
 * 
 * Provides consistent logging fields: level, service, request_id.
 * Supports JSON output for better observability.
 */
const createLogger = (serviceName, requestId) => {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: {
      service: serviceName,
      request_id: requestId || process.env.REQUEST_ID || 'na'
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  });
};

module.exports = { createLogger };
