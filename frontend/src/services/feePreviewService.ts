export interface FeeBreakdown {
  platformFeeBps: number;
  platformFeeAmount: number;
  protocolFeeAmount: number;
  integratorFeeAmount: number;
  corridorFeeAmount: number;
  totalFeeAmount: number;
  netAmount: number;
  token: string;
  corridor: string;
  quoteExpiresAt?: string;
  fxRate?: number;
}

const FEE_PREVIEW_API =
  (typeof window !== 'undefined' && (window as any).__SWIFTREMIT_API_URL__) || 'http://localhost:3001';
const QUOTE_TTL_MS = 30_000;

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}

function normalizeFeeBreakdown(raw: any, amount: number, corridor: string): FeeBreakdown {
  const platformFeeAmount = toNumber(raw.platformFeeAmount ?? raw.platform_fee ?? raw.platformFee);
  const protocolFeeAmount = toNumber(raw.protocolFeeAmount ?? raw.protocol_fee ?? raw.protocolFee);
  const integratorFeeAmount = toNumber(raw.integratorFeeAmount ?? raw.integrator_fee ?? raw.integratorFee);
  const corridorFeeAmount = toNumber(raw.corridorFeeAmount ?? raw.corridor_fee ?? raw.corridorFee);
  const totalFeeAmount = toNumber(raw.totalFeeAmount ?? raw.total_fee ?? raw.totalFee)
    || platformFeeAmount + protocolFeeAmount + integratorFeeAmount + corridorFeeAmount;

  return {
    platformFeeBps: toNumber(raw.platformFeeBps ?? raw.platform_fee_bps),
    platformFeeAmount,
    protocolFeeAmount,
    integratorFeeAmount,
    corridorFeeAmount,
    totalFeeAmount,
    netAmount: toNumber(raw.netAmount ?? raw.net_amount) || amount - totalFeeAmount,
    token: String(raw.token ?? 'USDC'),
    corridor: String(raw.corridor ?? corridor),
    quoteExpiresAt: String(raw.quoteExpiresAt ?? raw.quote_expires_at ?? new Date(Date.now() + QUOTE_TTL_MS).toISOString()),
    fxRate: raw.fxRate ?? raw.fx_rate,
  };
}

export async function getFeePreview(
  amount: number,
  corridor: string,
  token = 'USDC',
): Promise<FeeBreakdown> {
  if (!amount || amount <= 0) {
    throw new Error('Amount must be positive');
  }

  const [fromCountry, toCountry] = corridor.split(/[-/]/);
  const response = await fetch(`${FEE_PREVIEW_API}/api/contract/get-fee-breakdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'get_fee_breakdown',
      amount,
      corridor,
      token,
      fromCountry,
      toCountry,
    }),
  });

  if (!response.ok) {
    throw new Error(`Fee preview failed: ${response.statusText}`);
  }

  return normalizeFeeBreakdown(await response.json(), amount, corridor);
}

export interface FxQuoteUpdate {
  pair: string;
  rate: number;
  timestamp: string;
}

export function subscribeToFxQuotes(
  corridor: string,
  onQuote: (quote: FxQuoteUpdate) => void,
  onError?: (error: Event) => void,
): () => void {
  if (typeof WebSocket === 'undefined') return () => undefined;

  const wsBase = FEE_PREVIEW_API.replace(/^http/, 'ws');
  const socket = new WebSocket(`${wsBase}/ws/fx-rates`);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe', pairs: [corridor.replace('-', '/')] }));
  });
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data?.rate) onQuote(data);
  });
  if (onError) socket.addEventListener('error', onError);

  return () => socket.close();
}
