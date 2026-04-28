import * as fs from 'fs';
import * as path from 'path';
import Joi from 'joi';
import { Currency, CurrencyConfig } from './types';

// Validation schema for currency objects
const currencySchema = Joi.object({
  code: Joi.string()
    .required()
    .custom((value, helpers) => {
      if (!/^[A-Z][A-Z0-9]*$/.test(value)) {
        return helpers.error('string.uppercase');
      }
      if (value.length < 3) {
        return helpers.error('string.min', { limit: 3 });
      }
      if (value.length > 12) {
        return helpers.error('string.max', { limit: 12 });
      }
      return value;
    })
    .messages({
      'string.uppercase': 'Currency code must contain only uppercase letters and numbers',
      'string.min': 'Currency code must be at least 3 characters',
      'string.max': 'Currency code must not exceed 12 characters',
    }),
  symbol: Joi.string()
    .min(1)
    .max(10)
    .required()
    .messages({
      'string.min': 'Currency symbol must be at least 1 character',
      'string.max': 'Currency symbol must not exceed 10 characters',
    }),
  decimal_precision: Joi.number()
    .integer()
    .min(0)
    .max(18)
    .required()
    .messages({
      'number.min': 'Decimal precision must be at least 0',
      'number.max': 'Decimal precision must not exceed 18',
    }),
  name: Joi.string()
    .min(1)
    .max(100)
    .optional()
    .messages({
      'string.max': 'Currency name must not exceed 100 characters',
    }),
});

// Validation schema for the entire config
const configSchema = Joi.object({
  currencies: Joi.array()
    .items(currencySchema)
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one currency must be configured',
    }),
});

export class CurrencyConfigLoader {
  private config: CurrencyConfig | null = null;
  private configPath: string;
  private envOverrides: Currency[] = [];

  constructor(configPath?: string) {
    this.configPath = configPath || process.env.CURRENCY_CONFIG_PATH || './config/currencies.json';
  }

  /**
   * Load and validate currency configuration from file and environment
   * Fails fast if configuration is invalid
   */
  public load(): CurrencyConfig {
    try {
      // Load base configuration from file
      const baseConfig = this.loadFromFile();

      // Load environment overrides if enabled
      if (process.env.CURRENCY_CONFIG_ENV_OVERRIDE === 'true') {
        this.loadEnvironmentOverrides();
      }

      // Merge configurations (env overrides take precedence)
      const mergedConfig = this.mergeConfigurations(baseConfig);

      // Validate merged configuration
      this.validateConfiguration(mergedConfig);

      // Check for duplicate currency codes
      this.checkDuplicates(mergedConfig);

      this.config = mergedConfig;
      console.log(`✓ Currency configuration loaded successfully: ${mergedConfig.currencies.length} currencies`);
      
      return mergedConfig;
    } catch (error) {
      console.error('✗ Failed to load currency configuration:', error);
      throw new Error(`Currency configuration error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load configuration from JSON file
   */
  private loadFromFile(): CurrencyConfig {
    const resolvedPath = path.resolve(this.configPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Configuration file not found: ${resolvedPath}`);
    }

    try {
      const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
      const config = JSON.parse(fileContent) as CurrencyConfig;

      if (!config.currencies || !Array.isArray(config.currencies)) {
        throw new Error('Invalid configuration format: "currencies" array is required');
      }

      return config;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in configuration file: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Load currency overrides from environment variable
   */
  private loadEnvironmentOverrides(): void {
    const overridesEnv = process.env.CURRENCY_OVERRIDES;

    if (!overridesEnv || overridesEnv.trim() === '') {
      return;
    }

    try {
      const overrides = JSON.parse(overridesEnv);

      if (!Array.isArray(overrides)) {
        throw new Error('CURRENCY_OVERRIDES must be a JSON array');
      }

      this.envOverrides = overrides;
      console.log(`✓ Loaded ${overrides.length} currency override(s) from environment`);
    } catch (error) {
      throw new Error(`Failed to parse CURRENCY_OVERRIDES: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Merge base configuration with environment overrides
   */
  private mergeConfigurations(baseConfig: CurrencyConfig): CurrencyConfig {
    if (this.envOverrides.length === 0) {
      return baseConfig;
    }

    const mergedCurrencies = [...baseConfig.currencies];

    // Apply overrides
    for (const override of this.envOverrides) {
      const index = mergedCurrencies.findIndex(c => c.code === override.code);
      
      if (index >= 0) {
        // Override existing currency
        mergedCurrencies[index] = { ...mergedCurrencies[index], ...override };
      } else {
        // Add new currency
        mergedCurrencies.push(override);
      }
    }

    return { currencies: mergedCurrencies };
  }

  /**
   * Validate configuration against schema
   */
  private validateConfiguration(config: CurrencyConfig): void {
    const { error } = configSchema.validate(config, { abortEarly: false });

    if (error) {
      const messages = error.details.map(d => d.message).join('; ');
      throw new Error(`Configuration validation failed: ${messages}`);
    }
  }

  /**
   * Check for duplicate currency codes
   */
  private checkDuplicates(config: CurrencyConfig): void {
    const codes = config.currencies.map(c => c.code);
    const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);

    if (duplicates.length > 0) {
      throw new Error(`Duplicate currency codes found: ${[...new Set(duplicates)].join(', ')}`);
    }
  }

  /**
   * Get loaded configuration
   */
  public getConfig(): CurrencyConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * Get all currencies
   */
  public getCurrencies(): Currency[] {
    return this.getConfig().currencies;
  }

  /**
   * Get currency by code
   */
  public getCurrencyByCode(code: string): Currency | undefined {
    return this.getCurrencies().find(c => c.code === code.toUpperCase());
  }

  /**
   * Reload configuration (useful for testing)
   */
  public reload(): CurrencyConfig {
    this.config = null;
    this.envOverrides = [];
    return this.load();
  }
}

// Singleton instance
let configLoader: CurrencyConfigLoader | null = null;

export function getCurrencyConfigLoader(): CurrencyConfigLoader {
  if (!configLoader) {
    configLoader = new CurrencyConfigLoader();
  }
  return configLoader;
}

export function initializeCurrencyConfig(): void {
  const loader = getCurrencyConfigLoader();
  loader.load();
}
