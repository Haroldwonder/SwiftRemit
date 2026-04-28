import { isConnected, getNetwork, getAddress } from '@stellar/freighter-api';

export type NetworkType = 'Testnet' | 'Mainnet';

export interface FreighterConnectionResult {
  publicKey: string;
  network: NetworkType;
}

const FREIGHTER_INSTALL_URL = 'https://www.freighter.app/';

export class FreighterService {
  static isInstalled(): boolean {
    return typeof window !== 'undefined' && window.freighter !== undefined;
  }

  static getInstallUrl(): string {
    return FREIGHTER_INSTALL_URL;
  }

  static async connect(): Promise<FreighterConnectionResult> {
    if (!this.isInstalled()) {
      throw new Error('Freighter wallet is not installed');
    }

    const connectedResponse = await isConnected();
    if (!connectedResponse.isConnected) {
      throw new Error('Freighter wallet is not connected');
    }

    const addressResponse = await getAddress();
    if (addressResponse.error) {
      throw new Error(addressResponse.error.message || 'Failed to get address');
    }

    const networkResponse = await getNetwork();
    if (networkResponse.error) {
      throw new Error(networkResponse.error.message || 'Failed to get network');
    }
    
    // Map Freighter network names to our NetworkType
    const network = this.mapNetwork(networkResponse.network);

    return { publicKey: addressResponse.address, network };
  }

  static mapNetwork(freighterNetwork: string): NetworkType {
    // Freighter returns 'TESTNET' or 'PUBLIC' (for mainnet)
    if (freighterNetwork.toUpperCase() === 'PUBLIC') {
      return 'Mainnet';
    }
    return 'Testnet';
  }

  static isNetworkMismatch(walletNetwork: NetworkType, expectedNetwork: NetworkType): boolean {
    return walletNetwork !== expectedNetwork;
  }
}
