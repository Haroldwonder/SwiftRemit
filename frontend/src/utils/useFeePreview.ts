import { useState, useEffect } from 'react';
import { getFeePreview, type FeeBreakdown } from '../services/feePreviewService';

interface UseFeePreviewOptions {
  debounceMs?: number;
  onError?: (error: Error) => void;
}

export function useFeePreview(
  amount: number,
  corridor: string,
  options: UseFeePreviewOptions = {}
) {
  const { debounceMs = 500, onError } = options;
  const [feeData, setFeeData] = useState<FeeBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!amount || !corridor) {
      setFeeData(null);
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await getFeePreview(amount, corridor);
        setFeeData(data);
        setError(null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onError?.(error);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [amount, corridor, debounceMs, onError]);

  return { feeData, loading, error };
}
