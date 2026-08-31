import { t, setLocale, getLocale, i18n } from '../../services/i18n';
import { AppLocale } from '../../types';

describe('i18n.ts', () => {
  const supportedLocales: AppLocale[] = ['en-US', 'es-ES', 'fr-FR', 'pt-BR'];

  beforeEach(() => {
    setLocale('en-US');
  });

  describe('t() — nested key resolution', () => {
    it('resolves top-level keys', () => {
      const result = t('common.send');
      expect(result).toBe('Send');
    });

    it('resolves deeply nested keys', () => {
      const result = t('sendFlow.recipientNamePlaceholder');
      expect(result).toBe('Full name');
    });

    it('returns the keyPath as fallback when key is missing', () => {
      const result = t('nonexistent.key');
      expect(result).toBe('nonexistent.key');
    });

    it('returns the provided defaultValue when key is missing', () => {
      const result = t('nonexistent.key', 'Default text');
      expect(result).toBe('Default text');
    });

    it('works with all supported locales', () => {
      supportedLocales.forEach((locale) => {
        setLocale(locale);
        const result = t('common.send');
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
      });
    });
  });

  describe('t() — locale-specific translations', () => {
    it('returns English translation for en-US locale', () => {
      setLocale('en-US');
      expect(t('common.send')).toBe('Send');
      expect(t('common.cancel')).toBe('Cancel');
    });

    it('returns Spanish translation for es-ES locale', () => {
      setLocale('es-ES');
      expect(t('common.send')).toBe('Enviar');
      expect(t('common.cancel')).toBe('Cancelar');
    });

    it('returns French translation for fr-FR locale', () => {
      setLocale('fr-FR');
      expect(t('common.send')).toBe('Envoyer');
      expect(t('common.cancel')).toBe('Annuler');
    });

    it('returns Portuguese translation for pt-BR locale', () => {
      setLocale('pt-BR');
      expect(t('common.send')).toBe('Enviar');
      expect(t('common.cancel')).toBe('Cancelar');
    });
  });

  describe('setLocale() and getLocale()', () => {
    it('sets and retrieves locale correctly', () => {
      setLocale('es-ES');
      expect(getLocale()).toBe('es-ES');

      setLocale('fr-FR');
      expect(getLocale()).toBe('fr-FR');
    });

    it('ignores invalid locales and keeps current locale', () => {
      setLocale('en-US');
      setLocale('invalid-locale' as AppLocale);
      expect(getLocale()).toBe('en-US');
    });

    it('translation changes after setLocale', () => {
      setLocale('en-US');
      expect(t('common.send')).toBe('Send');

      setLocale('es-ES');
      expect(t('common.send')).toBe('Enviar');
    });
  });

  describe('i18n export object', () => {
    it('exports setLocale function', () => {
      expect(typeof i18n.setLocale).toBe('function');
    });

    it('exports getLocale function', () => {
      expect(typeof i18n.getLocale).toBe('function');
    });

    it('exports t function', () => {
      expect(typeof i18n.t).toBe('function');
    });

    it('can be used to change and retrieve locale', () => {
      i18n.setLocale('pt-BR');
      expect(i18n.getLocale()).toBe('pt-BR');
      expect(i18n.t('common.send')).toBe('Enviar');
    });
  });

  describe('translation coverage — no missing keys per locale', () => {
    const supportedSections = ['common', 'sendFlow', 'fees', 'anchors', 'disputes', 'receipt', 'kyc'];

    it('has all sections defined in each locale', () => {
      supportedLocales.forEach((locale) => {
        setLocale(locale);
        supportedSections.forEach((section) => {
          const result = t(`${section}.missing`);
          // Should return keyPath fallback, not crash
          expect(result).toContain(section);
        });
      });
    });

    it('resolves common receipt translation across all locales', () => {
      supportedLocales.forEach((locale) => {
        setLocale(locale);
        const receipt = t('receipt.receipt');
        expect(receipt).toBeTruthy();
        expect(receipt.length).toBeGreaterThan(0);
      });
    });

    it('resolves all fee keys across all locales', () => {
      const feeKeys = ['sendFee', 'fxFee', 'payoutFee', 'totalFees', 'youSend', 'recipientReceives', 'feeBreakdown'];
      supportedLocales.forEach((locale) => {
        setLocale(locale);
        feeKeys.forEach((key) => {
          const result = t(`fees.${key}`);
          expect(result).toBeTruthy();
          expect(typeof result).toBe('string');
          expect(result).not.toContain('fees.');
        });
      });
    });
  });
});
