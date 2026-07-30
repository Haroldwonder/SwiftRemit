import { describe, it, expect } from 'vitest';
import {
  evaluateEnv,
  isPlaceholder,
  BACKEND_REQUIREMENTS,
  type EnvRequirement,
} from '../env-guard';

/**
 * SR-102 — services must refuse to start on .env.example placeholders.
 */

const GOOD_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://swiftremit:swiftremit@postgres:5432/swiftremit',
  STELLAR_NETWORK: 'testnet',
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
  SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  CONTRACT_ID: 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K',
  ADMIN_SECRET_KEY: 'SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4',
};

describe('isPlaceholder', () => {
  it.each([
    ['', 'empty value'],
    ['   ', 'whitespace only'],
    ['change-me', 'change-me marker'],
    ['CHANGE_ME_IN_LOCAL_OVERRIDE', 'change_me marker'],
    ['postgresql://user:password@localhost:5432/swiftremit', 'example DSN'],
    ['SXXX...', 'redacted secret key'],
    ['CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', 'all-A contract id'],
    ['<CONTRACT_ID>', 'angle-bracket token'],
    ['https://anchor.example.com', 'example.com host'],
    ['your-secret-here', 'your- prefix'],
  ])('flags %j (%s)', (value) => {
    expect(isPlaceholder(value)).toBe(true);
  });

  it.each([
    'postgres://swiftremit:swiftremit@postgres:5432/swiftremit',
    'https://horizon-testnet.stellar.org',
    'Test SDF Network ; September 2015',
    'testnet',
    'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K',
  ])('accepts real value %j', (value) => {
    expect(isPlaceholder(value)).toBe(false);
  });
});

describe('evaluateEnv', () => {
  it('passes a fully configured production environment', () => {
    const { errors, warnings } = evaluateEnv(BACKEND_REQUIREMENTS, GOOD_ENV, 'production');
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('errors when an always-required variable holds a placeholder', () => {
    const env = { ...GOOD_ENV, DATABASE_URL: 'postgresql://user:password@localhost:5432/x' };
    const { errors } = evaluateEnv(BACKEND_REQUIREMENTS, env, 'development');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('DATABASE_URL');
    expect(errors[0]).toContain('placeholder');
  });

  it('errors when an always-required variable is missing', () => {
    const env = { ...GOOD_ENV };
    delete env.HORIZON_URL;
    const { errors } = evaluateEnv(BACKEND_REQUIREMENTS, env, 'development');
    expect(errors).toEqual([expect.stringContaining('HORIZON_URL is not set')]);
  });

  it('only warns about production-required variables in development', () => {
    const env = { ...GOOD_ENV, CONTRACT_ID: '', ADMIN_SECRET_KEY: 'SXXX...' };
    const { errors, warnings } = evaluateEnv(BACKEND_REQUIREMENTS, env, 'development');
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it('promotes those same variables to errors in production', () => {
    const env = { ...GOOD_ENV, CONTRACT_ID: '', ADMIN_SECRET_KEY: 'SXXX...' };
    const { errors } = evaluateEnv(BACKEND_REQUIREMENTS, env, 'production');
    expect(errors).toHaveLength(2);
  });

  it('skips variables that a secrets manager injects later', () => {
    const requirements: EnvRequirement[] = [
      {
        name: 'ADMIN_SECRET_KEY',
        requiredIn: 'production',
        hint: 'admin key',
        skipIf: () => true,
      },
    ];
    const { errors, warnings } = evaluateEnv(requirements, {}, 'production');
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
