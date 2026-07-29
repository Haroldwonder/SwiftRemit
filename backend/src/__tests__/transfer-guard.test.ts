import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { createTransferGuard, AuthenticatedRequest } from '../transfer-guard';
import { KycUpsertService } from '../kyc-upsert-service';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReq(userId?: string): AuthenticatedRequest {
  return { user: userId ? { id: userId } : undefined } as AuthenticatedRequest;
}

function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json, _json: json, _status: status } as unknown as Response & {
    _status: typeof status;
    _json: typeof json;
  };
}

function makeNext() {
  return vi.fn();
}

function makeKyc(override?: Partial<Awaited<ReturnType<KycUpsertService['getStatusForUser']>>>) {
  return {
    overall_status: 'approved',
    can_transfer: true,
    reason: undefined,
    anchors: [],
    last_checked: new Date(),
    ...override,
  } as Awaited<ReturnType<KycUpsertService['getStatusForUser']>>;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('createTransferGuard', () => {
  let kycService: KycUpsertService;
  let guard: ReturnType<typeof createTransferGuard>;

  beforeEach(() => {
    kycService = { getStatusForUser: vi.fn() } as unknown as KycUpsertService;
    guard = createTransferGuard(kycService);
  });

  // ── Authentication ────────────────────────────────────────────────────────

  it('returns 401 when req.user is missing', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when req.user.id is empty string', async () => {
    const req = makeReq('');
    const res = makeRes();
    await guard(req, res, makeNext());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // ── Approved / can_transfer ───────────────────────────────────────────────

  it('calls next() for a fully approved user', async () => {
    vi.mocked(kycService.getStatusForUser).mockResolvedValue(makeKyc());
    const next = makeNext();
    await guard(makeReq('u1'), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  // ── Expiry ────────────────────────────────────────────────────────────────

  it('returns 403 KYC_EXPIRED when an approved anchor record is expired', async () => {
    const expiredDate = new Date(Date.now() - 1000); // in the past
    vi.mocked(kycService.getStatusForUser).mockResolvedValue(
      makeKyc({
        can_transfer: true,
        anchors: [
          { anchor_id: 'a1', kyc_status: 'approved', expires_at: expiredDate, verified_at: new Date() },
        ],
      }),
    );
    const res = makeRes();
    await guard(makeReq('u1'), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(403);
    const body = vi.mocked(res.status).mock.results[0].value.json.mock.calls[0][0];
    expect(body.error.code).toBe('KYC_EXPIRED');
  });

  it('returns 403 KYC_RE_VERIFICATION_PENDING when anchor in re-verification', async () => {
    vi.mocked(kycService.getStatusForUser).mockResolvedValue(
      makeKyc({
        can_transfer: true,
        anchors: [
          { anchor_id: 'a1', kyc_status: 're_verification_pending' as any, verified_at: new Date() },
        ],
      }),
    );
    const res = makeRes();
    await guard(makeReq('u1'), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(403);
    const body = vi.mocked(res.status).mock.results[0].value.json.mock.calls[0][0];
    expect(body.error.code).toBe('KYC_RE_VERIFICATION_PENDING');
  });

  it('allows transfer when approved anchor expiry is in the future', async () => {
    const futureDate = new Date(Date.now() + 86_400_000);
    vi.mocked(kycService.getStatusForUser).mockResolvedValue(
      makeKyc({
        can_transfer: true,
        anchors: [
          { anchor_id: 'a1', kyc_status: 'approved', expires_at: futureDate, verified_at: new Date() },
        ],
      }),
    );
    const next = makeNext();
    await guard(makeReq('u1'), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  // ── can_transfer = false reason codes ────────────────────────────────────

  const REASON_CASES: Array<[string, string]> = [
    ['kyc_expired',            'KYC_EXPIRED'],
    ['re_verification_pending','KYC_RE_VERIFICATION_PENDING'],
    ['kyc_pending',            'KYC_PENDING'],
    ['no_kyc_record',          'KYC_PENDING'],
    ['kyc_rejected',           'KYC_NOT_APPROVED'],
  ];

  for (const [reason, expectedCode] of REASON_CASES) {
    it(`returns 403 ${expectedCode} for reason="${reason}"`, async () => {
      vi.mocked(kycService.getStatusForUser).mockResolvedValue(
        makeKyc({ can_transfer: false, reason: reason as any }),
      );
      const res = makeRes();
      await guard(makeReq('u1'), res, makeNext());
      expect(res.status).toHaveBeenCalledWith(403);
      const body = vi.mocked(res.status).mock.results[0].value.json.mock.calls[0][0];
      expect(body.error.code).toBe(expectedCode);
    });
  }

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 when kycService throws', async () => {
    vi.mocked(kycService.getStatusForUser).mockRejectedValue(new Error('DB error'));
    const res = makeRes();
    await guard(makeReq('u1'), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
