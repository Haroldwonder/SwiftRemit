export interface FeeBreakdown {
  platformFeeBps: number;
  platformFeeAmount: number;
  protocolFeeAmount: number;
  netAmount: number;
}

const FEE_PREVIEW_API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export async function getFeePreview(
  amount: number,
  corridor: string,
): Promise<FeeBreakdown> {
  if (!amount || amount <= 0) {
    throw new Error('Amount must be positive');
  }

  const response = await fetch(`${FEE_PREVIEW_API}/api/fee-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, corridor }),
  });

  if (!response.ok) {
    throw new Error(`Fee preview failed: ${response.statusText}`);
  }

  return response.json();
}
