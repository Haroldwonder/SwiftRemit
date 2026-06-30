import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface DisputeItem {
  id: string | number;
  sender: string;
  agent: string;
  amount: string | number;
  created_at?: string | null;
  evidence_hash?: string | null;
}

interface AuditLogItem {
  remittance_id: string | number;
  resolved_at?: string | null;
  in_favour_of_sender: boolean;
  resolved_by?: string | null;
}

interface ConfirmState {
  id: string | number;
  inFavourOfSender: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDisputeItem(value: unknown): value is DisputeItem {
  return (
    isRecord(value) &&
    (typeof value.id === 'string' || typeof value.id === 'number') &&
    typeof value.sender === 'string' &&
    typeof value.agent === 'string' &&
    (typeof value.amount === 'string' || typeof value.amount === 'number') &&
    (value.created_at === undefined || value.created_at === null || typeof value.created_at === 'string') &&
    (value.evidence_hash === undefined || value.evidence_hash === null || typeof value.evidence_hash === 'string')
  );
}

function isAuditLogItem(value: unknown): value is AuditLogItem {
  return (
    isRecord(value) &&
    (typeof value.remittance_id === 'string' || typeof value.remittance_id === 'number') &&
    typeof value.in_favour_of_sender === 'boolean' &&
    (value.resolved_at === undefined || value.resolved_at === null || typeof value.resolved_at === 'string') &&
    (value.resolved_by === undefined || value.resolved_by === null || typeof value.resolved_by === 'string')
  );
}

function parseDisputesResponse(value: unknown): DisputeItem[] {
  if (!Array.isArray(value) || !value.every(isDisputeItem)) {
    throw new Error('Invalid disputes response');
  }

  return value;
}

function parseAuditLogResponse(value: unknown): AuditLogItem[] {
  if (!Array.isArray(value) || !value.every(isAuditLogItem)) {
    throw new Error('Invalid dispute audit response');
  }

  return value;
}

const PAGE_SIZE = 10;

export default function DisputeResolution() {
  const { t } = useTranslation();
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogItem[]>([]);
  const [resolving, setResolving] = useState<string | number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<ConfirmState | null>(null);
  const [resolvedTxHash, setResolvedTxHash] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    void fetchDisputes(1);
    void fetchAuditLog();
  }, []);

  async function fetchDisputes(pageNum: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/remittances?status=Disputed&page=${pageNum}&pageSize=${PAGE_SIZE}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      const items = parseDisputesResponse(data);
      setDisputes(items);
      setPage(pageNum);
      setHasMore(items.length === PAGE_SIZE);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAuditLog() {
    try {
      const res = await fetch(`${API_URL}/api/disputes/audit`);
      if (!res.ok) {
        return;
      }

      const data: unknown = await res.json();
      setAuditLog(parseAuditLogResponse(data));
    } catch {
      setAuditLog([]);
      // audit log is non-critical
    }
  }

  function openConfirm(id: string | number, inFavourOfSender: boolean) {
    setConfirmOpen({ id, inFavourOfSender });
  }

  async function confirmResolve() {
    if (!confirmOpen) {
      return;
    }

    const { id, inFavourOfSender } = confirmOpen;
    setConfirmOpen(null);
    setResolving(id);
    setError(null);
    setResolvedTxHash(null);
    try {
      const res = await fetch(`${API_URL}/api/disputes/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ in_favour_of_sender: inFavourOfSender }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      const txHash = typeof data.tx_hash === 'string' ? data.tx_hash : null;
      setResolvedTxHash(txHash);
      await fetchDisputes(page);
      await fetchAuditLog();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="panel" role="main" aria-label={t('dispute.title')}>
      <h2>{t('dispute.title')}</h2>

      {error && <div className="error" role="alert">{error}</div>}

      {resolvedTxHash && (
        <div role="status" style={{ background: '#f0fff4', border: '1px solid #9ae6b4', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.85rem' }}>
          ✅ {t('dispute.resolved')}{' '}
          <strong>{t('dispute.tx')}</strong>{' '}
          <a
            href={`https://stellar.expert/explorer/public/tx/${resolvedTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ wordBreak: 'break-all' }}
          >
            {resolvedTxHash}
          </a>
        </div>
      )}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', maxWidth: '400px', width: '90%' }}>
            <h3 id="confirm-title">{t('dispute.confirmTitle')}</h3>
            <p style={{ margin: '12px 0' }}>
              {t('dispute.confirmMessage', { id: confirmOpen.id, party: confirmOpen.inFavourOfSender ? t('dispute.sender') : t('dispute.agent') })}
              {' '}
              {confirmOpen.inFavourOfSender ? t('dispute.senderFunds') : t('dispute.agentFunds')}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmOpen(null)}>{t('dispute.cancel')}</button>
              <button className="btn-primary" onClick={confirmResolve}>{t('dispute.confirm')}</button>
            </div>
          </div>
        </div>
      )}

      <section aria-label={t('dispute.openDisputes')}>
        <h3>{t('dispute.openDisputes')}</h3>
        {loading ? (
          <p aria-live="polite">{t('dispute.loading')}</p>
        ) : disputes.length === 0 ? (
          <p>{t('dispute.noDisputes')}</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {disputes.map((d) => (
              <li
                key={d.id}
                style={{ border: '1px solid #fed7d7', borderRadius: '8px', padding: '16px', marginBottom: '12px', background: '#fff5f5' }}
                aria-label={`Dispute for remittance ${d.id}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <strong>{t('dispute.remittance', { id: d.id })}</strong>
                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
                      <span>{t('dispute.sender')} {d.sender}</span> · <span>{t('dispute.agent')} {d.agent}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      {t('dispute.amount')} {d.amount} USDC · {t('dispute.created')} {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                    </div>
                    {d.evidence_hash && (
                      <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                        {t('dispute.evidenceHash')} <code style={{ wordBreak: 'break-all' }}>{d.evidence_hash}</code>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => openConfirm(d.id, true)}
                      disabled={resolving === d.id}
                      aria-label={`Resolve #${d.id} in favour of sender`}
                      style={{ background: '#3182ce', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
                    >
                      {t('dispute.favourSender')}
                    </button>
                    <button
                      onClick={() => openConfirm(d.id, false)}
                      disabled={resolving === d.id}
                      aria-label={`Resolve #${d.id} in favour of agent`}
                      style={{ background: '#38a169', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
                    >
                      {t('dispute.favourAgent')}
                    </button>
                  </div>
                </div>
                {resolving === d.id && <p aria-live="polite" style={{ marginTop: '8px', fontSize: '0.85rem' }}>{t('dispute.resolving')}</p>}
              </li>
            ))}
          </ul>
        )}
        {!loading && (disputes.length > 0 || page > 1) && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' }}>
            <button onClick={() => void fetchDisputes(page - 1)} disabled={page <= 1} aria-label="Previous page">{t('dispute.prevPage')}</button>
            <span>{t('dispute.page', { page })}</span>
            <button onClick={() => void fetchDisputes(page + 1)} disabled={!hasMore} aria-label="Next page">{t('dispute.nextPage')}</button>
          </div>
        )}
      </section>

      <hr style={{ margin: '24px 0' }} />

      <section aria-label={t('dispute.auditTrail')}>
        <h3>{t('dispute.auditTrail')}</h3>
        {auditLog.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: '#666' }}>{t('dispute.noResolved')}</p>
        ) : (
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '6px' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '6px' }}>{t('dispute.resolvedAt')}</th>
                <th style={{ textAlign: 'left', padding: '6px' }}>{t('dispute.inFavourOf')}</th>
                <th style={{ textAlign: 'left', padding: '6px' }}>{t('dispute.resolvedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((entry) => (
                <tr
                  key={`${entry.remittance_id}-${entry.resolved_at ?? 'pending'}-${entry.resolved_by ?? 'unknown'}`}
                  style={{ borderBottom: '1px solid #e2e8f0' }}
                >
                  <td style={{ padding: '6px' }}>#{entry.remittance_id}</td>
                  <td style={{ padding: '6px' }}>{entry.resolved_at ? new Date(entry.resolved_at).toLocaleString() : '—'}</td>
                  <td style={{ padding: '6px' }}>{entry.in_favour_of_sender ? t('dispute.sender') : t('dispute.agent')}</td>
                  <td style={{ padding: '6px' }}>{entry.resolved_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
