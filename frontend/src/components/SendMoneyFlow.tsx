import React, { useEffect, useMemo, useState } from 'react';
import './SendMoneyFlow.css';
import type { DailyLimitStatus } from '../../../sdk/src/types.js';

type FlowStep = 1 | 2 | 3 | 4 | 5;

interface ConfirmPayload {
  amount: number;
  asset: string;
  recipient: string;
  memo?: string;
}

interface SendMoneyFlowProps {
  assets?: string[];
  onConfirm?: (payload: ConfirmPayload) => Promise<void>;
  /** Optional: fetch daily limit status for the sender/currency/country corridor */
  getDailyLimitStatus?: (currency: string, country: string) => Promise<DailyLimitStatus>;
  /** Sender address used for limit queries */
  senderAddress?: string;
  /** ISO 3166-1 alpha-2 destination country (e.g. "NG") */
  destinationCountry?: string;
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

function isValidRecipient(input: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(input.trim());
}

export const SendMoneyFlow: React.FC<SendMoneyFlowProps> = ({
  assets = DEFAULT_ASSETS,
  onConfirm,
  getDailyLimitStatus,
  senderAddress,
  destinationCountry = 'NG',
}) => {
  const [step, setStep] = useState<FlowStep>(1);
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('');
  const [recipient, setRecipient] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [limitStatus, setLimitStatus] = useState<DailyLimitStatus | null>(null);

  const parsedAmount = useMemo(() => Number(amount), [amount]);

  // Fetch daily limit status when asset is selected
  useEffect(() => {
    if (!asset || !getDailyLimitStatus || !senderAddress) return;
    let cancelled = false;
    getDailyLimitStatus(asset, destinationCountry)
      .then((status) => { if (!cancelled) setLimitStatus(status); })
      .catch(() => { /* non-critical — silently ignore */ });
    return () => { cancelled = true; };
  }, [asset, destinationCountry, getDailyLimitStatus, senderAddress]);

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
        <>
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
          {limitStatus && limitStatus.limit > 0n && (
            <p className="flow-limit-status" aria-live="polite">
              Daily limit: {(Number(limitStatus.remaining) / 1e7).toFixed(2)} {asset} remaining
              {' '}(resets {limitStatus.resetsAt.toLocaleTimeString()})
            </p>
          )}
        </>
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
