import { LocaleTemplates } from './types';

const es: LocaleTemplates = {
  remittance_created: {
    subject: 'Tu remesa ha sido creada',
    text: ({ remittanceId, amount, currency }) =>
      `Tu remesa ${remittanceId} de ${amount} ${currency} ha sido creada y está pendiente de procesamiento.`,
  },
  remittance_completed: {
    subject: 'Tu remesa ha sido completada',
    text: ({ remittanceId, amount, currency }) =>
      `Tu remesa ${remittanceId} de ${amount} ${currency} se ha completado exitosamente.`,
  },
  remittance_failed: {
    subject: 'Tu remesa ha fallado',
    text: ({ remittanceId, amount, currency }) =>
      `Tu remesa ${remittanceId} de ${amount} ${currency} no pudo completarse. Los fondos serán reembolsados.`,
  },
  kyc_approved: {
    subject: 'Tu verificación de identidad ha sido aprobada',
    text: () =>
      'Tu verificación KYC ha sido aprobada. Ya puedes enviar y recibir remesas.',
  },
  kyc_expired: {
    subject: 'Tu verificación de identidad ha expirado',
    text: () =>
      'Tu verificación KYC ha expirado. Por favor, verifica tu identidad nuevamente para continuar usando SwiftRemit.',
  },
};

export default es;
