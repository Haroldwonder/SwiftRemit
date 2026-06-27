import { getCorrelationId } from './correlation-id';

export const correlationFetch: typeof fetch = (input, init) => {
  const cid = getCorrelationId();
  if (!cid) return fetch(input, init);
  const headers = new Headers((init?.headers as HeadersInit | undefined) ?? {});
  headers.set('X-Correlation-ID', cid);
  return fetch(input, { ...init, headers });
};
