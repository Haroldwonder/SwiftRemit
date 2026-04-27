import React, { useEffect, useMemo, useRef, useState } from 'react';
import './SendMoneyFlow.css';

type FlowStep = 1 | 2 | 3 | 4 | 5;

interface ConfirmPayload {
  amount: number;
  asset: string;
  recipient: string;
  memo?: string;
}

interface FxRate {
  rate: number;
  localCurrency: string;
  fetchedAt: number; // epoch ms
}

interface SendMoneyFlowProps {
  assets?: string[];
  onConfirm?: (payload: ConfirmPayload) => Promise<void>;
  apiUrl?: string;
}

const STEPS: Record<FlowStep, string> = {
  1: 'Enter amount',
  2: 'Select asset',
  3: 'Enter recipient',
  4: 'Review summary',
  5: 'Confirm transaction',
};
const STEP_SEQUENCE: FlowStep[] = [1, 2, 3, 4, 5];

const DEFAULT_ASSETS = ['XLM', 'USDC', 'EURC'];
const FX_TTL_MS = 30_000;

function isValidRecipient(input: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(input.trim());
}

export const SendMoneyFlow: React.FC<SendMoneyFlowProps> = ({
  assets = DEFAULT_ASSETS,
  onConfirm,
  apiUrl = 'http://localhost:3000',
}) => {
  const [step, setStep] = useState<FlowStep>(1);
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('');
  const [recipient, setRecipient] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const [fxRate, setFxRate] = useState<FxRate | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxCountdown, setFxCountdown] = useState(0);
  const fxTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const parsedAmount = useMemo(() => Number(amount), [amount]);

  const fetchFxRate = async () => {
    if (!asset) return;
    setFxLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/fx-rates?from=${asset}&to=USD`);
      const data = await res.json();
      const rate: number = data?.rate ?? data?.data?.rate ?? 1;
      const localCurrency: string = data?.to ?? data?.data?.to ?? 'USD';
      setFxRate({ rate, localCurrency, fetchedAt: Date.now() });
      setFxCountdown(Math.floor(FX_TTL_MS / 1000));
    } catch {
      // silently ignore FX errors — non-blocking
    } finally {
      setFxLoading(false);
    }
  };

  // Fetch FX rate when entering step 4; auto-refresh every TTL
  useEffect(() => {
    if (step !== 4) {
      if (fxTimerRef.current) clearInterval(fxTimerRef.current);
      return;
    }
    fetchFxRate();
    fxTimerRef.current = setInterval(fetchFxRate, FX_TTL_MS);
    return () => { if (fxTimerRef.current) clearInterval(fxTimerRef.current); };
  }, [step, asset]);

  // Countdown ticker
  useEffect(() => {
    if (step !== 4 || fxCountdown <= 0) return;
    const tick = setInterval(() => setFxCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, [step, fxCountdown]);

  const validateCurrentStep = (): string | null => {
    if (step === 1) {
      if (!amount) return 'Amount is required.';
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return 'Amount must be greater than zero.';
      }
    }

    if (step === 2 && !asset) {
      return 'Please select an asset.';
    }

    if (step === 3 && !isValidRecipient(recipient)) {
      return 'Recipient must be a valid Stellar public key.';
    }

    return null;
  };

  const nextStep = () => {
    const validation = validateCurrentStep();
    if (validation) {
      setError(validation);
      return;
    }

    setError(null);
    setStep((previous) => Math.min(previous + 1, 5) as FlowStep);
  };

  const previousStep = () => {
    setError(null);
    setStep((previous) => Math.max(previous - 1, 1) as FlowStep);
  };

  const confirmTransfer = async () => {
    if (!amount || !asset || !recipient) {
      setError('Transaction details are incomplete.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const payload: ConfirmPayload = {
        amount: parsedAmount,
        asset,
        recipient: recipient.trim(),
        ...(memo.trim() ? { memo: memo.trim() } : {}),
      };

      if (onConfirm) {
        await onConfirm(payload);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }

      setIsComplete(true);
    } catch (confirmError) {
      setError('Transaction failed. Please try again.');
      console.error(confirmError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStepContent = () => {
    if (step === 1) {
      return (
        <label className="flow-field" htmlFor="amount">
          <span>Amount</span>
          <input
            id="amount"
            type="number"
            min="0"
            step="0.000001"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </label>
      );
    }

    if (step === 2) {
      return (
        <label className="flow-field" htmlFor="asset">
          <span>Asset</span>
          <select
            id="asset"
            value={asset}
            onChange={(event) => setAsset(event.target.value)}
          >
            <option value="">Choose an asset</option>
            {assets.map((assetCode) => (
              <option key={assetCode} value={assetCode}>
                {assetCode}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (step === 3) {
      return (
        <>
          <label className="flow-field" htmlFor="recipient">
            <span>Recipient</span>
            <input
              id="recipient"
              type="text"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="G..."
            />
          </label>
          <label className="flow-field" htmlFor="memo">
            <span>Memo <span className="flow-field-optional">(optional)</span></span>
            <input
              id="memo"
              type="text"
              value={memo}
              onChange={(event) => setMemo(event.target.value.slice(0, 100))}
              placeholder="e.g. Invoice #1234"
              maxLength={100}
              aria-describedby="memo-count"
            />
            <span id="memo-count" className="flow-char-count" aria-live="polite">
              {memo.length}/100
            </span>
          </label>
        </>
      );
    }

    if (step === 4 || step === 5) {
      return (
        <>
          <dl className="flow-review">
            <div>
              <dt>Amount</dt>
              <dd>{amount || '-'}</dd>
            </div>
            <div>
              <dt>Asset</dt>
              <dd>{asset || '-'}</dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>{recipient || '-'}</dd>
            </div>
            {memo.trim() && (
              <div>
                <dt>Memo</dt>
                <dd>{memo.trim()}</dd>
              </div>
            )}
          </dl>
          {step === 4 && (
            <div className="flow-fx-preview" aria-live="polite">
              {fxLoading && <span className="flow-fx-loading">Fetching rate...</span>}
              {!fxLoading && fxRate && (
                <>
                  <span className="flow-fx-rate">
                    Recipient receives ~{(parsedAmount * fxRate.rate).toLocaleString(undefined, { maximumFractionDigits: 2 })} {fxRate.localCurrency} at rate {fxRate.rate}
                  </span>
                  <span className="flow-fx-timestamp">
                    Rate as of {new Date(fxRate.fetchedAt).toLocaleTimeString()} · valid for {fxCountdown}s
                  </span>
                </>
              )}
            </div>
          )}
        </>
      );
    }

    return null;
  };

  return (
    <section className="send-flow-card" aria-label="Send money flow">
      <div className="send-flow-header">
        <h2>Send Money</h2>
        <p>Step {step} of 5: {STEPS[step]}</p>
      </div>

      <ol className="send-step-indicator" aria-label="Progress">
        {STEP_SEQUENCE.map((stepKey) => (
          <li key={stepKey} className={stepKey <= step ? 'active' : ''}>
            {stepKey}
          </li>
        ))}
      </ol>

      {isComplete ? (
        <p className="flow-success" role="status">
          Transaction confirmed successfully.
        </p>
      ) : (
        <>
          <div className="send-flow-body">{renderStepContent()}</div>

          {error && <p className="flow-error">{error}</p>}

          <div className="send-flow-actions">
            <button
              type="button"
              className="flow-button muted"
              onClick={previousStep}
              disabled={step === 1 || isSubmitting}
            >
              Back
            </button>

            {step < 5 ? (
              <button
                type="button"
                className="flow-button primary"
                onClick={nextStep}
                disabled={isSubmitting}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="flow-button primary"
                onClick={confirmTransfer}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Confirming...' : 'Confirm transaction'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
