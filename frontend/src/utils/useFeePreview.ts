import { useState, useEffect } from 'react';
import { getFeePreview, subscribeToFxQuotes, type FeeBreakdown } from '../services/feePreviewService';

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
  const [secondsUntilExpiry, setSecondsUntilExpiry] = useState<number | null>(null);
  const [requiresRequote, setRequiresRequote] = useState(false);

  useEffect(() => {
    if (!amount || !corridor) {
      setFeeData(null);
      setError(null);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await getFeePreview(amount, corridor);
        setFeeData(data);
        setRequiresRequote(false);
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

  useEffect(() => {
    if (!feeData?.quoteExpiresAt) {
      setSecondsUntilExpiry(null);
      return;
    }

    const quoteExpiresAt = feeData.quoteExpiresAt;
    const updateExpiry = () => {
      const seconds = Math.max(0, Math.ceil((new Date(quoteExpiresAt).getTime() - Date.now()) / 1000));
      setSecondsUntilExpiry(seconds);
      if (seconds === 0) setRequiresRequote(true);
    };

    updateExpiry();
    const interval = setInterval(updateExpiry, 1000);
    return () => clearInterval(interval);
  }, [feeData?.quoteExpiresAt]);

  useEffect(() => {
    if (!amount || !corridor) return;
    const unsubscribe = subscribeToFxQuotes(corridor, (quote) => {
      if (feeData?.fxRate && Math.abs(quote.rate - feeData.fxRate) / feeData.fxRate > 0.005) {
        setRequiresRequote(true);
      } else {
        void getFeePreview(amount, corridor).then(setFeeData).catch((err) => {
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          onError?.(error);
        });
      }
    });
    return unsubscribe;
  }, [amount, corridor, feeData?.fxRate, onError]);

  const refreshQuote = async () => {
    setLoading(true);
    try {
      const data = await getFeePreview(amount, corridor);
      setFeeData(data);
      setRequiresRequote(false);
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  return { feeData, loading, error, secondsUntilExpiry, requiresRequote, refreshQuote };
}
