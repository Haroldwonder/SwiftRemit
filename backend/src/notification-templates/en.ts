import { LocaleTemplates } from './types';

const en: LocaleTemplates = {
  remittance_created: {
    subject: 'Your remittance has been created',
    text: ({ remittanceId, amount, currency }) =>
      `Your remittance ${remittanceId} of ${amount} ${currency} has been created and is pending processing.`,
  },
  remittance_completed: {
    subject: 'Your remittance has been completed',
    text: ({ remittanceId, amount, currency }) =>
      `Your remittance ${remittanceId} of ${amount} ${currency} has been successfully completed.`,
  },
  remittance_failed: {
    subject: 'Your remittance has failed',
    text: ({ remittanceId, amount, currency }) =>
      `Your remittance ${remittanceId} of ${amount} ${currency} could not be completed. Funds will be refunded.`,
  },
  kyc_approved: {
    subject: 'Your identity verification has been approved',
    text: () => 'Your KYC verification has been approved. You can now send and receive remittances.',
  },
  kyc_expired: {
    subject: 'Your identity verification has expired',
    text: () =>
      'Your KYC verification has expired. Please re-verify your identity to continue using SwiftRemit.',
  },
};

export default en;
