import { Networks } from '@stellar/stellar-sdk';

const DEFAULT_SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';

export function getSorobanRpcUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.SOROBAN_RPC_URL || env.HORIZON_URL || DEFAULT_SOROBAN_RPC_URL;
}

export function getNetworkPassphrase(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NETWORK_PASSPHRASE) {
    return env.NETWORK_PASSPHRASE;
  }

  switch ((env.STELLAR_NETWORK || 'testnet').toLowerCase()) {
    case 'testnet':
      return Networks.TESTNET;
    case 'mainnet':
    case 'public':
      return Networks.PUBLIC;
    default:
      throw new Error(
        `Unsupported STELLAR_NETWORK "${env.STELLAR_NETWORK}". Use "testnet", "mainnet", or set NETWORK_PASSPHRASE explicitly.`
      );
  }
}

export function assertNetworkMatchesRpcEndpoint(
  networkPassphrase: string,
  rpcUrl: string
): void {
  const normalizedRpcUrl = rpcUrl.toLowerCase();
  const pointsToTestnet = normalizedRpcUrl.includes('testnet');
  const pointsToPublicNetwork =
    normalizedRpcUrl.includes('mainnet') || normalizedRpcUrl.includes('public');

  if (pointsToTestnet && networkPassphrase !== Networks.TESTNET) {
    throw new Error(
      `Configured network passphrase does not match Soroban RPC endpoint ${rpcUrl}.`
    );
  }

  if (pointsToPublicNetwork && networkPassphrase !== Networks.PUBLIC) {
    throw new Error(
      `Configured network passphrase does not match Soroban RPC endpoint ${rpcUrl}.`
    );
  }
}

export function getStellarRuntimeConfig(env: NodeJS.ProcessEnv = process.env): {
  rpcUrl: string;
  networkPassphrase: string;
} {
  const rpcUrl = getSorobanRpcUrl(env);
  const networkPassphrase = getNetworkPassphrase(env);

  assertNetworkMatchesRpcEndpoint(networkPassphrase, rpcUrl);

  return { rpcUrl, networkPassphrase };
}
