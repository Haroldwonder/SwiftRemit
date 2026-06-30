import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CurrencyConfigLoader } from '../config';

describe('CurrencyConfigLoader', () => {
  const testConfigDir = path.join(__dirname, 'test-configs');
  const validConfigPath = path.join(testConfigDir, 'valid.json');
  const invalidConfigPath = path.join(testConfigDir, 'invalid.json');
  const emptyConfigPath = path.join(testConfigDir, 'empty.json');
  const duplicateConfigPath = path.join(testConfigDir, 'duplicate.json');

  beforeEach(() => {
    // Create test config directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }

    // Create valid config
    fs.writeFileSync(
      validConfigPath,
      JSON.stringify({
        currencies: [
          { code: 'USD', symbol: '$', decimal_precision: 2, name: 'US Dollar' },
          { code: 'EUR', symbol: '€', decimal_precision: 2, name: 'Euro' },
          { code: 'JPY', symbol: '¥', decimal_precision: 0, name: 'Japanese Yen' },
        ],
      })
    );

    // Create invalid config (missing required field)
    fs.writeFileSync(
      invalidConfigPath,
      JSON.stringify({
        currencies: [
          { code: 'USD', symbol: '$' }, // Missing decimal_precision
        ],
      })
    );

    // Create empty config
    fs.writeFileSync(
      emptyConfigPath,
      JSON.stringify({
        currencies: [],
      })
    );

    // Create config with duplicates
    fs.writeFileSync(
      duplicateConfigPath,
      JSON.stringify({
        currencies: [
          { code: 'USD', symbol: '$', decimal_precision: 2 },
          { code: 'USD', symbol: '$', decimal_precision: 2 }, // Duplicate
        ],
      })
    );

    // Clear environment variables
    delete process.env.CURRENCY_CONFIG_ENV_OVERRIDE;
    delete process.env.CURRENCY_OVERRIDES;
  });

  afterEach(() => {
    // Clean up test configs
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('load()', () => {
    it('should load valid configuration successfully', () => {
      const loader = new CurrencyConfigLoader(validConfigPath);
      const config = loader.load();

      expect(config.currencies).toHaveLength(3);
      expect(config.currencies[0].code).toBe('USD');
      expect(config.currencies[0].symbol).toBe('$');
      expect(config.currencies[0].decimal_precision).toBe(2);
    });

    it('should throw error if config file does not exist', () => {
      const loader = new CurrencyConfigLoader('/nonexistent/path.json');

      expect(() => loader.load()).toThrow('Configuration file not found');
    });

    it('should throw error for invalid JSON', () => {
      const invalidJsonPath = path.join(testConfigDir, 'invalid-json.json');
      fs.writeFileSync(invalidJsonPath, '{ invalid json }');

      const loader = new CurrencyConfigLoader(invalidJsonPath);

      expect(() => loader.load()).toThrow('Invalid JSON');
    });

    it('should throw error for missing required fields', () => {
      const loader = new CurrencyConfigLoader(invalidConfigPath);

      expect(() => loader.load()).toThrow('Configuration validation failed');
    });

    it('should throw error for empty currencies array', () => {
      const loader = new CurrencyConfigLoader(emptyConfigPath);

      expect(() => loader.load()).toThrow('At least one currency must be configured');
    });

    it('should throw error for duplicate currency codes', () => {
      const loader = new CurrencyConfigLoader(duplicateConfigPath);

      expect(() => loader.load()).toThrow('Duplicate currency codes found: USD');
    });

    it('should validate currency code format', () => {
      const invalidCodePath = path.join(testConfigDir, 'invalid-code.json');
      fs.writeFileSync(
        invalidCodePath,
        JSON.stringify({
          currencies: [
            { code: 'us', symbol: '$', decimal_precision: 2 }, // Lowercase not allowed
          ],
        })
      );

      const loader = new CurrencyConfigLoader(invalidCodePath);

      expect(() => loader.load()).toThrow('Currency code must contain only uppercase letters');
    });

    it('should validate decimal precision range', () => {
      const invalidPrecisionPath = path.join(testConfigDir, 'invalid-precision.json');
      fs.writeFileSync(
        invalidPrecisionPath,
        JSON.stringify({
          currencies: [
            { code: 'USD', symbol: '$', decimal_precision: 20 }, // Exceeds max
          ],
        })
      );

      const loader = new CurrencyConfigLoader(invalidPrecisionPath);

      expect(() => loader.load()).toThrow('Decimal precision must not exceed 18');
    });
  });

  describe('Environment Overrides', () => {
    it('should apply environment overrides when enabled', () => {
      process.env.CURRENCY_CONFIG_ENV_OVERRIDE = 'true';
      process.env.CURRENCY_OVERRIDES = JSON.stringify([
        { code: 'USD', symbol: 'US$', decimal_precision: 3 }, // Override USD
        { code: 'CAD', symbol: 'C$', decimal_precision: 2 }, // Add new currency
      ]);

      const loader = new CurrencyConfigLoader(validConfigPath);
      const config = loader.load();

      const usd = config.currencies.find(c => c.code === 'USD');
      const cad = config.currencies.find(c => c.code === 'CAD');

      expect(usd?.symbol).toBe('US$');
      expect(usd?.decimal_precision).toBe(3);
      expect(cad).toBeDefined();
      expect(cad?.symbol).toBe('C$');
    });

    it('should not apply overrides when disabled', () => {
      process.env.CURRENCY_CONFIG_ENV_OVERRIDE = 'false';
      process.env.CURRENCY_OVERRIDES = JSON.stringify([
        { code: 'USD', symbol: 'US$', decimal_precision: 3 },
      ]);

      const loader = new CurrencyConfigLoader(validConfigPath);
      const config = loader.load();

      const usd = config.currencies.find(c => c.code === 'USD');
      expect(usd?.symbol).toBe('$'); // Original value
    });

    it('should throw error for invalid override JSON', () => {
      process.env.CURRENCY_CONFIG_ENV_OVERRIDE = 'true';
      process.env.CURRENCY_OVERRIDES = '{ invalid json }';

      const loader = new CurrencyConfigLoader(validConfigPath);

      expect(() => loader.load()).toThrow('Failed to parse CURRENCY_OVERRIDES');
    });

    it('should throw error if overrides is not an array', () => {
      process.env.CURRENCY_CONFIG_ENV_OVERRIDE = 'true';
      process.env.CURRENCY_OVERRIDES = JSON.stringify({ code: 'USD' });

      const loader = new CurrencyConfigLoader(validConfigPath);

      expect(() => loader.load()).toThrow('CURRENCY_OVERRIDES must be a JSON array');
    });
  });

  describe('getCurrencies()', () => {
    it('should return all currencies', () => {
      const loader = new CurrencyConfigLoader(validConfigPath);
      loader.load();

      const currencies = loader.getCurrencies();

      expect(currencies).toHaveLength(3);
      expect(currencies.every(c => c.code && c.symbol && typeof c.decimal_precision === 'number')).toBe(true);
    });

    it('should throw error if config not loaded', () => {
      const loader = new CurrencyConfigLoader(validConfigPath);

      expect(() => loader.getCurrencies()).toThrow('Configuration not loaded');
    });
  });

  describe('getCurrencyByCode()', () => {
    it('should return currency by code (case insensitive)', () => {
      const loader = new CurrencyConfigLoader(validConfigPath);
      loader.load();

      const usd = loader.getCurrencyByCode('usd');
      const eur = loader.getCurrencyByCode('EUR');

      expect(usd?.code).toBe('USD');
      expect(eur?.code).toBe('EUR');
    });

    it('should return undefined for non-existent currency', () => {
      const loader = new CurrencyConfigLoader(validConfigPath);
      loader.load();

      const result = loader.getCurrencyByCode('XYZ');

      expect(result).toBeUndefined();
    });
  });

  describe('reload()', () => {
    it('should reload configuration', () => {
      const loader = new CurrencyConfigLoader(validConfigPath);
      loader.load();

      const initialCount = loader.getCurrencies().length;

      // Modify config file
      fs.writeFileSync(
        validConfigPath,
        JSON.stringify({
          currencies: [
            { code: 'USD', symbol: '$', decimal_precision: 2 },
          ],
        })
      );

      loader.reload();
      const newCount = loader.getCurrencies().length;

      expect(newCount).toBe(1);
      expect(newCount).not.toBe(initialCount);
    });
  });
});
