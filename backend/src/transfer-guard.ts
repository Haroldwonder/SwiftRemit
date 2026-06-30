import { Request, Response, NextFunction } from 'express';
import { KycUpsertService } from './kyc-upsert-service';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
  };
}

export function createTransferGuard(kycUpsertService: KycUpsertService) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const status = await kycUpsertService.getStatusForUser(userId);

      if (status.can_transfer) {
        // Explicitly verify no approved record is expired (KycExpiry check)
        const now = new Date();
        const hasExpiredApproved = status.anchors.some(
          a => a.kyc_status === 'approved' && a.expires_at && a.expires_at <= now
        );
        if (hasExpiredApproved) {
          return res.status(403).json({ error: { code: 'KYC_EXPIRED', message: 'KYC has expired' } });
        }
        // Block users in re-verification regardless of other approved records
        const inReVerification = status.anchors.some(a => (a.kyc_status as string) === 're_verification_pending');
        if (inReVerification) {
          return res.status(403).json({ error: { code: 'KYC_RE_VERIFICATION_PENDING', message: 'KYC re-verification in progress' } });
        }
        return next();
      }

      let code = 'KYC_NOT_APPROVED';
      let message = 'KYC not approved';

      switch (status.reason) {
        case 'kyc_expired':
          code = 'KYC_EXPIRED';
          message = 'KYC has expired';
          break;
        case 're_verification_pending':
          code = 'KYC_RE_VERIFICATION_PENDING';
          message = 'KYC re-verification in progress';
          break;
        case 'kyc_pending':
        case 'no_kyc_record':
          code = 'KYC_PENDING';
          message = 'KYC pending';
          break;
        case 'kyc_rejected':
          code = 'KYC_NOT_APPROVED';
          message = 'KYC rejected';
          break;
      }

      return res.status(403).json({
        error: {
          code,
          message,
        },
      });
    } catch (error) {
      console.error('TransferGuard error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}
