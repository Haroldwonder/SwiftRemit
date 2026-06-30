export type SupportedLocale = 'en' | 'es' | 'fr' | 'pt';
export type TemplateKey =
  | 'remittance_created'
  | 'remittance_completed'
  | 'remittance_failed'
  | 'kyc_approved'
  | 'kyc_expired';

export interface TemplateParams {
  remittanceId?: string;
  amount?: number;
  currency?: string;
}

export interface MessageTemplate {
  subject: string;
  text: (params: TemplateParams) => string;
}

export type LocaleTemplates = Record<TemplateKey, MessageTemplate>;
