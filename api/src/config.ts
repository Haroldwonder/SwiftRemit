import * as fs from 'fs';
import * as path from 'path';
import Joi from 'joi';
import { Currency, CurrencyConfig } from './types';

// Validation schema for currency objects
const currencySchema = Joi.object({
  code: Joi.string()
    .required()
    .custom((value, helpers) => {
      // Validate ISO 4217 format: exactly 3 uppercase letters
      if (!/^[A-Z]{3}$/.test(value)) {
        return helpers.error('string.iso4217');
      }
      return value;
    })
    .messages({
      'string.iso4217': 'Currency code must conform to ISO 4217 format (exactly 3 uppercase letters)',
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
  // #1547: optional list of human-readable aliases (e.g. "DOLLAR" → "USD")
  aliases: Joi.array()
    .items(Joi.string().min(1).max(50))
    .optional()
    .messages({
      'array.base': 'aliases must be an array of strings',
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
  /** #1878 — ISO-8601 timestamp of the last successful load. */
  private loadedAt: string | null = null;

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

      // #1547: ensure no alias conflicts with a code or another alias
      this.checkDuplicateAliases(mergedConfig);

      this.config = mergedConfig;
      this.loadedAt = new Date().toISOString();
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
   * Check that no alias collides with another code or alias.
   * Called after checkDuplicates so codes are already unique.
   */
  private checkDuplicateAliases(config: CurrencyConfig): void {
    // Build a flat set of all canonical codes (upper-cased for comparison)
    const seen = new Set<string>(config.currencies.map(c => c.code.toUpperCase()));
    const conflictingAliases: string[] = [];

    for (const currency of config.currencies) {
      for (const alias of currency.aliases ?? []) {
        const key = alias.toUpperCase();
        if (seen.has(key)) {
          conflictingAliases.push(`"${alias}" (on ${currency.code})`);
        } else {
          seen.add(key);
        }
      }
    }

    if (conflictingAliases.length > 0) {
      throw new Error(`Duplicate or conflicting aliases found: ${conflictingAliases.join(', ')}`);
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
   * #1878 — ISO-8601 timestamp of the last successful configuration load.
   * Stable between reloads, so it can be used as a cache validator.
   */
  public getLoadedAt(): string {
    if (!this.config || !this.loadedAt) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.loadedAt;
  }

  /**
   * Get all currencies
   */
  public getCurrencies(): Currency[] {
    return this.getConfig().currencies;
  }

  /**
   * Get currency by code (case-insensitive).
   */
  public getCurrencyByCode(code: string): Currency | undefined {
    return this.getCurrencies().find(c => c.code === code.toUpperCase());
  }

  /**
   * #1547 — Get currency by code **or** alias (case-insensitive).
   *
   * Resolves in two passes:
   *   1. Exact canonical code match (e.g. "USD").
   *   2. Alias match (e.g. "DOLLAR", "dollars", "usd coin").
   *
   * Returns `undefined` when neither a code nor any alias matches.
   */
  public getCurrencyByCodeOrAlias(input: string): Currency | undefined {
    const normalised = input.toUpperCase();
    const currencies = this.getCurrencies();

    // Pass 1: canonical code
    const byCode = currencies.find(c => c.code === normalised);
    if (byCode) return byCode;

    // Pass 2: aliases
    return currencies.find(c =>
      (c.aliases ?? []).some(a => a.toUpperCase() === normalised),
    );
  }

  /**
   * Return all registered aliases as a flat map of alias → currency code.
   * Useful for building documentation or validating user input.
   */
  public getAliasMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const currency of this.getCurrencies()) {
      for (const alias of currency.aliases ?? []) {
        map[alias.toUpperCase()] = currency.code;
      }
    }
    return map;
  }

  /**
   * Reload configuration (useful for testing)
   */
  public reload(): CurrencyConfig {
    this.config = null;
    this.envOverrides = [];
    this.loadedAt = null;
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

/**
 * #1878 — Cache-Control max-age (seconds) for the currencies and limits
 * endpoints. Configurable via `CURRENCY_CACHE_MAX_AGE`; defaults to 300.
 */
export function getCurrencyCacheMaxAge(): number {
  const raw = process.env.CURRENCY_CACHE_MAX_AGE;
  if (raw === undefined || raw.trim() === '') {
    return 300;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 300;
  }
  return parsed;
}
