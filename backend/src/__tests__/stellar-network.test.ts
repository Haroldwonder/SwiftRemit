import { describe, expect, it } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  assertNetworkMatchesRpcEndpoint,
  getNetworkPassphrase,
  getSorobanRpcUrl,
  getStellarRuntimeConfig,
} from '../stellar-network';

describe('stellar-network', () => {
  it('derives the testnet passphrase from STELLAR_NETWORK', () => {
    expect(getNetworkPassphrase({ STELLAR_NETWORK: 'testnet' } as NodeJS.ProcessEnv)).toBe(
      Networks.TESTNET
    );
  });

  it('derives the public passphrase from STELLAR_NETWORK', () => {
    expect(getNetworkPassphrase({ STELLAR_NETWORK: 'mainnet' } as NodeJS.ProcessEnv)).toBe(
      Networks.PUBLIC
    );
  });

  it('prefers an explicit NETWORK_PASSPHRASE', () => {
    expect(
      getNetworkPassphrase({
        STELLAR_NETWORK: 'testnet',
        NETWORK_PASSPHRASE: Networks.PUBLIC,
      } as NodeJS.ProcessEnv)
    ).toBe(Networks.PUBLIC);
  });

  it('falls back to SOROBAN_RPC_URL when present', () => {
    expect(
      getSorobanRpcUrl({
        SOROBAN_RPC_URL: 'https://soroban.stellar.org',
        HORIZON_URL: 'https://horizon-testnet.stellar.org',
      } as NodeJS.ProcessEnv)
    ).toBe('https://soroban.stellar.org');
  });

  it('rejects a public passphrase against a testnet endpoint', () => {
    expect(() =>
      assertNetworkMatchesRpcEndpoint(Networks.PUBLIC, 'https://soroban-testnet.stellar.org')
    ).toThrow(/does not match/i);
  });

  it('returns validated runtime config', () => {
    expect(
      getStellarRuntimeConfig({
        STELLAR_NETWORK: 'testnet',
        SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      } as NodeJS.ProcessEnv)
    ).toEqual({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
    });
  });
});
