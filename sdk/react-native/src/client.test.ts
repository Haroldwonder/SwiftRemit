import { Keypair, Networks, TransactionBuilder, Account } from '@stellar/stellar-sdk';

const submitSignedTransactionMock = jest.fn().mockResolvedValue({ status: 'SUCCESS' });

jest.mock(
  '@swiftremit/sdk',
  () => {
    class SwiftRemitClient {
      constructor(_options: unknown) {}
      submitSignedTransaction = submitSignedTransactionMock;
    }
    return { SwiftRemitClient };
  },
  { virtual: true }
);

import { SwiftRemitRNClient } from './client.js';
import type { SwiftRemitSigner } from './signer.js';

function buildUnsignedTx() {
  const source = Keypair.random();
  const account = new Account(source.publicKey(), '0');
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .setTimeout(30)
    .build();
  return { tx, source };
}

describe('SwiftRemitRNClient', () => {
  beforeEach(() => {
    submitSignedTransactionMock.mockClear();
  });

  it('getAddress delegates to the injected signer', async () => {
    const signer: SwiftRemitSigner = {
      getPublicKey: jest.fn().mockResolvedValue('GEXAMPLE'),
      signTransaction: jest.fn(),
    };
    const client = new SwiftRemitRNClient({
      contractId: 'CCONTRACT',
      networkPassphrase: Networks.TESTNET,
      rpcUrl: 'https://rpc.example',
      signer,
    });

    await expect(client.getAddress()).resolves.toBe('GEXAMPLE');
    expect(signer.getPublicKey).toHaveBeenCalledTimes(1);
  });

  it('submitSigned signs via the injected signer and submits the already-signed transaction', async () => {
    const { tx, source } = buildUnsignedTx();

    const signer: SwiftRemitSigner = {
      getPublicKey: jest.fn().mockResolvedValue(source.publicKey()),
      signTransaction: jest.fn(async (xdr: string, { networkPassphrase }: { networkPassphrase: string }) => {
        const parsed = TransactionBuilder.fromXDR(xdr, networkPassphrase);
        (parsed as import('@stellar/stellar-sdk').Transaction).sign(source);
        return parsed.toXDR();
      }),
    };

    const client = new SwiftRemitRNClient({
      contractId: 'CCONTRACT',
      networkPassphrase: Networks.TESTNET,
      rpcUrl: 'https://rpc.example',
      signer,
    });

    const result = await client.submitSigned(tx);

    expect(signer.signTransaction).toHaveBeenCalledWith(
      tx.toXDR(),
      expect.objectContaining({ networkPassphrase: Networks.TESTNET })
    );
    // Regression check: submitSigned must not re-sign with a fake keypair —
    // it should hand the already-signed transaction to submitSignedTransaction.
    expect(submitSignedTransactionMock).toHaveBeenCalledTimes(1);
    const submittedTx = submitSignedTransactionMock.mock.calls[0][0] as import('@stellar/stellar-sdk').Transaction;
    expect(submittedTx.signatures.length).toBeGreaterThan(0);
    expect(result).toEqual({ status: 'SUCCESS' });
  });
});
