export interface Currency {
  code: string;
  symbol: string;
  decimal_precision: number;
  name?: string;
}

export interface CurrencyConfig {
  currencies: Currency[];
}

export interface CurrencyResponse {
  success: boolean;
  data: Currency[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
  timestamp: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
  };
  timestamp: string;
}

const SENSITIVE_FIELDS = new Set([
  'secret_key', 'private_key', 'password', 'kyc_fields',
  'token', 'authorization', 'secret', 'api_key',
]);

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      [k, SENSITIVE_FIELDS.has(k) ? '[REDACTED]' : redact(v)]
    )
  );
}

export class StructuredLogger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      ...(data && { data: redact(data) }),
    };
    return JSON.stringify(logEntry);
  }

  info(message: string, data?: any): void {
    console.log(this.formatMessage('INFO', message, data));
  }

  warn(message: string, data?: any): void {
    console.warn(this.formatMessage('WARN', message, data));
  }

  error(message: string, error?: Error | any, data?: any): void {
    const errorData = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error;
    console.error(this.formatMessage('ERROR', message, { ...data, error: errorData }));
  }

  debug(message: string, data?: any): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage('DEBUG', message, data));
    }
  }
}

export function createLogger(context: string): StructuredLogger {
  return new StructuredLogger(context);
}
