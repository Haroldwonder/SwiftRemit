/**
 * Signer interface for React Native.
 *
 * Decouples the SDK from any specific wallet implementation so callers can
 * plug in expo-secure-store, react-native-keychain, WalletConnect, or a
 * hardware wallet adapter without changing SDK code.
 */

/**
 * A function that signs a Stellar transaction XDR string and returns the
 * signed XDR. Throw to cancel the signing request.
 */
export type SignTransactionFn = (
  transactionXdr: string,
  options: { networkPassphrase: string }
) => Promise<string>;

/**
 * Minimal signer interface. Implement this to connect any wallet to the SDK.
 *
 * @example
 * // expo-secure-store + Keypair
 * import * as SecureStore from 'expo-secure-store';
 * import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
 *
 * const signer: SwiftRemitSigner = {
 *   async getPublicKey() {
 *     return await SecureStore.getItemAsync('stellar_public_key') ?? '';
 *   },
 *   async signTransaction(xdr, { networkPassphrase }) {
 *     const secret = await SecureStore.getItemAsync('stellar_secret_key');
 *     if (!secret) throw new Error('No key in secure store');
 *     const keypair = Keypair.fromSecret(secret);
 *     const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
 *     tx.sign(keypair);
 *     return tx.toXDR();
 *   },
 * };
 */
export interface SwiftRemitSigner {
  /** Return the Stellar public key (G…) for the active account. */
  getPublicKey(): Promise<string>;
  /** Sign a transaction XDR and return the signed XDR. */
  signTransaction: SignTransactionFn;
}
