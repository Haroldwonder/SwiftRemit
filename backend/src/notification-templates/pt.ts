import { LocaleTemplates } from './types';

const pt: LocaleTemplates = {
  remittance_created: {
    subject: 'A sua remessa foi criada',
    text: ({ remittanceId, amount, currency }) =>
      `A sua remessa ${remittanceId} de ${amount} ${currency} foi criada e está pendente de processamento.`,
  },
  remittance_completed: {
    subject: 'A sua remessa foi concluída',
    text: ({ remittanceId, amount, currency }) =>
      `A sua remessa ${remittanceId} de ${amount} ${currency} foi concluída com sucesso.`,
  },
  remittance_failed: {
    subject: 'A sua remessa falhou',
    text: ({ remittanceId, amount, currency }) =>
      `A sua remessa ${remittanceId} de ${amount} ${currency} não pôde ser concluída. Os fundos serão reembolsados.`,
  },
  kyc_approved: {
    subject: 'A sua verificação de identidade foi aprovada',
    text: () =>
      'A sua verificação KYC foi aprovada. Já pode enviar e receber remessas.',
  },
  kyc_expired: {
    subject: 'A sua verificação de identidade expirou',
    text: () =>
      'A sua verificação KYC expirou. Por favor, verifique novamente a sua identidade para continuar a usar o SwiftRemit.',
  },
};

export default pt;
