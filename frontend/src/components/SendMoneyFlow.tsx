import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './SendMoneyFlow.css';
import { signTransaction } from '@stellar/freighter-api';
import * as StellarSdk from '@stellar/stellar-sdk';

type FlowStep = 1 | 2 | 3 | 4 | 5;

interface ConfirmPayload {
  amount: number;
  asset: string;
  recipient: string;
  memo?: string;
}

interface CorridorLimits {
  min: number;
  max: number;
  dailyLimit: number;
  dailyRemaining: number;
}

interface SendMoneyFlowProps {
  assets?: string[];
  onConfirm?: (payload: ConfirmPayload) => Promise<void>;
  senderPublicKey?: string;
  network?: 'TESTNET' | 'PUBLIC';
  /** ISO 3166-1 alpha-2 country code for the recipient corridor */
  recipientCountry?: string;
  /** Base URL for the API (defaults to /api) */
  apiBaseUrl?: string;
}

const STEP_SEQUENCE: FlowStep[] = [1, 2, 3, 4, 5];

const DEFAULT_ASSETS = ['XLM', 'USDC', 'EURC'];
const FX_TTL_MS = 30_000;

const HORIZON_URLS: Record<string, string> = {
  TESTNET: 'https://horizon-testnet.stellar.org',
  PUBLIC: 'https://horizon.stellar.org',
};

const STELLAR_EXPERT_BASE: Record<string, string> = {
  TESTNET: 'https://stellar.expert/explorer/testnet/tx',
  PUBLIC: 'https://stellar.expert/explorer/public/tx',
};

/** Threshold at which we show the "approaching limit" warning (90%) */
const APPROACHING_THRESHOLD = 0.9;

function isValidRecipient(input: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(input.trim());
}

async function buildAndSubmitTransaction(
  payload: ConfirmPayload,
  senderPublicKey: string,
  network: 'TESTNET' | 'PUBLIC'
): Promise<string> {
  const horizonUrl = HORIZON_URLS[network];
  const server = new StellarSdk.Horizon.Server(horizonUrl);
  const networkPassphrase =
    network === 'PUBLIC'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;

  const account = await server.loadAccount(senderPublicKey);

  let asset: StellarSdk.Asset;
  if (payload.asset === 'XLM') {
    asset = StellarSdk.Asset.native();
  } else {
    asset = new StellarSdk.Asset(payload.asset, senderPublicKey);
  }

  const txBuilder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: payload.recipient,
        asset,
        amount: String(payload.amount),
      })
    )
    .setTimeout(30);

  if (payload.memo) {
    txBuilder.addMemo(StellarSdk.Memo.text(payload.memo));
  }

  const tx = txBuilder.build();
  const xdr = tx.toXDR();

  const signResult = await signTransaction(xdr, { networkPassphrase });
  if ('error' in signResult && signResult.error) {
    throw new Error(signResult.error.message || 'User rejected the transaction');
  }

  const signedXdr = 'signedTxXdr' in signResult ? signResult.signedTxXdr : (signResult as any);
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const result = await server.submitTransaction(signedTx);
  return result.hash;
}

export const SendMoneyFlow: React.FC<SendMoneyFlowProps> = ({
  assets = DEFAULT_ASSETS,
  onConfirm,
  senderPublicKey = '',
  network = 'TESTNET',
  recipientCountry = '',
  apiBaseUrl = '/api',
}) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<FlowStep>(1);
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('');
  const [recipient, setRecipient] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Corridor limits state
  const [limits, setLimits] = useState<CorridorLimits | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsError, setLimitsError] = useState(false);

  const [fxRate, setFxRate] = useState<FxRate | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxCountdown, setFxCountdown] = useState(0);
  const fxTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const parsedAmount = useMemo(() => Number(amount), [amount]);

  const STEPS: Record<FlowStep, string> = {
    1: t('sendMoney.steps.1'),
    2: t('sendMoney.steps.2'),
    3: t('sendMoney.steps.3'),
    4: t('sendMoney.steps.4'),
    5: t('sendMoney.steps.5'),
  };

  // Fetch limits whenever asset or recipientCountry changes
  useEffect(() => {
    if (!asset) return;

    setLimitsLoading(true);
    setLimitsError(false);

    const params = new URLSearchParams({ asset });
    if (recipientCountry) params.set('country', recipientCountry);

    fetch(`${apiBaseUrl}/limits?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch limits');
        return res.json();
      })
      .then((data) => {
        if (data.success && data.data) {
          setLimits(data.data as CorridorLimits);
        }
      })
      .catch(() => setLimitsError(true))
      .finally(() => setLimitsLoading(false));
  }, [asset, recipientCountry, apiBaseUrl]);

  const isApproachingLimit =
    limits !== null &&
    parsedAmount > 0 &&
    parsedAmount >= limits.dailyRemaining * APPROACHING_THRESHOLD;

  const validateCurrentStep = (): string | null => {
    if (step === 1) {
      if (!amount) return t('sendMoney.errors.amountRequired');
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return t('sendMoney.errors.amountInvalid');
      }
    }

    if (step === 2 && !asset) {
      return t('sendMoney.errors.assetRequired');
    }

    if (step === 3 && !isValidRecipient(recipient)) {
      return t('sendMoney.errors.recipientInvalid');
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
      setError(t('sendMoney.errors.incomplete'));
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
        setIsComplete(true);
      } else if (senderPublicKey) {
        const hash = await buildAndSubmitTransaction(payload, senderPublicKey, network);
        setTxHash(hash);
        setIsComplete(true);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 700));
        setIsComplete(true);
      }
    } catch (confirmError) {
      const msg = confirmError instanceof Error ? confirmError.message : '';
      if (
        msg.toLowerCase().includes('rejected') ||
        msg.toLowerCase().includes('denied') ||
        msg.toLowerCase().includes('user rejected')
      ) {
        setError(t('sendMoney.errors.rejected'));
      } else if (msg.toLowerCase().includes('not installed')) {
        setError(t('sendMoney.errors.freighterNotInstalled'));
      } else {
        setError(t('sendMoney.errors.failed'));
      }
      console.error(confirmError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderLimitsInfo = () => {
    if (!asset) return null;
    if (limitsLoading) return <p className="flow-limits-loading">{t('sendMoney.limits.loading')}</p>;
    if (limitsError) return <p className="flow-limits-error">{t('sendMoney.limits.error')}</p>;
    if (!limits) return null;

    return (
      <div className="flow-limits" aria-live="polite">
        <span className="flow-limits-range">
          {t('sendMoney.limits.min', { value: limits.min, asset })}
          {' · '}
          {t('sendMoney.limits.max', { value: limits.max, asset })}
        </span>
        <span className="flow-limits-daily">
          {t('sendMoney.limits.dailyRemaining', { value: limits.dailyRemaining, asset })}
        </span>
        {isApproachingLimit && (
          <span className="flow-limits-warning" role="alert">
            {t('sendMoney.limits.approachingLimit')}
          </span>
        )}
      </div>
    );
  };

  const renderStepContent = () => {
    if (step === 1) {
      return (
        <>
          <label className="flow-field" htmlFor="amount">
            <span>{t('sendMoney.amount')}</span>
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
          {renderLimitsInfo()}
        </>
      );
    }

    if (step === 2) {
      return (
        <label className="flow-field" htmlFor="asset">
          <span>{t('sendMoney.asset')}</span>
          <select
            id="asset"
            value={asset}
            onChange={(event) => setAsset(event.target.value)}
          >
            <option value="">{t('sendMoney.chooseAsset')}</option>
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
            <span>{t('sendMoney.recipient')}</span>
            <input
              id="recipient"
              type="text"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="G..."
            />
          </label>
          <label className="flow-field" htmlFor="memo">
            <span>
              {t('sendMoney.memo')}{' '}
              <span className="flow-field-optional">{t('sendMoney.memoOptional')}</span>
            </span>
            <input
              id="memo"
              type="text"
              value={memo}
              onChange={(event) => setMemo(event.target.value.slice(0, 100))}
              placeholder={t('sendMoney.memoPlaceholder')}
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
            <dt>{t('sendMoney.review.amount')}</dt>
            <dd>{amount || '-'}</dd>
          </div>
          <div>
            <dt>{t('sendMoney.review.asset')}</dt>
            <dd>{asset || '-'}</dd>
          </div>
          <div>
            <dt>{t('sendMoney.review.recipient')}</dt>
            <dd>{recipient || '-'}</dd>
          </div>
          {memo.trim() && (
            <div>
              <dt>{t('sendMoney.review.memo')}</dt>
              <dd>{memo.trim()}</dd>
            </div>
          )}
        </>
      );
    }

    return null;
  };

  const stellarExpertUrl = txHash
    ? `${STELLAR_EXPERT_BASE[network]}/${txHash}`
    : null;

  return (
    <section className="send-flow-card" aria-label={t('sendMoney.title')}>
      <div className="send-flow-header">
        <h2>{t('sendMoney.title')}</h2>
        <p>{t('sendMoney.stepLabel', { step, name: STEPS[step] })}</p>
      </div>

      <ol className="send-step-indicator" aria-label="Progress">
        {STEP_SEQUENCE.map((stepKey) => (
          <li key={stepKey} className={stepKey <= step ? 'active' : ''}>
            {stepKey}
          </li>
        ))}
      </ol>

      {isComplete ? (
        <div className="flow-success" role="status">
          <p>{t('sendMoney.success')}</p>
          {txHash && (
            <>
              <p className="flow-tx-hash">
                {t('sendMoney.txHash')} <code>{txHash}</code>
              </p>
              {stellarExpertUrl && (
                <a
                  href={stellarExpertUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flow-expert-link"
                >
                  {t('sendMoney.viewOnExpert')}
                </a>
              )}
            </>
          )}
        </div>
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
              {t('sendMoney.back')}
            </button>

            {step < 5 ? (
              <button
                type="button"
                className="flow-button primary"
                onClick={nextStep}
                disabled={isSubmitting}
              >
                {t('sendMoney.continue')}
              </button>
            ) : (
              <button
                type="button"
                className="flow-button primary"
                onClick={confirmTransfer}
                disabled={isSubmitting}
              >
                {isSubmitting ? t('sendMoney.confirming') : t('sendMoney.confirm')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
