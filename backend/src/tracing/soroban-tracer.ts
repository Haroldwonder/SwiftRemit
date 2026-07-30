/**
 * backend/src/tracing/soroban-tracer.ts — SR-108
 *
 * Wraps Soroban RPC calls in OpenTelemetry client spans so every on-chain
 * interaction appears in distributed traces.
 *
 * Usage:
 *   import { tracedSorobanCall } from './tracing/soroban-tracer';
 *
 *   const result = await tracedSorobanCall(
 *     'simulateTransaction',
 *     () => rpcClient.simulateTransaction(tx),
 *     { contractFn: 'create_remittance', ledger: 100 }
 *   );
 */

import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';

const tracer = trace.getTracer('swiftremit-soroban', '1.0.0');

export interface SorobanCallAttributes {
  /** The contract function being invoked (e.g. 'create_remittance') */
  contractFn?: string;
  /** Current ledger sequence number */
  ledger?: number;
  /** Resource fee in stroops */
  resourceFee?: string;
  /** Contract ID being called */
  contractId?: string;
  /** Additional arbitrary attributes */
  [key: string]: string | number | boolean | undefined;
}

/**
 * Wraps a Soroban RPC call in an OpenTelemetry CLIENT span.
 *
 * @param spanName  Short name for the RPC method (e.g. 'simulateTransaction')
 * @param fn        Async function that performs the RPC call
 * @param attrs     Optional Soroban-specific span attributes
 * @returns         The result of fn()
 * @throws          Re-throws any error after recording it on the span
 */
export async function tracedSorobanCall<T>(
  spanName: string,
  fn: (span: Span) => Promise<T>,
  attrs: SorobanCallAttributes = {}
): Promise<T> {
  return tracer.startActiveSpan(
    `soroban.${spanName}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'rpc.system':          'soroban',
        'rpc.method':          spanName,
        'contract.function':   attrs.contractFn   ?? '',
        'contract.id':         attrs.contractId   ?? '',
        'ledger.sequence':     attrs.ledger        ?? 0,
        'soroban.resource_fee': attrs.resourceFee  ?? '',
        // Copy any additional attrs (skip undefined values)
        ...Object.fromEntries(
          Object.entries(attrs).filter(
            ([k, v]) => !['contractFn', 'contractId', 'ledger', 'resourceFee'].includes(k) &&
                        v !== undefined
          )
        ),
      },
    },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        throw err;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Convenience wrapper for Soroban read-only queries (simulateTransaction, getTransaction, etc.)
 */
export function tracedSorobanRead<T>(
  method: string,
  fn: (span: Span) => Promise<T>,
  attrs: SorobanCallAttributes = {}
): Promise<T> {
  return tracedSorobanCall(method, fn, { ...attrs, 'rpc.readonly': true });
}

/**
 * Convenience wrapper for Soroban write operations (sendTransaction)
 */
export function tracedSorobanWrite<T>(
  method: string,
  fn: (span: Span) => Promise<T>,
  attrs: SorobanCallAttributes = {}
): Promise<T> {
  return tracedSorobanCall(method, fn, { ...attrs, 'rpc.readonly': false });
}
