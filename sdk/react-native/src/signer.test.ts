import type { SwiftRemitSigner } from './signer.js';

describe('SwiftRemitSigner', () => {
  it('accepts an implementation backed by an in-memory secure store', async () => {
    const store = new Map<string, string>();
    store.set('stellar_public_key', 'GEXAMPLE');
    store.set('stellar_secret_key', 'SEXAMPLE');

    const signer: SwiftRemitSigner = {
      async getPublicKey() {
        return store.get('stellar_public_key') ?? '';
      },
      async signTransaction(xdr) {
        // A real implementation would decode `xdr`, sign with the secret key
        // loaded from secure storage, and return the signed XDR. Here we just
        // verify the interface shape and that the secret never leaves the
        // signer (the caller only ever sees `xdr` in and signed XDR out).
        if (!store.get('stellar_secret_key')) throw new Error('No key in secure store');
        return `signed:${xdr}`;
      },
    };

    await expect(signer.getPublicKey()).resolves.toBe('GEXAMPLE');
    await expect(
      signer.signTransaction('unsigned-xdr', { networkPassphrase: 'Test SDF Network ; September 2015' })
    ).resolves.toBe('signed:unsigned-xdr');
  });

  it('propagates errors when the secret key is unavailable', async () => {
    const signer: SwiftRemitSigner = {
      async getPublicKey() {
        return '';
      },
      async signTransaction() {
        throw new Error('No key in secure store');
      },
    };

    await expect(
      signer.signTransaction('xdr', { networkPassphrase: 'Test SDF Network ; September 2015' })
    ).rejects.toThrow('No key in secure store');
  });
});
