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

// Re-export from shared logger so all api service code imports from one place.
export { StructuredLogger, createLogger, redact } from '../../shared/src/logger';
