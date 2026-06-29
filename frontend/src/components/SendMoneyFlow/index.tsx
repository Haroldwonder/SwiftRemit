import React, { useState } from 'react';

export type SendMoneyStep = 'amount' | 'recipient' | 'review' | 'success';

export interface SendMoneyFlowProps {
  availableBalance?: number;
  onComplete?: (txId: string) => void;
  onCancel?: () => void;
}

export function SendMoneyFlow({
  availableBalance = 0,
  onComplete,
  onCancel,
}: SendMoneyFlowProps) {
  const [step, setStep] = useState<SendMoneyStep>('amount');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [corridor, setCorridor] = useState('');

  const corridors = ['USD → KES', 'USD → NGN', 'USD → GHS', 'USD → ZAR'];

  const handleAmountNext = () => {
    if (parseFloat(amount) > 0 && parseFloat(amount) <= availableBalance) {
      setStep('recipient');
    }
  };

  const handleRecipientNext = () => {
    if (recipient.trim() && corridor) {
      setStep('review');
    }
  };

  const handleConfirm = () => {
    const txId = `TX-${Date.now()}`;
    setStep('success');
    onComplete?.(txId);
  };

  return (
    <div className="send-money-flow" data-testid="send-money-flow">
      <div className="step-indicator" aria-label="Progress steps">
        {(['amount', 'recipient', 'review', 'success'] as SendMoneyStep[]).map(
          (s, i) => (
            <span
              key={s}
              className={`step ${step === s ? 'active' : ''} ${
                ['amount', 'recipient', 'review', 'success'].indexOf(step) > i
                  ? 'completed'
                  : ''
              }`}
              aria-current={step === s ? 'step' : undefined}
            >
              {i + 1}
            </span>
          ),
        )}
      </div>

      {step === 'amount' && (
        <div className="step-amount" data-testid="step-amount">
          <h2>How much are you sending?</h2>
          <p className="balance">
            Available: <strong>${availableBalance.toFixed(2)} USDC</strong>
          </p>
          <label htmlFor="amount-input">Amount (USDC)</label>
          <input
            id="amount-input"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            data-testid="amount-input"
          />
          <div className="actions">
            <button onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={handleAmountNext}
              className="btn-primary"
              disabled={!amount || parseFloat(amount) <= 0}
              data-testid="amount-next"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'recipient' && (
        <div className="step-recipient" data-testid="step-recipient">
          <h2>Who are you sending to?</h2>
          <label htmlFor="recipient-input">Recipient Stellar Address</label>
          <input
            id="recipient-input"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="G..."
            data-testid="recipient-input"
          />
          <label htmlFor="corridor-select">Corridor</label>
          <select
            id="corridor-select"
            value={corridor}
            onChange={(e) => setCorridor(e.target.value)}
            data-testid="corridor-select"
          >
            <option value="">Select corridor</option>
            {corridors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="actions">
            <button onClick={() => setStep('amount')} className="btn-secondary">
              Back
            </button>
            <button
              onClick={handleRecipientNext}
              className="btn-primary"
              disabled={!recipient || !corridor}
              data-testid="recipient-next"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="step-review" data-testid="step-review">
          <h2>Review your transfer</h2>
          <dl className="summary">
            <dt>Amount</dt>
            <dd data-testid="review-amount">{amount} USDC</dd>
            <dt>Recipient</dt>
            <dd data-testid="review-recipient">{recipient}</dd>
            <dt>Corridor</dt>
            <dd data-testid="review-corridor">{corridor}</dd>
            <dt>Network Fee</dt>
            <dd>~2.5% platform fee</dd>
          </dl>
          <div className="actions">
            <button
              onClick={() => setStep('recipient')}
              className="btn-secondary"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              className="btn-primary btn-confirm"
              data-testid="confirm-btn"
            >
              Confirm &amp; Send
            </button>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="step-success" data-testid="step-success">
          <div className="success-icon" aria-hidden="true">
            ✓
          </div>
          <h2>Transfer Initiated!</h2>
          <p>
            Your transfer of <strong>{amount} USDC</strong> to{' '}
            <strong>{recipient}</strong> via <strong>{corridor}</strong> is
            being processed.
          </p>
          <button
            onClick={() => setStep('amount')}
            className="btn-primary"
            data-testid="send-another-btn"
          >
            Send Another
          </button>
        </div>
      )}
    </div>
  );
}
