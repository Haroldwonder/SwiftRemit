"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransferGuard = createTransferGuard;
function createTransferGuard(kycUpsertService) {
    return async (req, res, next) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const status = await kycUpsertService.getStatusForUser(userId);
            if (status.can_transfer) {
                return next();
            }
            let code = 'KYC_NOT_APPROVED';
            let message = 'KYC not approved';
            switch (status.reason) {
                case 'kyc_expired':
                    code = 'KYC_EXPIRED';
                    message = 'KYC has expired';
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
        }
        catch (error) {
            console.error('TransferGuard error', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    };
}
