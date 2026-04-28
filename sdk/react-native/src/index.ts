export { SwiftRemitRNClient } from './client.js';
export type { SwiftRemitRNClientOptions, SwiftRemitSigner } from './client.js';
export { useCreateRemittance, useNetworkToggle } from './hooks.js';
export type { StellarNetwork } from './hooks.js';

// Re-export core SDK utilities so consumers only need one import
export {
  toStroops,
  fromStroops,
  USDC_MULTIPLIER,
  Networks,
  RpcUrls,
  ErrorCode,
  SwiftRemitError,
  parseContractError,
} from '@swiftremit/sdk';
