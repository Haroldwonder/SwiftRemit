import axios, { AxiosError } from 'axios';

export interface WebhookPayload {
  event: string;
  txId: string;
  status: string;
  amount: number;
  currency: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookDeliveryResult {
  txId: string;
  success: boolean;
  attempts: number;
  lastError?: string;
  dlq: boolean;
}

export interface WebhookConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

export interface DLQEntry {
  payload: WebhookPayload;
  endpoint: string;
  attempts: number;
  lastError: string;
  enqueuedAt: string;
}

// In-memory DLQ for testing; replace with persistent queue in production.
const deadLetterQueue: DLQEntry[] = [];

export function getDLQ(): DLQEntry[] {
  return [...deadLetterQueue];
}

export function clearDLQ(): void {
  deadLetterQueue.length = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  return Math.min(exponential, maxDelayMs);
}

export async function deliverWebhook(
  endpoint: string,
  payload: WebhookPayload,
  config: WebhookConfig = {},
): Promise<WebhookDeliveryResult> {
  const {
    maxRetries = 5,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    timeoutMs = 10_000,
  } = config;

  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await axios.post(endpoint, payload, {
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'X-SwiftRemit-Event': payload.event,
          'X-SwiftRemit-TxId': payload.txId,
        },
      });

      return {
        txId: payload.txId,
        success: true,
        attempts: attempt + 1,
        dlq: false,
      };
    } catch (err) {
      const axErr = err as AxiosError;
      lastError = axErr.message ?? String(err);

      const isRetryable =
        !axErr.response ||
        axErr.response.status >= 500 ||
        axErr.code === 'ECONNRESET' ||
        axErr.code === 'ETIMEDOUT' ||
        axErr.code === 'ECONNABORTED';

      if (!isRetryable || attempt === maxRetries) {
        break;
      }

      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
      await sleep(delay);
    }
  }

  // All attempts exhausted — push to DLQ.
  deadLetterQueue.push({
    payload,
    endpoint,
    attempts: maxRetries + 1,
    lastError,
    enqueuedAt: new Date().toISOString(),
  });

  return {
    txId: payload.txId,
    success: false,
    attempts: maxRetries + 1,
    lastError,
    dlq: true,
  };
}
