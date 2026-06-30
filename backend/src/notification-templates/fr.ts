import { LocaleTemplates } from './types';

const fr: LocaleTemplates = {
  remittance_created: {
    subject: 'Votre virement a été créé',
    text: ({ remittanceId, amount, currency }) =>
      `Votre virement ${remittanceId} de ${amount} ${currency} a été créé et est en attente de traitement.`,
  },
  remittance_completed: {
    subject: 'Votre virement a été effectué',
    text: ({ remittanceId, amount, currency }) =>
      `Votre virement ${remittanceId} de ${amount} ${currency} a été effectué avec succès.`,
  },
  remittance_failed: {
    subject: 'Votre virement a échoué',
    text: ({ remittanceId, amount, currency }) =>
      `Votre virement ${remittanceId} de ${amount} ${currency} n'a pas pu être effectué. Les fonds seront remboursés.`,
  },
  kyc_approved: {
    subject: 'Votre vérification d\'identité a été approuvée',
    text: () =>
      'Votre vérification KYC a été approuvée. Vous pouvez maintenant envoyer et recevoir des virements.',
  },
  kyc_expired: {
    subject: 'Votre vérification d\'identité a expiré',
    text: () =>
      'Votre vérification KYC a expiré. Veuillez vérifier votre identité à nouveau pour continuer à utiliser SwiftRemit.',
  },
};

export default fr;
