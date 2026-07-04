"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StructuredLogger = void 0;
exports.getCorrelationId = getCorrelationId;
exports.setCorrelationId = setCorrelationId;
exports.correlationIdMiddleware = correlationIdMiddleware;
exports.createLogger = createLogger;
const async_hooks_1 = require("async_hooks");
const uuid_1 = require("uuid");
// AsyncLocalStorage to maintain correlation ID across async operations
const correlationStorage = new async_hooks_1.AsyncLocalStorage();
/**
 * Get the current correlation ID from AsyncLocalStorage
 */
function getCorrelationId() {
    return correlationStorage.getStore();
}
/**
 * Set correlation ID in AsyncLocalStorage
 */
function setCorrelationId(id) {
    correlationStorage.enterWith(id);
}
/**
 * Middleware to generate and propagate correlation ID
 */
function correlationIdMiddleware(req, res, next) {
    // Check if correlation ID is provided in request header
    const correlationId = req.headers['x-correlation-id'] || (0, uuid_1.v4)();
    // Set correlation ID in AsyncLocalStorage
    correlationStorage.run(correlationId, () => {
        // Add correlation ID to request object for easy access
        req.correlationId = correlationId;
        // Set correlation ID in response header
        res.setHeader('X-Correlation-ID', correlationId);
        // Continue to next middleware
        next();
    });
}
/**
 * Enhanced logger with correlation ID support
 */
class StructuredLogger {
    context;
    constructor(context) {
        this.context = context;
    }
    formatMessage(level, message, data) {
        const correlationId = getCorrelationId();
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            context: this.context,
            correlationId,
            message,
            ...(data && { data }),
        };
        return JSON.stringify(logEntry);
    }
    info(message, data) {
        console.log(this.formatMessage('INFO', message, data));
    }
    warn(message, data) {
        console.warn(this.formatMessage('WARN', message, data));
    }
    error(message, error, data) {
        const errorData = error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : error;
        console.error(this.formatMessage('ERROR', message, { ...data, error: errorData }));
    }
    debug(message, data) {
        if (process.env.NODE_ENV !== 'production') {
            console.debug(this.formatMessage('DEBUG', message, data));
        }
    }
}
exports.StructuredLogger = StructuredLogger;
/**
 * Create a logger instance for a specific context
 */
function createLogger(context) {
    return new StructuredLogger(context);
}
