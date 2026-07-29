/**
 * Localised notification templates for SEP-24 transaction lifecycle events.
 *
 * Templates are keyed by locale (BCP-47 tag) then event type.
 * The `render` helper does simple {{variable}} substitution — no dependency on
 * a full templating engine keeps this module lightweight and testable.
 */

export type NotificationEventType =
  | 'sep24.initiated'
  | 'sep24.completed'
  | 'sep24.expired'
  | 'sep24.refund_requested'
  | 'sep24.refunded'
  | 'sep24.refund_failed'
  | 'sep24.partial_deposit'
  | 'sep24.manual_review';

export interface NotificationTemplate {
  subject: string;
  body: string;
}

export interface NotificationPayload {
  event: NotificationEventType;
  locale?: string;           // defaults to 'en'
  variables: Record<string, string>;
}

export interface RenderedNotification {
  subject: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

type TemplateMap = Record<NotificationEventType, NotificationTemplate>;

const TEMPLATES: Record<string, TemplateMap> = {
  en: {
    'sep24.initiated': {
      subject: 'Your {{direction}} of {{amount}} {{asset_code}} has started',
      body:
        'Hello,\n\nYour {{direction}} of {{amount}} {{asset_code}} (transaction {{transaction_id}}) ' +
        'has been initiated with {{anchor_id}}.\n\n' +
        'Follow this link to complete the flow: {{interactive_url}}\n\n' +
        'This link expires in 30 minutes.\n\nThank you for using SwiftRemit.',
    },
    'sep24.completed': {
      subject: 'Your {{direction}} of {{amount}} {{asset_code}} is complete',
      body:
        'Hello,\n\nYour {{direction}} of {{amount}} {{asset_code}} (transaction {{transaction_id}}) ' +
        'has been successfully completed.\n\n' +
        'Amount received: {{amount_out}} {{asset_code}}\n' +
        'Fee: {{amount_fee}} {{asset_code}}\n\n' +
        'Thank you for using SwiftRemit.',
    },
    'sep24.expired': {
      subject: 'Your {{direction}} of {{amount}} {{asset_code}} has expired',
      body:
        'Hello,\n\nYour {{direction}} of {{amount}} {{asset_code}} (transaction {{transaction_id}}) ' +
        'expired before it could be completed.\n\n' +
        'If funds were received, a refund will be processed automatically.\n\n' +
        'Please contact support if you have any questions.',
    },
    'sep24.refund_requested': {
      subject: 'Refund requested for transaction {{transaction_id}}',
      body:
        'Hello,\n\nA refund has been requested for your transaction {{transaction_id}} ' +
        '({{amount}} {{asset_code}}).\n\n' +
        'We are processing the refund with {{anchor_id}}. You will receive a ' +
        'confirmation once the refund is complete.',
    },
    'sep24.refunded': {
      subject: 'Refund of {{amount}} {{asset_code}} has been processed',
      body:
        'Hello,\n\nYour refund of {{amount}} {{asset_code}} for transaction {{transaction_id}} ' +
        'has been successfully processed on {{refunded_at}}.\n\n' +
        'The funds should appear in your account within 1-3 business days.\n\n' +
        'Thank you for your patience.',
    },
    'sep24.refund_failed': {
      subject: 'Action required: Refund for {{transaction_id}} needs attention',
      body:
        'Hello,\n\nWe were unable to automatically process the refund for transaction ' +
        '{{transaction_id}} ({{amount}} {{asset_code}}) after {{retry_count}} attempts.\n\n' +
        'Our support team has been notified and will reach out within 24 hours.\n\n' +
        'Reference: {{manual_review_id}}\n\nWe apologise for the inconvenience.',
    },
    'sep24.partial_deposit': {
      subject: 'Partial deposit received for transaction {{transaction_id}}',
      body:
        'Hello,\n\nWe received a partial deposit of {{actual_amount}} {{asset_code}} ' +
        'for transaction {{transaction_id}} (quoted amount: {{quoted_amount}} {{asset_code}}).\n\n' +
        'A refund of {{actual_amount}} {{asset_code}} will be processed for the partial deposit.\n\n' +
        'Please initiate a new transaction for the full amount.',
    },
    'sep24.manual_review': {
      subject: 'Transaction {{transaction_id}} requires manual review',
      body:
        'Hello,\n\nTransaction {{transaction_id}} ({{amount}} {{asset_code}}) has been ' +
        'flagged for manual review by our team.\n\n' +
        'Reason: {{reason}}\n\n' +
        'A member of our team will contact you within 24 hours.\n\n' +
        'Reference: {{manual_review_id}}',
    },
  },

  // ── French ────────────────────────────────────────────────────────────────
  fr: {
    'sep24.initiated': {
      subject: 'Votre {{direction}} de {{amount}} {{asset_code}} a démarré',
      body:
        'Bonjour,\n\nVotre {{direction}} de {{amount}} {{asset_code}} ' +
        '(transaction {{transaction_id}}) a été initiée avec {{anchor_id}}.\n\n' +
        'Suivez ce lien pour compléter la transaction : {{interactive_url}}\n\n' +
        'Ce lien expire dans 30 minutes.\n\nMerci d\'utiliser SwiftRemit.',
    },
    'sep24.completed': {
      subject: 'Votre {{direction}} de {{amount}} {{asset_code}} est terminée',
      body:
        'Bonjour,\n\nVotre {{direction}} de {{amount}} {{asset_code}} ' +
        '(transaction {{transaction_id}}) a été complétée avec succès.\n\n' +
        'Montant reçu : {{amount_out}} {{asset_code}}\nFrais : {{amount_fee}} {{asset_code}}\n\n' +
        'Merci d\'utiliser SwiftRemit.',
    },
    'sep24.expired': {
      subject: 'Votre {{direction}} de {{amount}} {{asset_code}} a expiré',
      body:
        'Bonjour,\n\nVotre {{direction}} de {{amount}} {{asset_code}} ' +
        '(transaction {{transaction_id}}) a expiré avant d\'être complétée.\n\n' +
        'Si des fonds ont été reçus, un remboursement sera traité automatiquement.',
    },
    'sep24.refund_requested': {
      subject: 'Remboursement demandé pour la transaction {{transaction_id}}',
      body:
        'Bonjour,\n\nUn remboursement a été demandé pour votre transaction ' +
        '{{transaction_id}} ({{amount}} {{asset_code}}).',
    },
    'sep24.refunded': {
      subject: 'Remboursement de {{amount}} {{asset_code}} traité',
      body:
        'Bonjour,\n\nVotre remboursement de {{amount}} {{asset_code}} pour la transaction ' +
        '{{transaction_id}} a été traité le {{refunded_at}}.',
    },
    'sep24.refund_failed': {
      subject: 'Action requise : remboursement pour {{transaction_id}}',
      body:
        'Bonjour,\n\nNous n\'avons pas pu traiter le remboursement pour la transaction ' +
        '{{transaction_id}} après {{retry_count}} tentatives.\n\nRéférence : {{manual_review_id}}',
    },
    'sep24.partial_deposit': {
      subject: 'Dépôt partiel reçu pour {{transaction_id}}',
      body:
        'Bonjour,\n\nNous avons reçu un dépôt partiel de {{actual_amount}} {{asset_code}} ' +
        'pour la transaction {{transaction_id}} (montant indiqué : {{quoted_amount}} {{asset_code}}).',
    },
    'sep24.manual_review': {
      subject: 'Transaction {{transaction_id}} nécessite une révision manuelle',
      body:
        'Bonjour,\n\nLa transaction {{transaction_id}} a été signalée pour révision manuelle.\n\n' +
        'Raison : {{reason}}\nRéférence : {{manual_review_id}}',
    },
  },

  // ── Spanish ───────────────────────────────────────────────────────────────
  es: {
    'sep24.initiated': {
      subject: 'Su {{direction}} de {{amount}} {{asset_code}} ha comenzado',
      body:
        'Hola,\n\nSu {{direction}} de {{amount}} {{asset_code}} ' +
        '(transacción {{transaction_id}}) ha sido iniciada con {{anchor_id}}.\n\n' +
        'Siga este enlace para completar el proceso: {{interactive_url}}\n\n' +
        'Este enlace caduca en 30 minutos.\n\nGracias por usar SwiftRemit.',
    },
    'sep24.completed': {
      subject: 'Su {{direction}} de {{amount}} {{asset_code}} está completa',
      body:
        'Hola,\n\nSu {{direction}} de {{amount}} {{asset_code}} ' +
        '(transacción {{transaction_id}}) se ha completado con éxito.\n\n' +
        'Monto recibido: {{amount_out}} {{asset_code}}\nComisión: {{amount_fee}} {{asset_code}}',
    },
    'sep24.expired': {
      subject: 'Su {{direction}} de {{amount}} {{asset_code}} ha vencido',
      body:
        'Hola,\n\nSu {{direction}} de {{amount}} {{asset_code}} ' +
        '(transacción {{transaction_id}}) venció antes de completarse.\n\n' +
        'Si se recibieron fondos, se procesará un reembolso automáticamente.',
    },
    'sep24.refund_requested': {
      subject: 'Reembolso solicitado para la transacción {{transaction_id}}',
      body:
        'Hola,\n\nSe ha solicitado un reembolso para su transacción ' +
        '{{transaction_id}} ({{amount}} {{asset_code}}).',
    },
    'sep24.refunded': {
      subject: 'Reembolso de {{amount}} {{asset_code}} procesado',
      body:
        'Hola,\n\nSu reembolso de {{amount}} {{asset_code}} para la transacción ' +
        '{{transaction_id}} fue procesado el {{refunded_at}}.',
    },
    'sep24.refund_failed': {
      subject: 'Acción requerida: reembolso para {{transaction_id}}',
      body:
        'Hola,\n\nNo pudimos procesar el reembolso para la transacción ' +
        '{{transaction_id}} después de {{retry_count}} intentos.\n\nReferencia: {{manual_review_id}}',
    },
    'sep24.partial_deposit': {
      subject: 'Depósito parcial recibido para {{transaction_id}}',
      body:
        'Hola,\n\nRecibimos un depósito parcial de {{actual_amount}} {{asset_code}} ' +
        'para la transacción {{transaction_id}} (monto cotizado: {{quoted_amount}} {{asset_code}}).',
    },
    'sep24.manual_review': {
      subject: 'Transacción {{transaction_id}} requiere revisión manual',
      body:
        'Hola,\n\nLa transacción {{transaction_id}} ha sido marcada para revisión manual.\n\n' +
        'Motivo: {{reason}}\nReferencia: {{manual_review_id}}',
    },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Interpolate {{variable}} placeholders in a template string. */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/**
 * Resolve and render a notification template.
 * Falls back to 'en' if the requested locale is not found.
 * Falls back to 'en' if the event is missing for the locale.
 */
export function renderNotification(payload: NotificationPayload): RenderedNotification {
  const locale = payload.locale ?? 'en';
  const localeTemplates = TEMPLATES[locale] ?? TEMPLATES['en'];
  const template = localeTemplates[payload.event] ?? TEMPLATES['en'][payload.event];

  if (!template) {
    throw new Error(`No template found for event: ${payload.event}`);
  }

  return {
    subject: interpolate(template.subject, payload.variables),
    body:    interpolate(template.body,    payload.variables),
  };
}

/** Return the list of supported locale codes. */
export function supportedLocales(): string[] {
  return Object.keys(TEMPLATES);
}
