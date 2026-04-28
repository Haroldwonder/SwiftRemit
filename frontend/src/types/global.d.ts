declare module '*.css';

interface FreighterAPI {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<string>;
  signTransaction(xdr: string, opts?: { network?: string; networkPassphrase?: string }): Promise<string>;
}

interface Window {
  freighter?: FreighterAPI;
}

// Vitest globals
declare const global: typeof globalThis;
